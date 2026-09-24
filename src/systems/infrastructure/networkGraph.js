/**
 * networkGraph.js
 * The shape of the networks the player lays: which buildings are joined by
 * cable, wire, pipe, drain, feed line or duct, through which of their
 * sockets, and how far a network has to run to get somewhere.
 *
 * Every building on a network carries SOCKETS for it (catalog/infrastructure/
 * networks.json): a generator's high-voltage outputs, a junction's one
 * high-voltage input and its low-voltage outputs, a cistern's fresh-water,
 * sewage and feed sleeves, the one socket each room has on a feed network.
 * A link plugs one socket into another — an `out` into an `in`, an `any`
 * into anything — and a socket takes one link, so a hub hands out only as
 * many lines as it has sockets. Sockets sharing a `pool` are one sleeve on
 * several lines: a duct fan's one duct takes either air line.
 *
 * On a network with `taps` (the pipes, the drains, the ducts), a link may
 * instead run from a socket into the middle of another link — a TEE — so one
 * line serves several machines. A tee is a node of the graph with no
 * building: its id is `~` and the tapping link's id, and it sits on the
 * tapped run at the tapping building's level, or the run's nearer end if the
 * building is beyond it. The graph splits the tapped link at its tees, so
 * everything that walks it (runs, sewage downhill, the flow along a pipe)
 * goes through them. `nodes` and `members` hold buildings only; `byId` and
 * `neighbours` hold the tees too.
 *
 * Pure reads over state.infrastructure.links and the network catalogue. The
 * power, water and air systems each settle their own network over the graph
 * this returns; the UI reads the same graph to draw it, so what the player
 * sees wired is what the simulation uses. Writes nothing — links are made and
 * cut by commands.
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
  if (!net) return false;
  return net.connects.some((c) => c.from === buildingId || c.to === buildingId)
    || (net.sockets ?? []).some((s) => s.building === buildingId)
    || isUser(ctx, networkId, buildingId);
}

/**
 * Whether a building is at the far end of a feed network: it draws what the
 * network carries, so it has the one userSocket (power: a powerDraw or a
 * recipe; water: it consumes water).
 */
export function isUser(ctx, networkId, buildingId) {
  const net = networkDef(ctx, networkId);
  const def = ctx.catalog.buildings.byId[buildingId];
  if (!net?.users || !def || (net.hubs ?? []).includes(buildingId)) return false;
  switch (net.users) {
    case 'power':
      return (def.powerDraw ?? 0) > 0 || (def.effects ?? []).some((e) => e.op === 'recipe.enable');
    case 'water':
      return (def.consumes ?? []).some((c) => c.id === 'water');
    default:
      return false;
  }
}

/** A building's sockets on a network: [{ id, dir, count, label }], in catalogue order. */
export function socketsOf(ctx, networkId, buildingId) {
  const net = networkDef(ctx, networkId);
  if (!net) return [];
  const own = (net.sockets ?? []).filter((s) => s.building === buildingId);
  if (own.length) return own;
  return isUser(ctx, networkId, buildingId) ? [net.userSocket] : [];
}

/** Whether two sockets fit: an out into an in, an any into anything. */
export function fits(a, b) {
  if (!a || !b) return false;
  if (a.dir === 'any' || b.dir === 'any') return true;
  return (a.dir === 'in' && b.dir === 'out') || (a.dir === 'out' && b.dir === 'in');
}

/**
 * The socket a link's end is plugged into. A link laid before sockets
 * existed names none: it sits in the building's first socket.
 */
export function endSocket(ctx, link, instance) {
  const named = link.from === instance.instanceId ? link.fromSocket : link.toSocket;
  return named ?? socketsOf(ctx, link.network, instance.buildingId)[0]?.id ?? null;
}

/**
 * What is plugged into each of a building's sockets on a network:
 * Map socketId -> [link], each list in the order the links were laid, so
 * the n-th link of a kind sits in the n-th socket of that kind.
 */
export function socketUse(state, ctx, networkId, instance) {
  const kinds = socketsOf(ctx, networkId, instance.buildingId);
  const use = new Map(kinds.map((s) => [s.id, []]));
  // A pooled sleeve counts what is plugged into it on every line it serves.
  const lines = new Set([networkId]);
  for (const kind of kinds) for (const other of poolLines(ctx, instance.buildingId, kind)) lines.add(other);
  const pooled = new Set(kinds.filter((k) => k.pool).map((k) => k.id));
  for (const line of lines) {
    for (const link of linksOf(state, line)) {
      if (link.from !== instance.instanceId && link.to !== instance.instanceId) continue;
      const id = endSocket(ctx, link, instance);
      if (line !== networkId && !pooled.has(id)) continue;
      if (!use.has(id)) use.set(id, []);
      use.get(id).push(link);
    }
  }
  for (const list of use.values()) list.sort((a, b) => idNumber(a.id) - idNumber(b.id));
  return use;
}

/** Every line a pooled socket serves: the networks where the building has a socket of the same pool. */
export function poolLines(ctx, buildingId, socket) {
  if (!socket?.pool) return [];
  return (ctx.catalog.networks?.all ?? [])
    .filter((n) => (n.sockets ?? []).some((s) => s.building === buildingId && s.pool === socket.pool && s.id === socket.id))
    .map((n) => n.id);
}

/** Whether two buildings may be joined on a network at all, sockets aside. */
export function joins(ctx, networkId, a, b) {
  const net = networkDef(ctx, networkId);
  if (!net) return false;
  if (net.connects.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a))) return true;
  const hubs = net.hubs ?? [];
  return !!net.users && ((hubs.includes(a) && isUser(ctx, networkId, b)) || (hubs.includes(b) && isUser(ctx, networkId, a)));
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

/**
 * A network's links whose ends still stand: both buildings, or for a tap
 * its building and the link it taps. A riot can leave a stub.
 */
export function linksOf(state, networkId) {
  const standing = new Set(state.buildings.map((b) => b.instanceId));
  const kept = new Set();
  const out = [];
  for (const l of state.infrastructure?.links ?? []) {
    if (l.network !== networkId || !standing.has(l.from)) continue;
    if (l.tap ? !kept.has(l.tap) : !standing.has(l.to)) continue;
    kept.add(l.id);
    out.push(l);
  }
  return out;
}

/** The id of the tee a tapping link makes on the link it taps. */
export function teeOf(link) {
  return `~${link.id}`;
}

/** A link's two ends in the graph: its building, and its other building or its tee. */
export function endsOf(link) {
  return [link.from, link.tap ? teeOf(link) : link.to];
}

/**
 * Whether a building can tap a link — lay a line from one of its sockets
 * into the middle of it — and what it would cost. `fromSocket` names the
 * socket, or the first free one is taken. Returns { ok, reason, span, cost,
 * fromSocket, level }, `level` where the tee would sit; reason as canLink,
 * plus 'no-taps' on a network that cannot be branched and 'no-link' when
 * there is nothing to tap.
 */
export function canTap(state, ctx, networkId, fromId, hostId, { fromSocket = null } = {}) {
  const net = networkDef(ctx, networkId);
  const none = { span: 0, cost: [], fromSocket: null, level: null };
  if (!net) return { ok: false, reason: 'no-network', ...none };
  if (!net.taps) return { ok: false, reason: 'no-taps', ...none };
  const a = state.buildings.find((b) => b.instanceId === fromId);
  if (!a) return { ok: false, reason: 'no-building', ...none };
  const links = linksOf(state, networkId);
  const host = links.find((l) => l.id === hostId);
  if (!host) return { ok: false, reason: 'no-link', ...none };

  // The buildings the tapped run joins, through any runs it taps in turn.
  const byLink = new Map(links.map((l) => [l.id, l]));
  const building = (id) => state.buildings.find((b) => b.instanceId === id);
  const ends = [];
  for (let link = host; link; link = link.tap ? byLink.get(link.tap) : null) {
    ends.push(building(link.from));
    if (!link.tap) ends.push(building(link.to));
  }
  const hostLevels = [building(host.from).level, host.tap ? teeLevel(state, byLink, host) : building(host.to).level];
  const level = Math.min(Math.max(a.level, Math.min(...hostLevels)), Math.max(...hostLevels));
  const span = Math.abs(a.level - level);
  const cost = linkCost(ctx, networkId, span);
  const refuse = (reason) => ({ ok: false, reason, span, cost, fromSocket, level });
  if (ends.some((e) => e.instanceId === a.instanceId)) return refuse('same');
  if (!ends.some((e) => joins(ctx, networkId, a.buildingId, e.buildingId))) return refuse('cannot-join');

  const use = socketUse(state, ctx, networkId, a);
  const kinds = socketsOf(ctx, networkId, a.buildingId).filter((k) => !fromSocket || k.id === fromSocket);
  if (!kinds.length) return refuse('no-socket');
  const free = kinds.find((k) => (use.get(k.id)?.length ?? 0) < k.count);
  if (!free) return refuse('full');
  if (net.maxSpanLevels != null && span > net.maxSpanLevels) return { ...refuse('too-long'), fromSocket: free.id };
  return { ok: true, reason: null, span, cost, fromSocket: free.id, level };
}

/** Where a tapping link's tee sits: its building's level, clamped to the run it taps. */
function teeLevel(state, byLink, link) {
  const level = (id) => state.buildings.find((b) => b.instanceId === id)?.level;
  const host = byLink.get(link.tap);
  const a = level(host.from);
  const b = host.tap ? teeLevel(state, byLink, host) : level(host.to);
  return Math.min(Math.max(level(link.from), Math.min(a, b)), Math.max(a, b));
}

/** What a link of `span` levels costs to lay: at least one level's worth. */
export function linkCost(ctx, networkId, span) {
  const net = networkDef(ctx, networkId);
  const levels = Math.max(1, span);
  return (net?.linkCost ?? []).map((c) => ({ id: c.id, qty: Math.ceil(c.qtyPerLevel * levels) }));
}

/**
 * Whether two buildings can be linked on a network, and what it would cost.
 * `fromSocket` and `toSocket` name the sockets to plug into; either left out,
 * the first free socket that fits is taken.
 * Returns { ok, reason, span, cost, fromSocket, toSocket }; reason is one of
 * 'no-network', 'no-building', 'same', 'cannot-join', 'no-socket' (nothing
 * on one end fits the other), 'full' (what fits is all in use), 'too-long',
 * 'linked', or null. Paying is the caller's business (core/commands.js),
 * which also refuses on 'cost'.
 */
export function canLink(state, ctx, networkId, fromId, toId, { fromSocket = null, toSocket = null } = {}) {
  const net = networkDef(ctx, networkId);
  const none = { span: 0, cost: [], fromSocket: null, toSocket: null };
  if (!net) return { ok: false, reason: 'no-network', ...none };
  const a = state.buildings.find((b) => b.instanceId === fromId);
  const b = state.buildings.find((x) => x.instanceId === toId);
  if (!a || !b) return { ok: false, reason: 'no-building', ...none };
  const span = Math.abs(a.level - b.level);
  const cost = linkCost(ctx, networkId, span);
  const refuse = (reason) => ({ ok: false, reason, span, cost, fromSocket, toSocket });
  if (a === b) return refuse('same');
  if (!joins(ctx, networkId, a.buildingId, b.buildingId)) return refuse('cannot-join');
  const already = linksOf(state, networkId).some((l) => (l.from === fromId && l.to === toId) || (l.from === toId && l.to === fromId));
  if (already) return refuse('linked');

  // The sockets: the named ones, or the first pair that fits with room.
  const socketsA = socketsOf(ctx, networkId, a.buildingId).filter((s) => !fromSocket || s.id === fromSocket);
  const socketsB = socketsOf(ctx, networkId, b.buildingId).filter((s) => !toSocket || s.id === toSocket);
  const useA = socketUse(state, ctx, networkId, a);
  const useB = socketUse(state, ctx, networkId, b);
  const free = (s, use) => (use.get(s.id)?.length ?? 0) < s.count;
  // Left to choose, a link runs the way the catalogue has it: out of the
  // `from` building's side and into the `to` building's, so a pump laid to
  // a cistern takes the pump's out, and a plant laid to a pump its in.
  const flow = (sa, sb) => {
    const forward = net.connects.some((c) => c.from === a.buildingId && c.to === b.buildingId);
    const backward = net.connects.some((c) => c.from === b.buildingId && c.to === a.buildingId);
    if (forward === backward) return 0;
    const [out, into] = forward ? [sa, sb] : [sb, sa];
    return Number(out.dir === 'in') + Number(into.dir === 'out');
  };
  let fitting = false;
  let pair = null;
  let best = Infinity;
  for (const sa of socketsA) {
    for (const sb of socketsB) {
      if (!fits(sa, sb)) continue;
      fitting = true;
      if (!free(sa, useA) || !free(sb, useB)) continue;
      const wrong = flow(sa, sb);
      if (wrong < best) { best = wrong; pair = [sa.id, sb.id]; }
    }
  }
  if (!fitting) return refuse('no-socket');
  if (!pair) return refuse('full');
  if (net.maxSpanLevels != null && span > net.maxSpanLevels) return { ...refuse('too-long'), fromSocket: pair[0], toSocket: pair[1] };
  return { ok: true, reason: null, span, cost, fromSocket: pair[0], toSocket: pair[1] };
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
  const byId = new Map(nodes.map((n) => [n.instanceId, n]));
  const neighbours = new Map(nodes.map((n) => [n.instanceId, []]));
  const tees = [];
  const laid = enforced(ctx, networkId);

  if (laid) {
    const links = linksOf(state, networkId).filter((l) => byId.has(l.from) && (l.tap || byId.has(l.to)));
    const byLink = new Map(links.map((l) => [l.id, l]));
    // The tees, each where its tapping link meets the run it taps.
    for (const link of links) {
      if (!link.tap || !byLink.has(link.tap)) continue;
      const tee = { instanceId: teeOf(link), level: teeLevel(state, byLink, link), tee: true, link: link.id, host: link.tap };
      tees.push(tee);
      byId.set(tee.instanceId, tee);
      neighbours.set(tee.instanceId, []);
    }
    // Every link, split at the tees on it, in order from its first end.
    for (const link of links) {
      if (link.tap && !byLink.has(link.tap)) continue;
      const [first, last] = endsOf(link).map((id) => byId.get(id));
      const start = first.level;
      const on = tees.filter((t) => t.host === link.id)
        .sort((p, q) => Math.abs(p.level - start) - Math.abs(q.level - start) || idNumber(p.link) - idNumber(q.link));
      const chain = [first, ...on, last];
      for (let k = 0; k < chain.length - 1; k++) {
        const p = chain[k];
        const q = chain[k + 1];
        const span = Math.abs(p.level - q.level);
        neighbours.get(p.instanceId).push({ id: q.instanceId, span, linkId: link.id, toward: last.instanceId });
        neighbours.get(q.instanceId).push({ id: p.instanceId, span, linkId: link.id, toward: first.instanceId });
      }
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
        const at = byId.get(id);
        if (!at.tee) group.push(at);
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

  return { networkId, enforced: laid, nodes, tees, byId, neighbours, component, members };
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
 * The shortest run of links (fewest levels) from one node to the nearest node
 * `isEnd` accepts, optionally only ever going down. Returns the steps,
 * [{ linkId, to, toward }] in order (`toward` the end of the link the step
 * heads for — a tee splits a link into several steps), [] when the start is itself an end, or null
 * when no end can be reached. On an unenforced network there are no links
 * to follow, so it is always null.
 */
export function pathTo(graph, fromId, isEnd, { downhill = false } = {}) {
  if (!graph.enforced || !graph.byId.has(fromId)) return null;
  const dist = new Map([[fromId, 0]]);
  const prev = new Map();
  const open = new Set([fromId]);
  while (open.size) {
    let id = null;
    for (const k of open) if (id === null || dist.get(k) < dist.get(id)) id = k;
    open.delete(id);
    if (!graph.byId.get(id).tee && isEnd(graph.byId.get(id))) {
      const steps = [];
      for (let at = id; prev.has(at); at = prev.get(at).from) steps.unshift({ linkId: prev.get(at).linkId, to: at, toward: prev.get(at).toward });
      return steps;
    }
    const here = graph.byId.get(id);
    for (const { id: next, span, linkId, toward } of graph.neighbours.get(id) ?? []) {
      if (downhill && graph.byId.get(next).level < here.level) continue;
      const d = dist.get(id) + Math.max(1, span);
      if (d < (dist.get(next) ?? Infinity)) {
        dist.set(next, d);
        prev.set(next, { from: id, linkId, toward });
        open.add(next);
      }
    }
  }
  return null;
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

/**
 * The hub a building draws a feed network through: the junction its wire
 * runs to, the cistern its feed line runs to. `feed` is the feed network's
 * graph and `trunk` the graph the hubs hang off (the high-voltage grid, the
 * water mains), whose components `live` is asked about. Unlaid trunk: the
 * VIRTUAL hub. Unlaid feeds: the nearest usable hub at any distance, as if
 * every room were wired to it. Returns the hub instance, VIRTUAL, or null
 * when the building is plugged into nothing that works.
 */
export function feederOf(feed, trunk, ctx, instance, { usable = () => true, live = () => true } = {}) {
  if (!trunk.enforced) return VIRTUAL;
  const hubs = feed.enforced
    ? (feed.neighbours.get(instance.instanceId) ?? []).map((n) => feed.byId.get(n.id))
    : feed.nodes;
  let best = null;
  let bestScore = null;
  for (const hub of hubs) {
    if (!hub || !isHub(ctx, feed.networkId, hub.buildingId) || !usable(hub)) continue;
    const score = [live(trunk.component.get(hub.instanceId)) ? 0 : 1, Math.abs(hub.level - instance.level)];
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
