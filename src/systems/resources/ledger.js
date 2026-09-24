/**
 * ledger.js
 * What the Shaft makes and what it uses up, per good and per source: the
 * numbers behind "hydroponics make 180 food a day, the canteens eat 150".
 *
 * Every store only ever holds a quantity; how fast it is moving cannot be read
 * off it, and a stock that holds steady may be busy or idle. So the systems
 * that actually make or consume a good say so here, as they do it, naming
 * where it went — a building id, or one of the few sources that are not a
 * building:
 *
 *   people        eating (population/vitals.js)
 *   repairs       parts drawn for maintenance
 *   construction  a new room's materials
 *   spoilage      food rotting in store
 *   outside       what arrives through the Exit
 *   events        a decision or event that gave or took goods
 *
 * Hauling is NOT recorded. A porter moving coal from a depot to a smelter
 * neither makes nor uses any, and counting the pick-up and the drop-off would
 * report a busy supply line as production.
 *
 * Batches make the raw tally lumpy — a smelter turns out a billet every six
 * ticks and nothing in between — so once a tick roll() folds the tally into
 * a moving average over stores.rateWindowTicks, and the average is what the
 * UI reads. Both live in state, so a save carries its rates with it and a
 * reload does not open on a Shaft that appears to have stopped.
 */

/** Something was made: `qty` of good `id`, by `source`. */
export function made(state, id, qty, source) {
  add(state, 'made', id, qty, source);
}

/** Something was used up: `qty` of good `id`, by `source`. */
export function used(state, id, qty, source) {
  add(state, 'used', id, qty, source);
}

function add(state, side, id, qty, source) {
  if (!(qty > 0)) return;
  const tally = ledgerOf(state).tally;
  const entry = (tally[id] ??= { made: {}, used: {} });
  entry[side][source] = (entry[side][source] ?? 0) + qty;
}

/**
 * Fold everything tallied since the last roll into the averages, and start a
 * new tally. Runs once a tick, first thing in the resources system, so each
 * roll covers exactly one tick of every system — including the ones that run
 * after resources, and commands issued between ticks.
 */
export function roll(state, ctx) {
  const ledger = ledgerOf(state);
  const k = 1 / Math.max(1, ctx.config.stores.rateWindowTicks);
  const ids = new Set([...Object.keys(ledger.rates), ...Object.keys(ledger.tally)]);
  for (const id of ids) {
    const rate = (ledger.rates[id] ??= { made: {}, used: {} });
    const now = ledger.tally[id] ?? { made: {}, used: {} };
    for (const side of ['made', 'used']) {
      const sources = new Set([...Object.keys(rate[side]), ...Object.keys(now[side])]);
      for (const source of sources) {
        const next = (rate[side][source] ?? 0) + ((now[side][source] ?? 0) - (rate[side][source] ?? 0)) * k;
        // A source that has stopped decays toward zero forever; drop it once
        // it is too small to print, or the ledger only ever grows.
        if (next < 1e-6) delete rate[side][source];
        else rate[side][source] = next;
      }
    }
    if (!Object.keys(rate.made).length && !Object.keys(rate.used).length) delete ledger.rates[id];
  }
  ledger.tally = {};
}

/**
 * A good's current rates, per tick: by source, largest first, and in total.
 * `{ made: [[source, perTick]], used: [...], madeTotal, usedTotal }`.
 */
export function ratesOf(state, id) {
  const rate = state.resources.ledger?.rates?.[id] ?? { made: {}, used: {} };
  const sorted = (side) => Object.entries(rate[side]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const sum = (side) => Object.values(rate[side]).reduce((a, b) => a + b, 0);
  return { made: sorted('made'), used: sorted('used'), madeTotal: sum('made'), usedTotal: sum('used') };
}

export function initialLedger() {
  return { tally: {}, rates: {} };
}

/** Saves from before the ledger existed have none; they get an empty one. */
function ledgerOf(state) {
  return (state.resources.ledger ??= initialLedger());
}

/** What the sources that are not buildings are called on screen. */
const SOURCE_NAMES = {
  people: 'People',
  repairs: 'Repairs',
  construction: 'Construction',
  spoilage: 'Spoilage',
  outside: 'Deliveries from outside',
  events: 'Decisions and events',
  investigation: 'Investigations',
  amendments: 'Accord amendments',
  windows: 'Each amendment window',
};

export function sourceName(ctx, source) {
  return SOURCE_NAMES[source] ?? ctx.catalog.buildings.byId[source]?.name ?? source;
}

/**
 * Everything that COULD make or use a resource, from the catalogue alone —
 * so a tooltip can say "protein vats also make food" when none are built, and
 * the ledger's live rates hang off a list that does not flicker as sources
 * start and stop. Building ids first, in catalogue order, then the sources
 * that are not buildings.
 */
export function sourcesOf(ctx, id) {
  const madeBy = [];
  const usedBy = [];
  const add = (list, source) => { if (!list.includes(source)) list.push(source); };
  const recipes = ctx.catalog.recipes.all;
  const veins = new Set((ctx.shaft.veins ?? []).map((v) => v.id));

  for (const b of ctx.catalog.buildings.all) {
    const ops = (b.effects ?? []);
    if ((b.produces ?? []).some((p) => p.id === id)) add(madeBy, b.id);
    if ((b.consumes ?? []).some((c) => c.id === id)) add(usedBy, b.id);
    for (const r of recipes) {
      if (r.building !== b.id) continue;
      if (r.outputs.some((o) => o.id === id)) add(madeBy, b.id);
      if (r.inputs.some((i) => i.id === id)) add(usedBy, b.id);
    }
    if (veins.has(id) && ops.some((e) => e.op === 'extraction.enable')) add(madeBy, b.id);
    if (id === 'water' && ops.some((e) => e.op === 'reclamation.enable')) add(madeBy, b.id);
    if (ops.some((e) => e.op === 'flow.scrub' && e.target === id)) add(madeBy, b.id);
    // A duct fan makes no clean air of its own, but it is why the scrubbers'
    // air reaches anyone, and the player looking for "what helps" wants it.
    if (id === 'air-quality' && ops.some((e) => e.op === 'network.boost' && e.target === 'foul-ducts')) add(madeBy, b.id);
    if (ops.some((e) => e.op === 'focus.add' && e.target === id)) add(madeBy, b.id);
    if (b.receivesDeliveries && b.storeCapacity?.[id] !== undefined) add(madeBy, 'outside');
    if (id === 'labour' && b.staffing) add(usedBy, b.id);
    if (id === 'power' && ((b.powerDraw ?? 0) > 0 || recipes.some((r) => r.building === b.id && r.powerDraw > 0))) add(usedBy, b.id);
  }

  const buildable = ctx.catalog.buildings.all.some((b) => (b.repairCost ?? []).some((c) => c.id === id));
  if (buildable) {
    add(usedBy, 'repairs');
    add(usedBy, 'construction');
  }
  const stock = ctx.catalog.stocks.byId[id];
  if (stock?.spoilagePerTick > 0) add(usedBy, 'spoilage');
  if (id === 'food' || id === 'water' || id === 'air-quality') add(usedBy, 'people');
  if (id === 'labour') add(madeBy, 'people');
  if (id === 'focus') add(usedBy, 'investigation');
  if (id === 'authority') {
    add(madeBy, 'windows');
    add(usedBy, 'amendments');
  }
  return { madeBy, usedBy };
}
