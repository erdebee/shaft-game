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
 * scaled by condition and staffing.
 *
 * Consumption is checked before production commits, so a building missing an
 * input produces nothing rather than producing from thin air — and that
 * missing input is reported, which is what makes a supply chain break legible.
 *
 * A building that went without is marked `starved`, which outputScale reads
 * next tick: a generator with no fuel stops generating, a scrubber with no
 * carbon stops scrubbing. The flag is this system's to write, and it is
 * decided from workScale, never from itself.
 */
export function tick(state, ctx) {
  const stocks = state.resources.stocks;
  const shortfalls = {};

  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;

    // Flow resources (power, water, air) are settled by their own systems.
    const inputs = (def.consumes ?? []).filter((c) => isStock(ctx, c.id));
    const outputs = (def.produces ?? []).filter((p) => isStock(ctx, p.id));
    if (inputs.length === 0 && outputs.length === 0) continue;

    // An idle building needs nothing, so it cannot be short of anything.
    const scale = workScale(instance, def, ctx);
    if (scale <= 0) {
      instance.starved = false;
      continue;
    }

    const multiplier = (id) => ctx.modifiers.multiply[`consumption:${id}`] ?? 1;

    const affordable = inputs.every((input) => {
      if (state.resources.cutSupplies.includes(input.id)) return false;
      return (stocks[input.id] ?? 0) >= input.qty * scale * multiplier(input.id);
    });

    instance.starved = !affordable;
    if (!affordable) {
      for (const input of inputs) {
        const need = input.qty * scale * multiplier(input.id);
        if ((stocks[input.id] ?? 0) < need) {
          shortfalls[input.id] = (shortfalls[input.id] ?? 0) + (need - (stocks[input.id] ?? 0));
        }
      }
      continue;
    }

    for (const input of inputs) {
      stocks[input.id] -= input.qty * scale * multiplier(input.id);
    }
    for (const output of outputs) {
      stocks[output.id] = (stocks[output.id] ?? 0) + output.qty * scale;
    }
  }

  applySpoilage(state, ctx);

  for (const [id, qty] of Object.entries(shortfalls).sort()) {
    ctx.emit('resource:shortfall', { id, qty });
  }
}

function isStock(ctx, id) {
  return Boolean(
    ctx.catalog.stocks.byId[id] ||
    ctx.catalog.components.byId[id] ||
    ctx.catalog.minerals.byId[id],
  );
}

function applySpoilage(state, ctx) {
  for (const id of ctx.catalog.stocks.ids) {
    const def = ctx.catalog.stocks.byId[id];
    const rate = (def.spoilagePerTick ?? 0) * (ctx.modifiers.multiply[`spoilage:${id}`] ?? 1);
    if (rate <= 0) continue;
    const amount = state.resources.stocks[id] ?? 0;
    if (amount > 0) state.resources.stocks[id] = amount * (1 - rate);
  }
}
