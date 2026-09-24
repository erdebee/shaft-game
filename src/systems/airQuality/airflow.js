/**
 * airflow.js
 * Air moved through the ducts, part of the `airQuality` system
 * (perLevelAir.js). Each duct fan is set to SUCK or BLOW. In each
 * ducted-together group:
 *
 *   - the sucking fans draw air off the unsealed levels they reach, as much
 *     as they can move (airflowPerTick) — but air only moves if something
 *     is blowing it out again, so the group moves the lesser of what its
 *     suckers can draw and its blowers can push
 *   - that air travels through the ducts, sucker to blower by the shortest
 *     run, and everything on the way works on it: a scrubber cleans it, an
 *     oxygen garden breathes into it, each sharing its capacity over all the
 *     air passing through it
 *   - the blowers push it out into the levels they reach, which take on its
 *     purity and oxygen in proportion to how much arrives against the
 *     level's volume (levelTemplate.airVolume)
 *   - a level being sucked is refilled from the stairwell, so it takes on
 *     the Shaft's average air instead of its own
 *
 * What a scrubber or garden has left over — all of it, when no air passes —
 * works on its own level.
 *
 * Writes level.airQuality and level.oxygen (the air system's own) and
 * state.resources.flows.air: the flow on every duct, what passes every
 * node, and how much air is blown into and drawn out of every level, which
 * is what the view draws.
 */

import { clamp } from '../../utils/math.js';
import { isHub, levelsServedBy } from '../infrastructure/networkGraph.js';

export const SUCK = 'suck';
export const BLOW = 'blow';

/** Which way a fan runs. A new fan blows. */
export function fanMode(instance) {
  return instance.fanMode === SUCK ? SUCK : BLOW;
}

export function initialAir() {
  return { links: {}, nodes: {}, levelIn: [], levelOut: [], moved: 0 };
}

/**
 * @param graph    the duct network (networkGraph.graphOf)
 * @param scaleOf  Map instanceId -> outputScale this tick
 * @returns the record for state.resources.flows.air
 */
export function settleAirflow(state, ctx, graph, scaleOf) {
  const levels = state.levels;
  const volume = ctx.tables?.levels?.levelTemplate?.airVolume ?? 100;
  const def = (i) => ctx.catalog.buildings.byId[i.buildingId];
  const record = { ...initialAir(), levelIn: new Array(levels.length + 1).fill(0), levelOut: new Array(levels.length + 1).fill(0) };

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
        .filter((n) => isHub(ctx, graph.networkId, n.buildingId) && scaleOf.get(n.instanceId) > 0)
        .map((n) => ({
          node: n,
          mode: fanMode(n),
          cap: (def(n).airflowPerTick ?? 0) * scaleOf.get(n.instanceId),
          levels: levelsServedBy(state, ctx, n).map((l) => levels[l - 1]).filter((l) => l && !l.sealed),
        }))
        .filter((f) => f.cap > 0 && f.levels.length > 0);
      const suckers = fans.filter((f) => f.mode === SUCK);
      const blowers = fans.filter((f) => f.mode === BLOW);
      const draw = suckers.reduce((s, f) => s + f.cap, 0);
      const push = blowers.reduce((s, f) => s + f.cap, 0);
      const moved = Math.min(draw, push);
      for (const f of fans) record.nodes[f.node.instanceId] = { mode: f.mode, flow: 0, capacity: f.cap, through: 0 };
      if (moved <= 0) continue;
      record.moved += moved;
      for (const f of suckers) f.flow = f.cap * moved / draw;
      for (const f of blowers) f.flow = f.cap * moved / push;

      // Every sucker sends to every blower in proportion, by the shortest run.
      const pairs = [];
      for (const s of suckers) {
        const routes = shortestRuns(graph, s.node.instanceId);
        for (const b of blowers) {
          const route = routes(b.node.instanceId);
          if (!route) continue;
          pairs.push({ s, b, flow: s.flow * b.flow / moved, route });
        }
      }
      // What passes each node, so a scrubber can share itself out.
      const through = new Map();
      for (const p of pairs) for (const id of p.route.nodes) through.set(id, (through.get(id) ?? 0) + p.flow);

      const arriving = new Map(); // blower -> { flow, airQuality, oxygen } weighted sums
      for (const p of pairs) {
        const air = { airQuality: mean(p.s.levels, 'airQuality'), oxygen: mean(p.s.levels, 'oxygen') };
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
      // Out into the blowers' levels, and in to the suckers' from the stairwell.
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
        const drawn = pairs.filter((p) => p.s === s).reduce((t, p) => t + p.flow, 0);
        record.nodes[s.node.instanceId].flow = drawn;
        const each = drawn / s.levels.length;
        for (const level of s.levels) {
          exchange(level, stair, each / volume);
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
 * Shortest duct run (in levels) from one node to every other, as a function
 * of the destination returning { nodes, links } along the way, or null.
 */
function shortestRuns(graph, fromId) {
  const dist = new Map([[fromId, 0]]);
  const prev = new Map();
  const open = new Set([fromId]);
  while (open.size) {
    let current = null;
    for (const id of open) if (current === null || dist.get(id) < dist.get(current)) current = id;
    open.delete(current);
    for (const { id, span, linkId } of graph.neighbours.get(current) ?? []) {
      const d = dist.get(current) + Math.max(1, span);
      if (d < (dist.get(id) ?? Infinity)) {
        dist.set(id, d);
        prev.set(id, { from: current, linkId });
        open.add(id);
      }
    }
  }
  return (toId) => {
    if (!dist.has(toId)) return null;
    const nodes = [toId];
    const links = [];
    let at = toId;
    while (at !== fromId) {
      const step = prev.get(at);
      links.unshift(step.linkId);
      nodes.unshift(step.from);
      at = step.from;
    }
    links.push(null);
    return { nodes, links };
  };
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
