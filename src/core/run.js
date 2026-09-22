/**
 * run.js
 * Assembles a run: dataset -> state -> streams -> context -> engine.
 *
 * One place does this, so the browser, the replay harness and the tests all
 * build a run identically. If they each assembled their own, a determinism
 * test would be testing a different engine from the one that ships.
 */

import { createEngine, createContext, stepOnce } from './engine.js';
import { createGameState } from './gameState.js';
import { createClock, configureClock } from './clock.js';
import { createStreams } from './streams.js';
import { applyRecorded } from './commands.js';
import { loadDataset } from '../config/contentLoader.js';

import * as power from '../systems/power/priorityLadder.js';
import * as resources from '../systems/resources/index.js';
import * as water from '../systems/water/greywaterLoop.js';
import * as airQuality from '../systems/airQuality/perLevelAir.js';
import * as haulage from '../systems/haulage/haulageMethods.js';
import * as buildings from '../systems/buildings/buildingRegistry.js';
import * as roster from '../systems/population/roster.js';

/** The system registry, keyed to match SYSTEM_ORDER in engine.js. */
export function createSystems() {
  return { power, resources, water, airQuality, haulage, buildings, population: roster };
}

/**
 * Build a run.
 *
 * @param {object} options
 * @param {object} [options.dataset]  a pre-loaded dataset (tests reuse one)
 * @param {object} [options.state]    restore this state instead of a new one
 * @param {object} [options.cursors]  RNG draw counts to resume from
 */
export async function createRun({
  chapter = 1,
  seed = 1234,
  profile = 'default',
  dataset = null,
  state = null,
  cursors = {},
  readJson = undefined,
} = {}) {
  const data = dataset ?? (await loadDataset({ chapter, profile, readJson }));

  const gameState = state ?? createGameState({ chapter, dataset: data, seed });
  if (!gameState.clock) gameState.clock = configureClock(createClock(), data.config);
  else configureClock(gameState.clock, data.config);

  const { streams, cursors: liveCursors } = createStreams(seed, cursors);

  const ctx = createContext({ dataset: data, streams, cursors: liveCursors, outbox: [] });
  const engine = createEngine(gameState, createSystems(), ctx);

  // Deterministic opening setup belongs HERE, not in main.js. Anything that
  // shapes a run and is not a command has to be reproducible from
  // dataset + seed alone, or replay diverges — starting stores come from the
  // shaft profile (see gameState.initialStocks) and the roster is seeded from
  // the 'names' stream. Restoring a save skips it: those people already exist.
  if (!state) roster.seedRoster(gameState, ctx);

  return { engine, state: gameState, ctx, dataset: data, cursors: liveCursors };
}

/**
 * Replay a run from its command log.
 *
 * A run is `seed + configHash + commandLog`, so this is the whole
 * reproducibility promise in one function: hand it a 2KB log and it rebuilds
 * the run tick for tick. Commands are applied at the tick they were recorded
 * on, before that tick's systems run, matching how dispatch() behaves live.
 *
 * @param {Array} commandLog
 * @param {number} toTick  replay up to and including this tick
 */
export async function replay(commandLog, toTick, options = {}) {
  const run = await createRun(options);
  const { engine, state } = run;

  // Commands issued before the first tick (opening layout, staffing) apply as
  // a batch, exactly as boot does.
  const byTick = new Map();
  for (const command of commandLog) {
    const tick = command.tick ?? 0;
    if (!byTick.has(tick)) byTick.set(tick, []);
    byTick.get(tick).push(command);
  }

  for (const command of byTick.get(0) ?? []) applyRecorded(state, run.ctx, command);

  while (state.clock.tick < toTick) {
    const next = state.clock.tick + 1;
    for (const command of byTick.get(next) ?? []) applyRecorded(state, run.ctx, command);
    stepOnce(engine);
  }

  return run;
}
