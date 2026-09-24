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
 *   - the blowers push it out through their vents, and the suckers draw it
 *     in through theirs; between the two it has to go through the Shaft,
 *     up or down the stairwell, level by level (shaftFlow) — and every level
 *     it crosses mixes it into its own air and hands on the mixture. So a
 *     level is aired by what flows past it: one outside every stream, or
 *     between two blowers pushing at each other, is barely aired at all
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
  return { links: {}, nodes: {}, paths: [], levelIn: [], levelOut: [], through: [], shaft: [], moved: 0 };
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
  const vents = []; // level -> { in, out, airQuality, oxygen (weighted), blowers, suckers }

  const open = levels.filter((l) => !l.sealed);

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
      // Out through the blowers' vents, in through the suckers'.
      for (const [b, arrive] of arriving) {
        record.nodes[b.node.instanceId].flow = arrive.flow;
        const each = arrive.flow / b.levels.length;
        for (const level of b.levels) {
          const v = vents[level.index] ??= { in: 0, out: 0, airQuality: 0, oxygen: 0, blowers: [], suckers: [] };
          v.in += each;
          v.airQuality += (arrive.airQuality / arrive.flow) * each;
          v.oxygen += (arrive.oxygen / arrive.flow) * each;
          v.blowers.push({ id: b.node.instanceId, flow: each, air: { airQuality: arrive.airQuality / arrive.flow, oxygen: arrive.oxygen / arrive.flow } });
        }
      }
      for (const s of suckers) {
        record.nodes[s.node.instanceId].flow = s.flow;
        const each = s.flow / s.levels.length;
        for (const level of s.levels) {
          const v = vents[level.index] ??= { in: 0, out: 0, airQuality: 0, oxygen: 0, blowers: [], suckers: [] };
          v.out += each;
          v.suckers.push({ id: s.node.instanceId, flow: each });
        }
      }
    }
  }

  // The other half of the loop is the Shaft itself: what the blowers push
  // out has to get to the suckers, up or down the stairwell, through every
  // level between — and nowhere else.
  const shaft = shaftFlow(levels, vents, volume);
  record.levelIn = shaft.levelIn;
  record.levelOut = shaft.levelOut;
  record.shaft = shaft.flux;
  record.through = shaft.through;
  record.paths = streamsOf(vents, levels, volume);

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

/**
 * The air through the Shaft, from the blowers' vents to the suckers'. The
 * stairwell is one column, so what crosses between two levels is fixed:
 * everything blown in above the gap less everything drawn out above it
 * (positive runs down). Each level, taken upstream first, mixes what flows
 * into it — from its vents and from its neighbours — into its own air, and
 * passes its air on. A level no flow crosses keeps its air; one between two
 * blowers pushing at each other gets only what the difference leaves it.
 * A sealed level lets the flow by without mixing into it.
 *
 * Returns per level: levelIn, levelOut (its vents), through (everything
 * that flowed into it) and flux[i] (across the gap below level i).
 */
function shaftFlow(levels, vents, volume) {
  const n = levels.length;
  const levelIn = new Array(n + 1).fill(0);
  const levelOut = new Array(n + 1).fill(0);
  const through = new Array(n + 1).fill(0);
  const flux = new Array(n + 1).fill(0);
  const EPS = 1e-6;
  let running = 0;
  for (let i = 1; i <= n; i++) {
    levelIn[i] = vents[i]?.in ?? 0;
    levelOut[i] = vents[i]?.out ?? 0;
    running += levelIn[i] - levelOut[i];
    flux[i] = i < n && Math.abs(running) > EPS ? running : 0;
  }
  // Upstream first: a level is taken once whatever flows into it has been.
  const waiting = new Array(n + 2).fill(0);
  for (let i = 1; i < n; i++) {
    if (flux[i] > 0) waiting[i + 1]++;
    else if (flux[i] < 0) waiting[i]++;
  }
  const ready = [];
  for (let i = 1; i <= n; i++) if (!waiting[i]) ready.push(i);
  const out = new Array(n + 2).fill(null);
  while (ready.length) {
    const i = ready.shift();
    const level = levels[i - 1];
    const parts = [];
    const v = vents[i];
    if (v?.in > 0) parts.push([v.in, { airQuality: v.airQuality / v.in, oxygen: v.oxygen / v.in }]);
    if (i > 1 && flux[i - 1] > 0) parts.push([flux[i - 1], out[i - 1]]);
    if (i < n && flux[i] < 0) parts.push([-flux[i], out[i + 1]]);
    const total = parts.reduce((t, [f]) => t + f, 0);
    through[i] = total;
    if (total > 0) {
      const mix = {
        airQuality: parts.reduce((t, [f, a]) => t + f * a.airQuality, 0) / total,
        oxygen: parts.reduce((t, [f, a]) => t + f * a.oxygen, 0) / total,
      };
      if (level.sealed) out[i] = mix;
      else exchange(level, mix, total / volume);
    }
    out[i] ??= { airQuality: level.airQuality, oxygen: level.oxygen };
    if (i < n && flux[i] > 0 && !--waiting[i + 1]) ready.push(i + 1);
    if (i > 1 && flux[i - 1] < 0 && !--waiting[i - 1]) ready.push(i - 1);
  }
  return { levelIn, levelOut, through, flux };
}

/**
 * The flow through the Shaft as streams from a blower to a sucker, for the
 * view to draw. The blown air, lowest level last, meets the drawn air in
 * the same order — so no two streams cross, and together they are exactly
 * the flow up and down the stairwell. Each carries how clean it was blown
 * out, how foul the sucker's level is when it gets there, and the pollution
 * it took away with it, a tick.
 */
function streamsOf(vents, levels, volume) {
  const supply = [];
  const demand = [];
  vents.forEach((v, level) => {
    if (!v) return;
    for (const b of v.blowers) supply.push({ ...b, level, left: b.flow });
    for (const s of v.suckers) demand.push({ ...s, level, left: s.flow });
  });
  const pairs = new Map();
  let i = 0;
  let j = 0;
  while (i < supply.length && j < demand.length) {
    const b = supply[i];
    const s = demand[j];
    const f = Math.min(b.left, s.left);
    if (f > 1e-9) {
      const key = `${b.id}>${s.id}`;
      const p = pairs.get(key) ?? { from: b.id, to: s.id, flow: 0, bq: 0, bo: 0, dq: 0, do: 0 };
      const at = levels[s.level - 1];
      p.flow += f;
      p.bq += b.air.airQuality * f;
      p.bo += b.air.oxygen * f;
      p.dq += at.airQuality * f;
      p.do += at.oxygen * f;
      pairs.set(key, p);
    }
    b.left -= f;
    s.left -= f;
    if (b.left <= 1e-9) i++;
    if (s.left <= 1e-9) j++;
  }
  return [...pairs.values()].map((p) => {
    const blown = { airQuality: p.bq / p.flow, oxygen: p.bo / p.flow };
    const drawn = { airQuality: p.dq / p.flow, oxygen: p.do / p.flow };
    return { from: p.from, to: p.to, flow: p.flow, blown, drawn, pickup: Math.max(0, ((blown.airQuality - drawn.airQuality) * p.flow) / volume) };
  });
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
