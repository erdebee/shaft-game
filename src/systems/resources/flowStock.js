/**
 * flowStock.js
 * Generic stock-and-flow accounting. A stock holds a quantity with a cap; a
 * flow moves quantity per tick. Shortfalls are reported rather than silently
 * clamped, because who goes without is a governance decision, not a maths one.
 *
 * Also the `resources` system: runs each powered building's produces/consumes
 * into the stock ledger. Runs after power, so a browned-out building produces
 * nothing — which is the whole reason power is first in SYSTEM_ORDER.
 */

import { workScale } from '../buildings/buildingRegistry.js';
import { isGood, amount, room, put, take } from './stores.js';
import { made, used } from './ledger.js';

export function createStock(id, { capacity, initial = 0 }) {
  return { id, capacity, amount: initial };
}

/**
 * Apply inflows and outflows for one tick. Returns unmet demand by consumer.
 *
 * Demands are served in the order given — the caller decides priority, since
 * that is a governance question. Allocation is proportional only within the
 * last partially-served demand, so a consumer either gets what it asked for or
 * is explicitly recorded as short.
 *
 * @param {{amount: number, capacity: number}} stock  mutated in place
 * @param {Array<{id: string, qty: number}>} inflows
 * @param {Array<{id: string, qty: number}>} demands  in priority order
 * @returns {{shortfall: Record<string, number>, spill: number, served: Record<string, number>}}
 */
export function settle(stock, inflows = [], demands = []) {
  const totalIn = inflows.reduce((sum, f) => sum + f.qty, 0);

  const capacity = stock.capacity ?? Infinity;
  const room = capacity - stock.amount;
  const accepted = Math.min(totalIn, Math.max(0, room));
  const spill = totalIn - accepted;
  stock.amount += accepted;

  const shortfall = {};
  const served = {};

  for (const demand of demands) {
    const given = Math.min(demand.qty, stock.amount);
    stock.amount -= given;
    served[demand.id] = (served[demand.id] ?? 0) + given;
    if (given < demand.qty) {
      shortfall[demand.id] = (shortfall[demand.id] ?? 0) + (demand.qty - given);
    }
  }

  return { shortfall, spill, served };
}

/**
 * The resources system. Production and consumption for every placed building,
 * scaled by condition and staffing — out of and into the building's OWN store
 * (stores.js). Nothing here reaches a pile somewhere else in the Shaft: what
 * is not in the building's store has to be carried there.
 *
 * Consumption is checked before production commits, so a building missing an
 * input produces nothing rather than producing from thin air. It is marked
 * `starved`, with the goods it lacks in `missing`, which outputScale reads
 * next tick: a generator with no fuel stops generating, a scrubber with no
 * carbon stops scrubbing. A building whose output store is full makes only
 * what fits, and is marked `blocked`, with the goods in `full`: nobody has
 * come to collect. Both flags are this system's to write, decided from
 * workScale, never from themselves.
 */
export function tick(state, ctx) {
  const shortfalls = {};

  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;

    // Flow resources (power, water, air) are settled by their own systems.
    const inputs = (def.consumes ?? []).filter((c) => isGood(ctx, c.id));
    const outputs = (def.produces ?? []).filter((p) => isGood(ctx, p.id));
    if (inputs.length === 0 && outputs.length === 0) continue;

    // An idle building needs nothing, so it cannot be short of anything.
    const work = workScale(instance, def, ctx);
    if (work <= 0) {
      setWaiting(instance, [], [], ctx);
      continue;
    }

    // Output room first: a building with nowhere to put its produce works
    // only as hard as the room it has.
    let scale = work;
    const full = [];
    for (const output of outputs) {
      const space = room(instance, def, ctx, output.id);
      const wanted = output.qty * work;
      if (space < wanted) {
        full.push(output.id);
        scale = Math.min(scale, wanted > 0 ? work * (space / wanted) : 0);
      }
    }

    const multiplier = (id) => ctx.modifiers.multiply[`consumption:${id}`] ?? 1;
    const missing = inputs
      .filter((input) => state.resources.cutSupplies.includes(input.id) ||
        amount(instance, input.id) < input.qty * scale * multiplier(input.id))
      .map((input) => input.id);

    setWaiting(instance, missing, full, ctx);
    if (missing.length > 0) {
      for (const input of inputs) {
        const need = input.qty * scale * multiplier(input.id);
        const short = need - amount(instance, input.id);
        if (short > 0) shortfalls[input.id] = (shortfalls[input.id] ?? 0) + short;
      }
      continue;
    }
    if (scale <= 0) continue;

    for (const input of inputs) used(state, input.id, take(instance, input.id, input.qty * scale * multiplier(input.id)), def.id);
    for (const output of outputs) made(state, output.id, put(instance, def, ctx, output.id, output.qty * scale), def.id);
  }

  applySpoilage(state, ctx);

  for (const [id, qty] of Object.entries(shortfalls).sort()) {
    ctx.emit('resource:shortfall', { id, qty });
  }
}

/**
 * Record why a building is waiting, and say so once when it starts: a
 * building:starved or building:blocked event on the tick it begins, not every
 * tick it lasts. Shared by every system that runs buildings off their stores.
 */
export function setWaiting(instance, missing, full, ctx) {
  const wasStarved = instance.starved === true;
  const wasBlocked = instance.blocked === true;
  instance.starved = missing.length > 0;
  instance.missing = missing;
  instance.full = full;
  instance.blocked = full.length > 0;
  const where = { instanceId: instance.instanceId, buildingId: instance.buildingId, level: instance.level };
  if (instance.starved && !wasStarved) ctx?.emit('building:starved', { ...where, missing });
  if (instance.blocked && !wasBlocked) ctx?.emit('building:blocked', { ...where, full });
}

/** Food rots wherever it is kept, slower where food processing works. */
function applySpoilage(state, ctx) {
  for (const id of ctx.catalog.stocks.ids) {
    const def = ctx.catalog.stocks.byId[id];
    const rate = (def.spoilagePerTick ?? 0) * (ctx.modifiers.multiply[`spoilage:${id}`] ?? 1);
    if (rate <= 0) continue;
    for (const holder of [...state.buildings, ...state.population.workers]) {
      const store = holder.stock ?? holder.carrying;
      if (!(store?.[id] > 0)) continue;
      used(state, id, store[id] * rate, 'spoilage');
      store[id] *= 1 - rate;
    }
  }
}
