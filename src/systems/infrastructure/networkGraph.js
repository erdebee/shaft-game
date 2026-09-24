/**
 * networkGraph.js
 * The shape of the networks the player lays: which buildings are joined by
 * cable, pipe, drain or duct, which hub serves which level, and how far a
 * network has to run to get somewhere.
 *
 * Pure reads over state.infrastructure.links and the network catalogue
 * (catalog/infrastructure/networks.json). The power, water and air systems
 * each settle their own network over the graph this returns; the UI reads the
 * same graph to draw it, so what the player sees wired is what the
 * simulation uses. Writes nothing — links are made and cut by commands.
 *
 * A network left out of config `infrastructure.enforced` is treated as fully
 * laid: every node in one component, and one virtual hub (VIRTUAL) that
 * reaches every level with no limit. That is for system tests and
 * sandboxes that want one network without laying the rest.
 */

/** The id of the hub an unenforced network serves everything from. */
export const VIRTUAL = '*';

export function networkDef(ctx, networkId) {
  return ctx.catalog.networks?.byId?.[networkId] ?? null;
}

export function enforced(ctx, networkId) {
  return (ctx.config.infrastructure?.enforced ?? []).includes(networkId);
}

/** Whether a building can be linked on a network at all. */
export function isNode(ctx, networkId, buildingId) {
  const net = networkDef(ctx, networkId);
  return !!net && net.connects.some((c) => c.from === buildingId || c.to === buildingId);
}

export function isHub(ctx, networkId, buildingId) {
  return (networkDef(ctx, networkId)?.hubs ?? []).includes(buildingId);
}

/** Every network a building takes part in, in catalogue order. */
export function networksOf(ctx, buildingId) {
  return (ctx.catalog.networks?.all ?? []).filter((n) => isNode(ctx, n.id, buildingId)).map((n) => n.id);
}

/** Levels either side of its own a hub serves. */
export function reachOf(ctx, instance) {
  return ctx.catalog.buildings.byId[instance.buildingId]?.serviceRadiusLevels ?? 0;
}

/** A network's links whose ends both still stand. A riot can leave a stub. */
export function linksOf(state, networkId) {
  const standing = new Set(state.buildings.map((b) => b.instanceId));
  return (state.infrastructure?.links ?? []).filter((l) => l.network === networkId && standing.has(l.from) && standing.has(l.to));
}

/** What a link of `span` levels costs to lay: at least one level's worth. */
export function linkCost(ctx, networkId, span) {
  const net = networkDef(ctx, networkId);
  const levels = Math.max(1, span);
  return (net?.linkCost ?? []).map((c) => ({ id: c.id, qty: Math.ceil(c.qtyPerLevel * levels) }));
}

/**
 * Whether two buildings can be linked on a network, and what it would cost.
 * Returns { ok, reason, span, cost }; reason is one of 'no-network',
 * 'no-building', 'same', 'cannot-join', 'too-long', 'linked', or null. Paying
 * is the caller's business (core/commands.js), which also refuses on 'cost'.
 */
export function canLink(state, ctx, networkId, fromId, toId) {
  const net = networkDef(ctx, networkId);
  if (!net) return { ok: false, reason: 'no-network', span: 0, cost: [] };
  const a = state.buildings.find((b) => b.instanceId === fromId);
  const b = state.buildings.find((x) => x.instanceId === toId);
  if (!a || !b) return { ok: false, reason: 'no-building', span: 0, cost: [] };
  const span = Math.abs(a.level - b.level);
  const cost = linkCost(ctx, networkId, span);
  if (a === b) return { ok: false, reason: 'same', span, cost };
  const joins = net.connects.some((c) => (c.from === a.buildingId && c.to === b.buildingId)
    || (c.from === b.buildingId && c.to === a.buildingId));
  if (!joins) return { ok: false, reason: 'cannot-join', span, cost };
  if (net.maxSpanLevels != null && span > net.maxSpanLevels) return { ok: false, reason: 'too-long', span, cost };
  const already = linksOf(state, networkId).some((l) => (l.from === fromId && l.to === toId) || (l.from === toId && l.to === fromId));
  if (already) return { ok: false, reason: 'linked', span, cost };
  return { ok: true, reason: null, span, cost };
}

/**
 * The network as a graph: its nodes, who each is linked to, and which
 * connected component each belongs to. A component is keyed by its
 * earliest-built node, so the key is stable while the component stands.
 *
 * @returns {{ networkId, enforced, nodes, neighbours: Map, component: Map, members: Map }}
 */
export function graphOf(state, ctx, networkId) {
  const nodes = state.buildings
    .filter((b) => isNode(ctx, networkId, b.buildingId))
    .sort(byAge);
  const neighbours = new Map(nodes.map((n) => [n.instanceId, []]));
  const byId = new Map(nodes.map((n) => [n.instanceId, n]));
  const laid = enforced(ctx, networkId);

  if (laid) {
    for (const link of linksOf(state, networkId)) {
      const a = byId.get(link.from);
      const b = byId.get(link.to);
      if (!a || !b) continue;
      const span = Math.abs(a.level - b.level);
      neighbours.get(a.instanceId).push({ id: b.instanceId, span, linkId: link.id });
      neighbours.get(b.instanceId).push({ id: a.instanceId, span, linkId: link.id });
    }
  }

  const component = new Map();
  const members = new Map();
  for (const node of nodes) {
    if (component.has(node.instanceId)) continue;
    const key = laid ? node.instanceId : VIRTUAL;
    const group = [];
    if (laid) {
      const queue = [node.instanceId];
      component.set(node.instanceId, key);
      while (queue.length) {
        const id = queue.shift();
        group.push(byId.get(id));
        for (const { id: next } of neighbours.get(id)) {
          if (component.has(next)) continue;
          component.set(next, key);
          queue.push(next);
        }
      }
      group.sort(byAge);
    } else {
      for (const n of nodes) { component.set(n.instanceId, key); group.push(n); }
    }
    members.set(key, group);
  }

  return { networkId, enforced: laid, nodes, byId, neighbours, component, members };
}

/**
 * Cable run, in levels, from the nearest of `sources` to every node that can
 * reach one. Unenforced, it is the straight drop from the nearest source.
 */
export function runFrom(graph, sources) {
  const dist = new Map();
  if (!graph.enforced) {
    for (const node of graph.nodes) {
      let best = Infinity;
      for (const s of sources) best = Math.min(best, Math.abs(s.level - node.level));
      if (best < Infinity) dist.set(node.instanceId, best);
    }
    return dist;
  }
  // Dijkstra over small integer spans; the networks are a few dozen nodes.
  const open = new Set();
  for (const s of sources) { dist.set(s.instanceId, 0); open.add(s.instanceId); }
  while (open.size) {
    let current = null;
    for (const id of open) if (current === null || dist.get(id) < dist.get(current)) current = id;
    open.delete(current);
    for (const { id, span } of graph.neighbours.get(current) ?? []) {
      const d = dist.get(current) + span;
      if (d < (dist.get(id) ?? Infinity)) { dist.set(id, d); open.add(id); }
    }
  }
  return dist;
}

/**
 * Every node a drain from `startId` can reach, following links only to nodes
 * at the same depth or deeper: sewage runs downhill. Unenforced, everything.
 */
export function downhillFrom(graph, startId) {
  if (!graph.enforced) return new Set(graph.nodes.map((n) => n.instanceId));
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    const here = graph.byId.get(id);
    for (const { id: next } of graph.neighbours.get(id) ?? []) {
      if (seen.has(next)) continue;
      if (graph.byId.get(next).level < here.level) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * The hub that serves a level: the nearest `usable` hub whose reach covers
 * it, preferring one in a component `live` says has something to hand out.
 * Ties go to the earlier-built hub. Returns the hub instance, VIRTUAL for an
 * unenforced network, or null when nothing reaches.
 */
export function hubFor(graph, ctx, level, { usable = () => true, live = () => true } = {}) {
  if (!graph.enforced) return VIRTUAL;
  let best = null;
  let bestScore = null;
  for (const hub of graph.nodes) {
    if (!isHub(ctx, graph.networkId, hub.buildingId) || !usable(hub)) continue;
    const distance = Math.abs(hub.level - level);
    if (distance > reachOf(ctx, hub)) continue;
    const score = [live(graph.component.get(hub.instanceId)) ? 0 : 1, distance];
    if (!best || score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
      best = hub;
      bestScore = score;
    }
  }
  return best;
}

/** Levels a hub covers, clipped to the Shaft. */
export function levelsServedBy(state, ctx, hub) {
  const r = reachOf(ctx, hub);
  const out = [];
  for (let l = Math.max(1, hub.level - r); l <= Math.min(state.levels.length, hub.level + r); l++) out.push(l);
  return out;
}

/** Placement order: b2 before b10. */
export function byAge(a, b) {
  return idNumber(a.instanceId) - idNumber(b.instanceId);
}

function idNumber(id) {
  return Number(String(id).slice(1)) || 0;
}
