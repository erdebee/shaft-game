/**
 * priorityLadder.js
 * The `power` system: the grid the player cables together, and who stays lit
 * when it cannot carry everyone.
 *
 *   generator ══HV══ junction ──LV── room          generator ══HV══ battery ══HV══ junction
 *            ══HV══ junction ──LV── room, room …
 *
 * A room draws through the junction its low-voltage wire is plugged into
 * (the power-lines network); a room on no wire is off the grid. A junction
 * is fed by the one high-voltage cable in its input socket. A junction carries at
 * most its network.capacity. Each cabled-together component of the grid is
 * settled on its own: its generators' output goes to its junctions in the
 * player's JUNCTION PRIORITY order (1 first, then 2 … 5), and within one
 * junction by the Accord's Order of Supply (the priority ladder — an Accord
 * article, so the player can rewrite it and live with the result). No
 * partial power: a room either runs or it does not.
 *
 * When the generators fall short, a battery covers the rooms still dark on
 * the junction its chain feeds — batteries sit in line, one cable in and
 * one out, and chain in series — and no others, until it is flat. A surplus
 * charges the component's batteries, a little a tick.
 *
 * Runs FIRST in SYSTEM_ORDER, because everything downstream needs to know what
 * is energised before it consumes anything. Owns state.resources.flows.power
 * and the `powered` field on each building instance — the one exception to
 * "systems write only their own domain", and it exists because whether a
 * building has power is a property of the grid, not of the building.
 *
 * Transmission loss scales with the high-voltage run from the generator to
 * the junction, plus the low-voltage wire from the junction to the room.
 */

import { outputScale, powerDemand } from '../buildings/buildingRegistry.js';
import { graphOf, feederOf, runFrom, VIRTUAL } from '../infrastructure/networkGraph.js';

const GRID = 'power-grid';
const LINES = 'power-lines';

/**
 * The ladder in force: whatever the Accord's Order of Supply article set, or
 * the config default when the player has not legislated one.
 */
export function currentLadder(state, ctx) {
  return state.governance.priorityLadder ?? ctx.config.power.defaultPriorityLadder;
}

/** A junction's priority, 1 (served first) to 5. */
export function priorityOf(instance, ctx) {
  return instance?.priority ?? ctx.config.power.defaultJunctionPriority ?? 3;
}

/** kW-ticks a battery holds when full. */
export function batteryCapacity(def) {
  return (def?.effects ?? []).find((e) => e.op === 'buffer.add' && e.target === 'power')?.value ?? 0;
}

/** kW a junction can carry. */
export function junctionCapacity(def) {
  return (def?.effects ?? []).find((e) => e.op === 'network.capacity' && e.target === GRID)?.value ?? Infinity;
}

export function initialPower() {
  return {
    generation: 0,
    demand: 0,
    available: 0,
    brownedOut: [],
    offGrid: [],      // drawing, but wired to no junction
    batteries: {},    // charge by battery instanceId
    junctions: {},    // by junction instanceId: { load, capacity, dark }
    batteryDraw: 0,
    stored: 0,
    storage: 0,
  };
}

export function tick(state, ctx) {
  const flow = state.resources.flows.power;
  Object.assign(flow, { ...initialPower(), batteries: flow.batteries ?? {} });

  const graph = graphOf(state, ctx, GRID);
  const lines = graphOf(state, ctx, LINES);
  const def = (i) => ctx.catalog.buildings.byId[i.buildingId];
  const ladder = currentLadder(state, ctx);
  const rank = new Map(ladder.map((cls, i) => [cls, i]));

  // --- the grid's parts, by component ------------------------------------
  const parts = new Map(); // component key -> { generators, batteries, generation }
  const partOf = (key) => {
    if (!parts.has(key)) parts.set(key, { generators: [], batteries: [], generation: 0, junctions: new Map() });
    return parts.get(key);
  };
  for (const node of graph.nodes) {
    const d = def(node);
    const part = partOf(graph.component.get(node.instanceId));
    const produced = (d.produces ?? []).find((p) => p.id === 'power');
    if (produced) {
      part.generators.push(node);
      // A generator is never browned out by its own grid.
      part.generation += produced.qty * outputScale({ ...node, powered: true }, d, ctx);
    }
    const capacity = batteryCapacity(d);
    if (capacity > 0) {
      flow.batteries[node.instanceId] = Math.min(capacity, flow.batteries[node.instanceId] ?? capacity);
      if (!node.brokenDown) part.batteries.push(node);
      flow.storage += capacity;
      flow.stored += flow.batteries[node.instanceId];
    }
  }
  // Generators off every grid still burn fuel for nothing; they count for
  // nothing here, which is the point of cabling them.
  for (const [key, part] of parts) {
    part.sources = [...part.generators, ...part.batteries];
    part.live = part.generation > 0 || part.batteries.some((b) => flow.batteries[b.instanceId] > 0);
    part.run = runFrom({ ...graph, nodes: graph.members.get(key) ?? [] }, part.sources);
  }
  const live = (key) => parts.get(key)?.live ?? false;
  const usable = (hub) => !hub.brokenDown;

  // --- who draws, and through which junction -----------------------------
  const lossPerLevel = ctx.config.power.transmissionLossPerLevel;
  const fallbackLevel = ctx.shaft.layout?.generatorLevel ?? 1;
  const consumers = [];
  for (const instance of state.buildings) {
    const d = def(instance);
    if (!d) continue;
    const base = powerDemand(instance, d, ctx, state);
    if (base <= 0) {
      // Drawing nothing this tick is not being browned out. Without this an
      // idle smelter that lost power mid-batch would stay dark forever: dark,
      // it cannot start a batch, and without a batch it never asks again.
      instance.powered = true;
      continue;
    }
    const hub = feederOf(lines, graph, ctx, instance, { usable, live });
    if (!hub) {
      instance.powered = false;
      flow.offGrid.push(instance.instanceId);
      flow.demand += base;
      continue;
    }
    const key = hub === VIRTUAL ? VIRTUAL : graph.component.get(hub.instanceId);
    const part = partOf(key);
    let cable;
    if (hub === VIRTUAL) {
      const nearest = part.generators.length ? part.generators : [{ level: fallbackLevel }];
      cable = Math.min(...nearest.map((g) => Math.abs(g.level - instance.level)));
    } else {
      cable = (part.run.get(hub.instanceId) ?? 0) + Math.abs(hub.level - instance.level);
    }
    const demand = base * (1 + cable * lossPerLevel);
    flow.demand += demand;
    const hubId = hub === VIRTUAL ? VIRTUAL : hub.instanceId;
    if (!part.junctions.has(hubId)) {
      part.junctions.set(hubId, {
        hub, consumers: [], load: 0,
        capacity: hub === VIRTUAL ? Infinity : junctionCapacity(def(hub)),
        priority: hub === VIRTUAL ? priorityOf(null, ctx) : priorityOf(hub, ctx),
      });
    }
    part.junctions.get(hubId).consumers.push({
      instance, demand, rank: rank.get(d.priorityClass ?? 'amenity') ?? ladder.length,
    });
  }

  // --- settle each component ----------------------------------------------
  const dark = [];
  for (const [, part] of [...parts].sort(([a], [b]) => a.localeCompare(b))) {
    const junctions = [...part.junctions.values()].sort((a, b) => a.priority - b.priority
      || (a.hub.level ?? 0) - (b.hub.level ?? 0) || String(a.hub.instanceId).localeCompare(String(b.hub.instanceId)));
    for (const j of junctions) {
      j.consumers.sort((a, b) => a.rank - b.rank || a.instance.level - b.instance.level
        || a.instance.instanceId.localeCompare(b.instance.instanceId));
    }

    // Generation first, junction by junction in priority order.
    let budget = part.generation;
    const unmet = new Map();
    for (const j of junctions) {
      for (const c of j.consumers) {
        if (c.demand <= budget && j.load + c.demand <= j.capacity) {
          budget -= c.demand;
          j.load += c.demand;
          c.instance.powered = true;
        } else {
          c.instance.powered = false;
          if (!unmet.has(j)) unmet.set(j, []);
          unmet.get(j).push(c);
        }
      }
    }

    // Then the batteries, each only for the junctions it is cabled to.
    for (const battery of part.batteries) {
      const cabled = backedBy(graph, battery);
      for (const j of junctions) {
        const backed = j.hub === VIRTUAL || cabled.has(j.hub.instanceId);
        if (!backed || !unmet.has(j)) continue;
        const still = [];
        for (const c of unmet.get(j)) {
          const charge = flow.batteries[battery.instanceId];
          if (c.demand <= charge && j.load + c.demand <= j.capacity) {
            flow.batteries[battery.instanceId] = charge - c.demand;
            flow.batteryDraw += c.demand;
            j.load += c.demand;
            c.instance.powered = true;
          } else still.push(c);
        }
        unmet.set(j, still);
      }
    }
    for (const list of unmet.values()) dark.push(...list);
    const delivered = part.generation - budget;

    // A surplus charges the batteries, a little a tick.
    const rate = ctx.config.power.batteryChargeRatePerTick;
    for (const battery of part.batteries) {
      const room = batteryCapacity(def(battery)) - flow.batteries[battery.instanceId];
      const charge = Math.min(room, rate, budget);
      if (charge <= 0) continue;
      flow.batteries[battery.instanceId] += charge;
      budget -= charge;
    }

    flow.generation += part.generation;
    flow.available += delivered;
    for (const j of junctions) {
      if (j.hub === VIRTUAL) continue;
      flow.junctions[j.hub.instanceId] = {
        load: j.load,
        capacity: j.capacity,
        dark: (unmet.get(j) ?? []).length,
        consumers: j.consumers.length,
      };
    }
  }
  flow.available += flow.batteryDraw;
  flow.stored = Object.values(flow.batteries).reduce((s, v) => s + v, 0);
  // Junctions no room draws through still report, so the panel can show them idle.
  for (const node of graph.nodes) {
    if (junctionCapacity(def(node)) === Infinity || flow.junctions[node.instanceId]) continue;
    flow.junctions[node.instanceId] = { load: 0, capacity: junctionCapacity(def(node)), dark: 0, consumers: 0 };
  }

  flow.brownedOut = dark.map((c) => c.instance.instanceId);
  if (dark.length > 0) {
    ctx.emit('power:shortfall', {
      generation: flow.generation,
      demand: flow.demand,
      shortfall: dark.reduce((s, c) => s + c.demand, 0),
      brownedOut: flow.brownedOut,
      levels: [...new Set(dark.map((c) => c.instance.level))].sort((a, b) => a - b),
    });
  }
}

/**
 * The junctions a battery backs: the ones its chain of batteries, wired in
 * series, is cabled to — every battery in a chain backs the junction at its
 * end, and no other.
 */
function backedBy(graph, battery) {
  const isBattery = (id) => graph.byId.get(id)?.buildingId === battery.buildingId;
  const seen = new Set([battery.instanceId]);
  const queue = [battery.instanceId];
  const junctions = new Set();
  while (queue.length) {
    for (const { id } of graph.neighbours.get(queue.shift()) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (isBattery(id)) queue.push(id);
      else junctions.add(id);
    }
  }
  return junctions;
}

/** Generation from every power-producing instance, scaled by its condition. */
export function totalGeneration(state, ctx) {
  let total = 0;
  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;
    const produced = (def.produces ?? []).find((p) => p.id === 'power');
    if (!produced) continue;
    const scale = outputScale({ ...instance, powered: true }, def, ctx);
    total += produced.qty * scale;
  }
  return total;
}
