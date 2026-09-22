/**
 * priorityLadder.js
 * When generation falls short of draw, this decides what stays lit. The ladder
 * is not hardcoded — it is an Accord article, so the player can rewrite it and
 * live with the result. Changing it mid-crisis is one of the sharper dilemmas.
 *
 * Runs FIRST in SYSTEM_ORDER, because everything downstream needs to know what
 * is energised before it consumes anything. Owns state.resources.flows.power
 * and the `powered` field on each building instance — the one exception to
 * "systems write only their own domain", and it exists because whether a
 * building has power is a property of the grid, not of the building.
 *
 * Transmission loss scales with distance from the generator, so a shallow
 * level served by a deep generator pays for every level in between.
 */

import { instancesOf } from '../../core/selectors.js';
import { outputScale, powerDemand } from '../buildings/buildingRegistry.js';

/**
 * The ladder in force: whatever the Accord's Order of Supply article set, or
 * the config default when the player has not legislated one.
 */
export function currentLadder(state, ctx) {
  return state.governance.priorityLadder ?? ctx.config.power.defaultPriorityLadder;
}

export function tick(state, ctx) {
  const generation = totalGeneration(state, ctx);
  const consumers = collectConsumers(state, ctx);
  const ladder = currentLadder(state, ctx);

  const demand = consumers.reduce((sum, c) => sum + c.demand, 0);

  // Batteries only cover a deficit; they do not add headroom when in surplus.
  const buffered = ctx.modifiers.buffer.power ?? 0;
  const available = generation + Math.min(buffered, Math.max(0, demand - generation));

  const brownedOut = allocate(consumers, ladder, available);

  // Anything drawing nothing this tick is not on the ladder, and so is not
  // browned out. Without this an idle smelter that lost power mid-batch would
  // stay dark forever: dark, it cannot start a batch, and without a batch it
  // never asks for power again.
  const drawing = new Set(consumers.map((c) => c.instanceId));
  for (const instance of state.buildings) {
    if (!drawing.has(instance.instanceId)) instance.powered = true;
  }

  const flow = state.resources.flows.power;
  flow.generation = generation;
  flow.demand = demand;
  flow.available = available;
  flow.brownedOut = brownedOut.map((c) => c.instanceId);

  if (brownedOut.length > 0) {
    ctx.emit('power:shortfall', {
      generation,
      demand,
      shortfall: demand - available,
      brownedOut: flow.brownedOut,
      levels: [...new Set(brownedOut.map((c) => c.level))].sort((a, b) => a - b),
    });
  }
}

/** Generation from every power-producing instance, scaled by its condition. */
export function totalGeneration(state, ctx) {
  let total = 0;
  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;
    const produced = (def.produces ?? []).find((p) => p.id === 'power');
    if (!produced) continue;
    // A generator is never browned out by its own grid.
    const scale = outputScale({ ...instance, powered: true }, def, ctx);
    total += produced.qty * scale;
  }
  return total;
}

/**
 * Every instance drawing power, with its transmission loss already applied.
 * Loss is charged against the consumer rather than the generator so that a
 * distant building genuinely costs more to supply.
 */
function collectConsumers(state, ctx) {
  const generatorLevel = ctx.shaft.layout?.generatorLevel
    ?? instancesOf(state, 'main-generator')[0]?.level
    ?? 1;
  const lossPerLevel = ctx.config.power.transmissionLossPerLevel;

  const consumers = [];
  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;

    const base = powerDemand(instance, def, ctx, state);
    if (base <= 0) continue;

    const distance = Math.abs(instance.level - generatorLevel);
    const loss = 1 + distance * lossPerLevel;

    consumers.push({
      instanceId: instance.instanceId,
      level: instance.level,
      priorityClass: def.priorityClass ?? 'amenity',
      demand: base * loss,
      instance,
    });
  }
  return consumers;
}

/**
 * Energise consumers from the top of the ladder down until the budget runs
 * out. Within a priority class, shallower levels are served first — arbitrary
 * but deterministic, and it means a brownout walks predictably downward
 * instead of scattering.
 *
 * Returns the consumers left unpowered.
 */
function allocate(consumers, ladder, available) {
  const rank = new Map(ladder.map((cls, i) => [cls, i]));
  const unranked = ladder.length;

  const ordered = [...consumers].sort((a, b) => {
    const ra = rank.get(a.priorityClass) ?? unranked;
    const rb = rank.get(b.priorityClass) ?? unranked;
    return ra - rb || a.level - b.level || a.instanceId.localeCompare(b.instanceId);
  });

  let budget = available;
  const brownedOut = [];

  for (const consumer of ordered) {
    if (consumer.demand <= budget) {
      budget -= consumer.demand;
      consumer.instance.powered = true;
    } else {
      // No partial power: a building either runs or it does not.
      consumer.instance.powered = false;
      brownedOut.push(consumer);
    }
  }

  return brownedOut;
}
