/**
 * stores.js
 * Local supply. Every physical good in the Shaft — food, scrap, wood, paper,
 * ore, coal, fuel, carbon, steel, parts — sits in some building's own store
 * (`instance.stock`, a map of good id to quantity) or in a porter's hands.
 * There is no Shaft-wide pile: a canteen eats the food in its own larder,
 * a smelter burns the coal in its own bunker, and a porter has to carry it
 * there.
 *
 * What a building can hold:
 *   STORAGE  a depot or storehouse (`storage.capacity`): any mix of goods, up
 *            to its capacity in total.
 *   INPUTS   what it consumes (or its recipes consume): stores.inputBufferTicks
 *            of consumption, or stores.batchesBuffered batches.
 *   OUTPUTS  what it produces (or its recipes or its dig face yield):
 *            stores.outputBufferTicks of production, or batchesBuffered
 *            batches. When an output is full the building stops: BLOCKED.
 * A catalogue `storeCapacity` map overrides any of these per good — a
 * canteen's larder, the Exit's receiving bay.
 *
 * Power, water and air are networks, not goods, and never pass through here.
 *
 * Pure bookkeeping: no system owns stores as a whole. Each system moves goods
 * in and out of the stores of the buildings it runs, through put/take, so a
 * store can never go negative or overflow.
 */

import { recipesFor } from './componentChain.js';

/** Physical goods: anything in the stocks, minerals or components catalogues. */
export function isGood(ctx, id) {
  return Boolean(ctx.catalog.stocks.byId[id] || ctx.catalog.minerals.byId[id] || ctx.catalog.components.byId[id]);
}

export function amount(instance, id) {
  return instance.stock?.[id] ?? 0;
}

/** Total units held by a storage building, across all goods. */
function held(instance) {
  let total = 0;
  for (const qty of Object.values(instance.stock ?? {})) total += qty;
  return total;
}

export function isStorage(def) {
  return Boolean(def?.storage?.capacity);
}

/**
 * How much of a good an instance can hold in total. 0 means it has no place
 * for it at all — a porter cannot drop steel at a canteen.
 */
export function capacity(instance, def, ctx, id) {
  if (!def) return 0;
  if (def.storeCapacity?.[id] !== undefined) return def.storeCapacity[id];
  if (isStorage(def)) return def.storage.capacity;

  const cfg = ctx.config.stores;
  let cap = 0;
  for (const c of def.consumes ?? []) if (c.id === id) cap = Math.max(cap, c.qty * cfg.inputBufferTicks);
  for (const p of def.produces ?? []) if (p.id === id) cap = Math.max(cap, p.qty * cfg.outputBufferTicks);
  for (const r of recipesFor(def.id, ctx)) {
    for (const io of [...r.inputs, ...r.outputs]) if (io.id === id) cap = Math.max(cap, io.qty * cfg.batchesBuffered);
  }
  if (extracts(def)) {
    const vein = (ctx.shaft.veins ?? []).find((v) => v.id === id);
    if (vein) cap = Math.max(cap, ctx.config.mining.baseYieldPerTick * vein.abundance * cfg.outputBufferTicks);
  }
  return cap;
}

/** Room left for a good. Storage shares one capacity across every good. */
export function room(instance, def, ctx, id) {
  if (isStorage(def) && def.storeCapacity?.[id] === undefined) return Math.max(0, def.storage.capacity - held(instance));
  return Math.max(0, capacity(instance, def, ctx, id) - amount(instance, id));
}

/** Put up to `qty` in; returns what was accepted. */
export function put(instance, def, ctx, id, qty) {
  const accepted = Math.max(0, Math.min(qty, room(instance, def, ctx, id)));
  if (accepted > 0) {
    instance.stock ??= {};
    instance.stock[id] = amount(instance, id) + accepted;
  }
  return accepted;
}

/** Take up to `qty` out; returns what was taken. Empty entries are removed. */
export function take(instance, id, qty) {
  const taken = Math.max(0, Math.min(qty, amount(instance, id)));
  if (taken > 0) {
    instance.stock[id] -= taken;
    if (instance.stock[id] <= 1e-9) delete instance.stock[id];
  }
  return taken;
}

/** Every unit of a good in the Shaft: in stores and in porters' hands. */
export function total(state, id) {
  let sum = 0;
  for (const b of state.buildings) sum += b.stock?.[id] ?? 0;
  for (const w of state.population.workers) sum += w.carrying?.[id] ?? 0;
  return sum;
}

/** Every good's total, as one map — for the dashboard and the sim runner. */
export function totals(state) {
  const out = {};
  const add = (stock) => { for (const [id, qty] of Object.entries(stock ?? {})) out[id] = (out[id] ?? 0) + qty; };
  for (const b of state.buildings) add(b.stock);
  for (const w of state.population.workers) add(w.carrying);
  return out;
}

/**
 * Storage buildings — depots and storehouses — nearest the given level first.
 * The Shaft's common stores: what repair crews and builders draw on.
 */
export function storehouses(state, ctx, nearLevel = null) {
  const found = state.buildings.filter((b) => isStorage(ctx.catalog.buildings.byId[b.buildingId]) && !b.brokenDown);
  if (nearLevel !== null) {
    found.sort((a, b) => Math.abs(a.level - nearLevel) - Math.abs(b.level - nearLevel) || a.instanceId.localeCompare(b.instanceId));
  }
  return found;
}

/** How much of a good the common stores hold. */
export function inStorehouses(state, ctx, id) {
  return storehouses(state, ctx).reduce((sum, b) => sum + amount(b, id), 0);
}

/** Take from the common stores, nearest first. Returns what was taken. */
export function takeFromStorehouses(state, ctx, id, qty, nearLevel = null) {
  let left = qty;
  for (const b of storehouses(state, ctx, nearLevel)) {
    if (left <= 0) break;
    left -= take(b, id, left);
  }
  return qty - left;
}

/** Put into the common stores, nearest first. Returns what fit. */
export function putInStorehouses(state, ctx, id, qty, nearLevel = null) {
  let left = qty;
  for (const b of storehouses(state, ctx, nearLevel)) {
    if (left <= 0) break;
    left -= put(b, ctx.catalog.buildings.byId[b.buildingId], ctx, id, left);
  }
  return qty - left;
}

/**
 * What to call a resource on screen: the catalogue's name for it, whatever
 * kind it is, or the id itself if it names nothing. `missing` and `full` hold
 * ids, and an id is a permanent contract, not English — "activated-carbon" is
 * the right thing to store and the wrong thing to show a player.
 */
export function nameOf(ctx, id) {
  for (const kind of ['stocks', 'minerals', 'components', 'flows', 'abstracts']) {
    const def = ctx.catalog[kind]?.byId?.[id];
    if (def?.name) return def.name;
  }
  return id;
}

/**
 * How a good's store reads to the building that owns it, in one word. `role`
 * is 'in' (it consumes it), 'out' (it makes it) or 'held' (a porter left it
 * here and nothing here wants it).
 *
 *   in    out -> low -> ok        an input runs down and has to be refilled
 *   out   ok -> filling -> full   an output fills up and has to be collected
 *
 * `stores.lowMark` is the one threshold for both: an input below that share
 * of its store is low, and an output above it is filling. Outputs warn early
 * on purpose — a porter takes a while to come, and a building whose store is
 * a third full is already telling you nobody has been by.
 *
 * One function so the inspector's readouts and the shaft's popover cannot
 * come to different conclusions about the same bin.
 */
export function bandOf(qty, cap, role, ctx) {
  const mark = ctx.config.stores.lowMark;
  if (role === 'out') {
    if (cap <= 0) return 'ok';
    if (qty >= cap - 1e-9) return 'full';
    return qty / cap > mark ? 'filling' : 'ok';
  }
  if (role !== 'in') return 'ok';
  if (qty <= 1e-9) return 'out';
  return cap > 0 && qty / cap < mark ? 'low' : 'ok';
}

/**
 * What a building is short of: the goods that have stopped it, and the ones
 * about to. Ordered worst first. The shaft view puts an icon on the room for
 * each one.
 *
 * `out` is NOT "the bin is empty" — it is `instance.missing`, the sim's own
 * answer to why the building did no work this tick. The difference matters
 * for a recipe building: a smelter has a place for all six ores, and an empty
 * silica bin is not a problem unless it was trying to melt glass. flowStock
 * and componentChain both write `missing` and both scope it to what the
 * building actually wanted, so reading it here makes the popover agree with
 * the inspector by construction rather than by a second guess at the rules.
 *
 * `low` is then anything else it takes in, still has some of, and is running
 * down: the warning that arrives before the stoppage. A good it holds none of
 * and did not ask for is neither — that is a bin it simply does not use.
 *
 * Each entry also carries `level`, the share of the bin still held (0..1), so
 * the plate can draw a low bin's bar at its real length. For water it is the
 * ration share.
 */
export function shortages(instance, def, ctx) {
  if (!def) return [];
  const share = (id) => {
    const cap = capacity(instance, def, ctx, id);
    return cap > 0 ? Math.min(1, amount(instance, id) / cap) : 0;
  };
  const out = (instance.missing ?? []).filter((id) => isGood(ctx, id));
  const found = out.map((id) => ({ id, band: 'out', level: share(id) }));

  for (const id of inputsOf(def, ctx)) {
    if (out.includes(id)) continue;
    const qty = amount(instance, id);
    if (qty <= 1e-9) continue;
    if (bandOf(qty, capacity(instance, def, ctx, id), 'in', ctx) === 'low') found.push({ id, band: 'low', level: share(id) });
  }

  // Water is piped, so it is never in a store and never in `missing` — but a
  // rationed building is short of it in exactly the sense this list is for,
  // and the shaft view has no other way to say so. greywaterLoop leaves the
  // share at 1 for everything that does not drink, so this cannot fire on a
  // building that has no use for water.
  const ration = instance.waterShare ?? 1;
  if (ration <= 1e-9) found.unshift({ id: 'water', band: 'out', level: 0 });
  else if (ration < 1) found.push({ id: 'water', band: 'low', level: ration });

  return found;
}

/** The goods a building takes in: what it consumes, and its recipes' inputs. */
export function inputsOf(def, ctx) {
  const inputs = new Set();
  for (const c of def.consumes ?? []) if (isGood(ctx, c.id)) inputs.add(c.id);
  for (const r of recipesFor(def.id, ctx)) for (const i of r.inputs) inputs.add(i.id);
  return inputs;
}

/** The goods a building puts out: what it produces, its recipes' outputs, what it mines. */
export function outputsOf(def, ctx) {
  const outputs = new Set();
  for (const p of def.produces ?? []) if (isGood(ctx, p.id)) outputs.add(p.id);
  for (const r of recipesFor(def.id, ctx)) for (const o of r.outputs) outputs.add(o.id);
  if (extracts(def)) for (const v of ctx.shaft.veins ?? []) outputs.add(v.id);
  return outputs;
}

/** Fill an instance's input stores to capacity — the opening's inheritance. */
export function fillInputs(instance, def, ctx) {
  for (const id of inputsOf(def, ctx)) put(instance, def, ctx, id, Infinity);
}

function extracts(def) {
  return (def.effects ?? []).some((e) => e.op === 'extraction.enable');
}
