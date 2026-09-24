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
import { fillInputs, putInStorehouses } from '../systems/resources/stores.js';

import * as power from '../systems/power/priorityLadder.js';
import * as resources from '../systems/resources/index.js';
import * as water from '../systems/water/greywaterLoop.js';
import * as airQuality from '../systems/airQuality/perLevelAir.js';
import * as haulage from '../systems/haulage/haulageMethods.js';
import * as buildings from '../systems/buildings/buildingRegistry.js';
import * as population from '../systems/population/index.js';
import * as society from '../systems/society/index.js';
import * as governance from '../governance/index.js';
import * as narrative from '../narrative/index.js';

/** The system registry, keyed to match SYSTEM_ORDER in engine.js. */
export function createSystems() {
  return { power, resources, water, airQuality, haulage, buildings, population, society, governance, narrative };
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

  return { engine, state: gameState, ctx, dataset: data, cursors: liveCursors };
}

/**
 * Place the Shaft profile's opening layout and staff it fully, through the
 * player's own commands. Boot, the sim runner and the tests all open a Shaft
 * this way, so none of them can drift from what the player inherits.
 */
export function placeOpening(state, ctx, dispatch) {
  for (const [buildingId, level] of ctx.shaft.opening ?? []) {
    const before = state.buildings.length;
    dispatch(state, ctx, { type: 'player:placeBuilding', buildingId, level, inherited: true });
    if (state.buildings.length === before) throw new Error(`opening: no room for ${buildingId} on level ${level}`);
  }
  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    dispatch(state, ctx, { type: 'player:assignStaff', instanceId: instance.instanceId, count: def.staffing ?? 0 });
  }
  layOpeningNetworks(state, ctx, dispatch);
  stockOpening(state, ctx);
  hireOpeningPorters(state, ctx, dispatch);
}

/** The building an opening entry names: [buildingId, level, nth]. */
function openingBuilding(state, [buildingId, level, nth = 0]) {
  const found = state.buildings.filter((b) => b.buildingId === buildingId && b.level === level)[nth];
  if (!found) throw new Error(`opening: no ${buildingId} #${nth} on level ${level}`);
  return found.instanceId;
}

/**
 * The cables, pipes, drains and ducts the Shaft opens with, its junction
 * priorities and which way its fans turn, through the player's own commands. A link that names nothing
 * placed, or that the network refuses, is an error in the data.
 */
function layOpeningNetworks(state, ctx, dispatch) {
  for (const entry of ctx.shaft.openingLinks ?? []) {
    const before = state.infrastructure.links.length;
    dispatch(state, ctx, {
      type: 'player:link',
      network: entry.network,
      from: openingBuilding(state, entry.from),
      to: openingBuilding(state, entry.to),
      inherited: true,
    });
    if (state.infrastructure.links.length === before) {
      throw new Error(`opening: ${entry.network} link ${entry.from.join(' ')} to ${entry.to.join(' ')} refused`);
    }
  }
  for (const entry of ctx.shaft.openingPriorities ?? []) {
    dispatch(state, ctx, { type: 'player:setPriority', instanceId: openingBuilding(state, entry.at), priority: entry.priority });
  }
  for (const entry of ctx.shaft.openingFans ?? []) {
    dispatch(state, ctx, { type: 'player:setFanMode', instanceId: openingBuilding(state, entry.at), mode: entry.mode });
  }
}

/**
 * The porters the Shaft opens with, each hired at their station and given
 * their route, through the same commands the player uses. Stops name
 * [buildingId, level, nth]; a stop that names nothing placed is an error in
 * the data, and says so.
 */
function hireOpeningPorters(state, ctx, dispatch) {
  const find = (entry) => openingBuilding(state, entry);
  for (const entry of ctx.shaft.openingPorters ?? []) {
    const before = state.population.workers.length;
    dispatch(state, ctx, { type: 'player:hirePorter', instanceId: find(entry.station), inherited: true });
    const porter = state.population.workers[before];
    if (!porter) throw new Error(`opening: station ${entry.station.join(' ')} had no bed free`);
    const stops = entry.route.map((stop) => ({
      instanceId: find(stop.at),
      action: stop.pickup ? 'pickup' : 'dropoff',
      goodId: stop.pickup ?? stop.dropoff,
      qty: stop.qty ?? 'all',
    }));
    dispatch(state, ctx, { type: 'player:setRoute', workerId: porter.id, stops });
    if (porter.route.length !== stops.length) throw new Error(`opening: porter ${before} has a malformed route`);
  }
}

/**
 * The stores the player inherits: every building's input store full, and the
 * profile's startingStocks in the depots and storehouses, nearest the top
 * first. Deterministic from dataset alone, so it replays; what will not fit
 * is not there.
 */
export function stockOpening(state, ctx) {
  for (const instance of state.buildings) {
    fillInputs(instance, ctx.catalog.buildings.byId[instance.buildingId], ctx);
  }
  for (const [id, qty] of Object.entries(ctx.shaft.startingStocks ?? {})) {
    putInStorehouses(state, ctx, id, qty, 1);
  }
}

/**
 * Replay a run from its command log.
 *
 * A run is `seed + configHash + commandLog`, so this is the whole
 * reproducibility promise in one function: hand it a 2KB log and it rebuilds
 * the run tick for tick. Commands are applied at the tick they were recorded
 * on, after that tick's systems have run, matching how dispatch() behaves live.
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

  // A command stamped T was dispatched live between frames with the clock
  // reading T — after tick T's systems had run, before tick T+1's. So it is
  // applied after stepping onto T, never before: applied first, a ruling
  // stamped 20 would land on tick 19 and record the wrong day.
  while (state.clock.tick < toTick) {
    stepOnce(engine);
    for (const command of byTick.get(state.clock.tick) ?? []) applyRecorded(state, run.ctx, command);
  }

  return run;
}
