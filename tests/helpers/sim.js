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

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../resources/data');
export const readJson = async (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'));

export const dataset = await loadDataset({ readJson, chapter: 1, profile: 'default' });

/**
 * @param {Array<[string, number]>} layout  [buildingId, level] pairs
 * @param {object} [options]
 * @param {object} [options.stocks]    overwrite opening stocks, by id
 * @param {object} [options.tunables]  override config values, by dot path
 * @param {boolean} [options.staffed=true]
 */
export async function runWith(layout, { stocks = {}, tunables = {}, staffed = true, seed = 4242 } = {}) {
  const run = await createRun({ dataset: withTunables(tunables), seed, chapter: 1, readJson });
  for (const [buildingId, level] of layout) {
    dispatch(run.state, run.ctx, { type: 'player:placeBuilding', buildingId, level });
  }
  if (staffed) {
    for (const instance of run.state.buildings) {
      const def = dataset.catalog.buildings.byId[instance.buildingId];
      dispatch(run.state, run.ctx, {
        type: 'player:assignStaff', instanceId: instance.instanceId, count: def.staffing ?? 0,
      });
    }
  }
  Object.assign(run.state.resources.stocks, stocks);
  return run;
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
  for (let i = 0; i < n; i++) stepOnce(run.engine);
}

export function instanceOf(run, buildingId) {
  return run.state.buildings.find((b) => b.buildingId === buildingId);
}
