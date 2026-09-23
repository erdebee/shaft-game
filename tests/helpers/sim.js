/**
 * Shared set-up for system tests: one dataset, and a run with a given layout
 * placed and fully staffed through the same commands the player uses.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRun } from '../../src/core/run.js';
import { stepOnce } from '../../src/core/engine.js';
import { dispatch } from '../../src/core/commands.js';
import { loadDataset } from '../../src/config/contentLoader.js';
import { capacity, total, isStorage, inputsOf } from '../../src/systems/resources/stores.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../resources/data');
export const readJson = async (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'));

export const dataset = await loadDataset({ readJson, chapter: 1, profile: 'default' });

/**
 * @param {Array<[string, number]>} layout  [buildingId, level] pairs
 * @param {object} [options]
 * @param {object} [options.stocks]    by good id: every placed building that
 *   takes that good in, or stores it, holds this much of it (capped at what
 *   it can hold); 0 empties it. Output stores are left alone. Goods are local (src/systems/resources/stores.js).
 * @param {object} [options.tunables]  override config values, by dot path
 * @param {object} [options.keep]      goods topped up (as `stocks`) before
 *   every tick — the porters a test does not want to model
 * @param {boolean} [options.staffed=true]
 */
export async function runWith(layout, { stocks = {}, keep = null, tunables = {}, staffed = true, seed = 4242 } = {}) {
  const run = await createRun({ dataset: withTunables(tunables), seed, chapter: 1, readJson });
  for (const [buildingId, level] of layout) {
    dispatch(run.state, run.ctx, { type: 'player:placeBuilding', buildingId, level, inherited: true });
  }
  if (staffed) {
    for (const instance of run.state.buildings) {
      const def = dataset.catalog.buildings.byId[instance.buildingId];
      dispatch(run.state, run.ctx, {
        type: 'player:assignStaff', instanceId: instance.instanceId, count: def.staffing ?? 0,
      });
    }
  }
  for (const [id, qty] of Object.entries(stocks)) setStock(run, id, qty);
  run.keep = keep;
  return run;
}

/**
 * A kitchen: power and three canteens, room to spare for the default 2400. People
 * eat at canteens now, so any test that wants them fed needs one — and a
 * `keep` of FED_KEEP to stand in for the porters bringing the food.
 */
export const KITCHEN = [['main-generator', 38], ['canteen', 26], ['canteen', 28], ['canteen', 29]];
export const FED_KEEP = { food: 3000, fuel: 100 };

/** Set a good in every building that has a place for it (see runWith). */
export function setStock(run, id, qty) {
  for (const instance of run.state.buildings) {
    const def = run.ctx.catalog.buildings.byId[instance.buildingId];
    if (!isStorage(def) && !inputsOf(def, run.ctx).has(id) && def.storeCapacity?.[id] === undefined) continue;
    const cap = capacity(instance, def, run.ctx, id);
    if (cap <= 0) continue;
    instance.stock ??= {};
    if (qty > 0) instance.stock[id] = Math.min(qty, cap);
    else delete instance.stock[id];
  }
}

/** A good summed over the whole Shaft. */
export function totalOf(run, id) {
  return total(run.state, id);
}

/** The shared dataset, or a copy with some config values replaced. */
function withTunables(tunables) {
  if (Object.keys(tunables).length === 0) return dataset;
  const config = structuredClone(dataset.config);
  for (const [path, value] of Object.entries(tunables)) {
    const keys = path.split('.');
    const last = keys.pop();
    const node = keys.reduce((n, k) => n[k], config);
    if (!(last in node)) throw new Error(`runWith: unknown tunable ${path}`);
    node[last] = value;
  }
  return { ...dataset, config };
}

export function ticks(run, n) {
  if (run.keep) return ticksKeeping(run, n, run.keep);
  for (let i = 0; i < n; i++) stepOnce(run.engine);
}

/**
 * Step while an invisible hand keeps some goods topped up everywhere they are
 * taken in — the porters a test does not want to model.
 */
export function ticksKeeping(run, n, stocks) {
  for (let i = 0; i < n; i++) {
    for (const [id, qty] of Object.entries(stocks)) setStock(run, id, qty);
    stepOnce(run.engine);
  }
}

export function instanceOf(run, buildingId) {
  return run.state.buildings.find((b) => b.buildingId === buildingId);
}
