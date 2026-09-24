/**
 * airflow.js
 * Air moved round its loop, part of the `airQuality` system
 * (perLevelAir.js). Each duct fan is set to SUCK or BLOW. The ducts come in
 * two lines: FOUL-AIR ducts carry what the suckers draw to the scrubbers,
 * and FRESH-AIR ducts carry it on from the scrubbers to the blowers — air
 * only moves round a loop that goes through a scrubber. In each
 * ducted-together group:
 *
 *   - the sucking fans draw air off the unsealed levels they reach, as much
 *     as they can move (airflowPerTick) — but air only moves if something
 *     is blowing it out again, so the group moves the lesser of what its
 *     suckers can draw and its blowers can push
 *   - that air travels the foul ducts to a scrubber and the fresh ducts on
 *     to a blower, by the shortest run, and everything on the way works on
 *     it: a scrubber cleans it, an oxygen garden breathes into it, each
 *     sharing its capacity over all the air passing through it
 *   - the blowers push it out into the levels they reach, which take on its
 *     purity and oxygen in proportion to how much arrives against the
 *     level's volume (levelTemplate.airVolume)
 *   - the air the blowers push out displaces their levels' own, which
 *     flows through the Shaft to refill the levels being sucked — so the
 *     loop moves air round and only the scrubbers and gardens change it
 *
 * What a scrubber or garden has left over — all of it, when no air passes —
 * works on its own level.
 *
 * Writes level.airQuality and level.oxygen (the air system's own) and
 * state.resources.flows.air: the flow on every duct, what passes every
 * node, how much air is blown into and drawn out of every level, and every
 * stream through the rooms from a blower back to a sucker — how clean it
 * left, how foul it came back, and the pollution it carried off — which is
 * what the view draws.
 */

import { clamp } from '../../utils/math.js';
import { isHub, levelsServedBy } from '../infrastructure/networkGraph.js';

/** The two duct lines of the air's loop. */
export const FOUL = 'foul-ducts';
export const FRESH = 'fresh-ducts';
export const AIR_LINES = [FOUL, FRESH];

export const SUCK = 'suck';
export const BLOW = 'blow';

/** Which way a fan runs. A new fan blows. */
export function fanMode(instance) {
  return instance.fanMode === SUCK ? SUCK : BLOW;
}

export function initialAir() {
  return { links: {}, nodes: {}, paths: [], levelIn: [], levelOut: [], moved: 0 };
}

/**
 * @param foul     the foul-air ducts (networkGraph.graphOf)
 * @param fresh    the fresh-air ducts
 * @param scaleOf  Map instanceId -> outputScale this tick
 * @returns the record for state.resources.flows.air
 */
export function settleAirflow(state, ctx, foul, fresh, scaleOf) {
  const levels = state.levels;
  const volume = ctx.tables?.levels?.levelTemplate?.airVolume ?? 100;
  const def = (i) => ctx.catalog.buildings.byId[i.buildingId];
  const record = { ...initialAir(), levelIn: new Array(levels.length + 1).fill(0), levelOut: new Array(levels.length + 1).fill(0) };
  const graph = loopOf(foul, fresh, (n) => (def(n).effects ?? []).some((e) => e.op === 'flow.scrub'));

  const scrubOf = (i) => {
    const e = (def(i).effects ?? []).find((x) => x.op === 'flow.scrub' && x.target === 'air-quality');
    return e ? e.value * scaleOf.get(i.instanceId) : 0;
  };
  const oxygenOf = (i) => (def(i).oxygenOutput ?? 0) * scaleOf.get(i.instanceId);
  const used = new Map(); // treatment node -> { scrub, oxygen } spent on passing air

  const open = levels.filter((l) => !l.sealed);
  const stair = {
    airQuality: mean(open, 'airQuality'),
    oxygen: mean(open, 'oxygen'),
  };

  if (graph.enforced) {
    for (const [, members] of graph.members) {
      const fans = members
        .filter((n) => isHub(ctx, foul.networkId, n.buildingId) && scaleOf.get(n.instanceId) > 0)
        .map((n) => ({
          node: n,
          mode: fanMode(n),
          cap: (def(n).airflowPerTick ?? 0) * scaleOf.get(n.instanceId),
          levels: levelsServedBy(state, ctx, n).map((l) => levels[l - 1]).filter((l) => l && !l.sealed),
        }))
        .filter((f) => f.cap > 0 && f.levels.length > 0);
      // Air only runs where the loop closes: foul ducts from a sucker into a
      // scrubber, fresh ducts out of it to a blower.
      const routed = [];
      for (const s of fans.filter((f) => f.mode === SUCK)) {
        const routes = loopRuns(graph, s.node.instanceId);
        for (const b of fans.filter((f) => f.mode === BLOW)) {
          const route = routes(b.node.instanceId);
          if (route) routed.push({ s, b, route });
        }
      }
      const suckers = [...new Set(routed.map((r) => r.s))];
      const blowers = [...new Set(routed.map((r) => r.b))];
      const draw = suckers.reduce((s, f) => s + f.cap, 0);
      const push = blowers.reduce((s, f) => s + f.cap, 0);
      const moved = Math.min(draw, push);
      for (const f of fans) record.nodes[f.node.instanceId] = { mode: f.mode, flow: 0, capacity: f.cap, through: 0 };
      if (moved <= 0) continue;
      record.moved += moved;
      for (const f of suckers) f.flow = f.cap * moved / draw;
      for (const f of blowers) f.flow = f.cap * moved / push;

      // Every sucker sends to every blower it reaches, in proportion.
      const pairs = routed.map(({ s, b, route }) => ({ s, b, flow: s.flow * b.flow / moved, route }));
      // What passes each node, so a scrubber can share itself out.
      const through = new Map();
      for (const p of pairs) for (const id of p.route.nodes) through.set(id, (through.get(id) ?? 0) + p.flow);

      const arriving = new Map(); // blower -> { flow, airQuality, oxygen } weighted sums
      for (const p of pairs) {
        const air = { airQuality: mean(p.s.levels, 'airQuality'), oxygen: mean(p.s.levels, 'oxygen') };
        p.intake = { ...air };
        for (let k = 0; k < p.route.nodes.length; k++) {
          const id = p.route.nodes[k];
          const node = graph.byId.get(id);
          const passing = through.get(id);
          const scrub = scrubOf(node);
          const breath = oxygenOf(node);
          if (scrub > 0 || breath > 0) {
            // A share of the node's capacity, in proportion to this air's
            // share of all the air through it; a point of quality on a
            // parcel of air costs parcel/volume of the node's capacity.
            const spent = used.get(id) ?? { scrub: 0, oxygen: 0 };
            const gainP = Math.min(100 - air.airQuality, (scrub * volume) / passing);
            const gainO = Math.min(100 - air.oxygen, (breath * volume) / passing);
            air.airQuality += gainP;
            air.oxygen += gainO;
            spent.scrub += (gainP * p.flow) / volume;
            spent.oxygen += (gainO * p.flow) / volume;
            used.set(id, spent);
          }
          const linkId = p.route.links[k];
          if (linkId) {
            const next = p.route.nodes[k + 1];
            const link = record.links[linkId] ??= { flow: 0, net: {}, airQuality: 0, oxygen: 0, weight: 0 };
            link.net[next] = (link.net[next] ?? 0) + p.flow;
            link.airQuality += air.airQuality * p.flow;
            link.oxygen += air.oxygen * p.flow;
            link.weight += p.flow;
          }
        }
        const arrive = arriving.get(p.b) ?? { flow: 0, airQuality: 0, oxygen: 0 };
        arrive.flow += p.flow;
        arrive.airQuality += air.airQuality * p.flow;
        arrive.oxygen += air.oxygen * p.flow;
        arriving.set(p.b, arrive);
      }

      for (const [id, t] of through) {
        record.nodes[id] ??= { mode: null, flow: 0, capacity: 0, through: 0 };
        record.nodes[id].through = t;
      }
      // The other half of the loop, through the rooms: what each blower
      // pushes out comes back, dirtied by the levels it crosses, to the
      // suckers. Blown clean, drawn in foul — the difference, in pollution
      // a tick, is what that stream carried off.
      for (const p of pairs) {
        const arrive = arriving.get(p.b);
        const blown = { airQuality: arrive.airQuality / arrive.flow, oxygen: arrive.oxygen / arrive.flow };
        record.paths.push({
          from: p.b.node.instanceId,
          to: p.s.node.instanceId,
          flow: p.flow,
          blown,
          drawn: p.intake,
          pickup: Math.max(0, ((blown.airQuality - p.intake.airQuality) * p.flow) / volume),
        });
      }
      // What the blowers push out displaces the air of their levels, and
      // that air — not new air — is what flows through the Shaft to refill
      // the levels the suckers draw from. So air is moved, never made: only
      // the scrubbers and gardens on the way change it.
      const displaced = new Map(blowers.map((b) => [b, { airQuality: mean(b.levels, 'airQuality'), oxygen: mean(b.levels, 'oxygen') }]));
      const refill = new Map();
      for (const p of pairs) {
        const r = refill.get(p.s) ?? { flow: 0, airQuality: 0, oxygen: 0 };
        const air = displaced.get(p.b);
        r.flow += p.flow;
        r.airQuality += air.airQuality * p.flow;
        r.oxygen += air.oxygen * p.flow;
        refill.set(p.s, r);
      }
      // Out into the blowers' levels, and in to the suckers'.
      for (const [b, arrive] of arriving) {
        record.nodes[b.node.instanceId].flow = arrive.flow;
        const air = { airQuality: arrive.airQuality / arrive.flow, oxygen: arrive.oxygen / arrive.flow };
        const each = arrive.flow / b.levels.length;
        for (const level of b.levels) {
          exchange(level, air, each / volume);
          record.levelIn[level.index] += each;
        }
      }
      for (const s of suckers) {
        const r = refill.get(s);
        const drawn = r.flow;
        record.nodes[s.node.instanceId].flow = drawn;
        const air = { airQuality: r.airQuality / r.flow, oxygen: r.oxygen / r.flow };
        const each = drawn / s.levels.length;
        for (const level of s.levels) {
          exchange(level, air, each / volume);
          record.levelOut[level.index] += each;
        }
      }
    }
  }

  // Net flow and the air in it, per duct: one direction, the stronger.
  for (const [id, link] of Object.entries(record.links)) {
    const [[toA, a] = [null, 0], [toB, b] = [null, 0]] = Object.entries(link.net);
    const forward = a >= b;
    record.links[id] = {
      flow: Math.abs(a - b),
      to: forward ? toA : toB,
      airQuality: link.weight ? link.airQuality / link.weight : 100,
      oxygen: link.weight ? link.oxygen / link.weight : 100,
    };
  }

  // What the scrubbers and gardens did not spend on passing air, they spend
  // where they stand — or, on an unlaid network, wherever it is worst.
  const reach = graph.enforced ? null : open;
  for (const node of state.buildings) {
    const scrub = def(node) ? scrubOf(node) : 0;
    const breath = def(node) && graph.byId.has(node.instanceId) ? oxygenOf(node) : 0;
    if (scrub <= 0 && breath <= 0) continue;
    const spent = used.get(node.instanceId) ?? { scrub: 0, oxygen: 0 };
    const where = reach ?? [levels[node.level - 1]].filter((l) => l && !l.sealed);
    if (scrub > spent.scrub) fill(where, 'airQuality', scrub - spent.scrub);
    if (breath > spent.oxygen) fill(where, 'oxygen', breath - spent.oxygen);
  }

  return record;
}

/** Mix `share` of a level's air with air of the given quality. */
function exchange(level, air, share) {
  const k = clamp(share, 0, 1);
  level.airQuality += (air.airQuality - level.airQuality) * k;
  level.oxygen += (air.oxygen - level.oxygen) * k;
}

function mean(levels, field) {
  return levels.length ? levels.reduce((s, l) => s + (l[field] ?? 100), 0) / levels.length : 100;
}

/**
 * Both duct lines as one loop: every node on either, grouped by what either
 * line joins, with each line's links kept apart for routing.
 */
function loopOf(foul, fresh, isScrubber) {
  const byId = new Map([...foul.byId, ...fresh.byId]);
  const nodes = [...byId.values()].sort(byAge);
  const both = new Map(nodes.map((n) => [n.instanceId, [
    ...(foul.neighbours.get(n.instanceId) ?? []),
    ...(fresh.neighbours.get(n.instanceId) ?? []),
  ]]));
  const members = new Map();
  const seen = new Set();
  for (const node of nodes) {
    if (seen.has(node.instanceId)) continue;
    const group = [];
    const queue = [node.instanceId];
    seen.add(node.instanceId);
    while (queue.length) {
      const id = queue.shift();
      group.push(byId.get(id));
      for (const { id: next } of both.get(id)) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    members.set(node.instanceId, group);
  }
  return {
    enforced: foul.enforced && fresh.enforced,
    byId,
    members,
    lines: [foul.neighbours, fresh.neighbours],
    isScrubber: (id) => isScrubber(byId.get(id)),
  };
}

/**
 * The shortest run (in levels) from a sucker round the loop to each blower:
 * along foul ducts until a scrubber, through it, and along fresh ducts from
 * there. Returns a function of the blower giving { nodes, links } along the
 * way — links[k] joins nodes[k] to nodes[k + 1] — or null if the loop does
 * not close.
 */
function loopRuns(graph, fromId) {
  const key = (id, line) => `${line}|${id}`;
  const start = key(fromId, 0);
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const open = new Set([start]);
  while (open.size) {
    let current = null;
    for (const k of open) if (current === null || dist.get(k) < dist.get(current)) current = k;
    open.delete(current);
    const line = Number(current[0]);
    const id = current.slice(2);
    const steps = (graph.lines[line].get(id) ?? []).map((n) => ({ to: key(n.id, line), cost: Math.max(1, n.span), linkId: n.linkId }));
    // Through a scrubber, foul air comes out on the fresh line.
    if (line === 0 && graph.isScrubber(id)) steps.push({ to: key(id, 1), cost: 0, linkId: null });
    for (const { to, cost, linkId } of steps) {
      const d = dist.get(current) + cost;
      if (d < (dist.get(to) ?? Infinity)) {
        dist.set(to, d);
        prev.set(to, { from: current, linkId });
        open.add(to);
      }
    }
  }
  return (toId) => {
    const end = key(toId, 1);
    if (!dist.has(end)) return null;
    const trail = [];
    for (let at = end; at; at = prev.get(at)?.from) trail.unshift({ id: at.slice(2), linkId: prev.get(at)?.linkId ?? null });
    // The step through a scrubber changes line, not place.
    const nodes = [];
    const links = [];
    for (const step of trail) {
      if (nodes.length && step.linkId === null) continue;
      if (nodes.length) links.push(step.linkId);
      nodes.push(step.id);
    }
    links.push(null);
    return { nodes, links };
  };
}

function byAge(a, b) {
  return (Number(String(a.instanceId).slice(1)) || 0) - (Number(String(b.instanceId).slice(1)) || 0);
}

/**
 * Spend capacity on a set of levels, filling the worst first. Levels are
 * topped up toward the next-worst in turn, so capacity spreads evenly across
 * equally bad levels rather than all landing on whichever was examined first.
 */
export function fill(levels, field, capacity) {
  const inReach = levels.filter((l) => l[field] < 100);
  let left = capacity;
  while (left > 1e-9 && inReach.length > 0) {
    inReach.sort((a, b) => a[field] - b[field] || a.index - b.index);
    const worst = inReach[0][field];
    const tied = inReach.filter((l) => l[field] - worst < 1e-9);
    const next = inReach.length > tied.length ? inReach[tied.length][field] : 100;
    const step = Math.min(next - worst, left / tied.length);
    for (const l of tied) l[field] += step;
    left -= step * tied.length;
    for (let i = inReach.length - 1; i >= 0; i--) {
      if (inReach[i][field] >= 100 - 1e-9) inReach.splice(i, 1);
    }
  }
  return left;
}
