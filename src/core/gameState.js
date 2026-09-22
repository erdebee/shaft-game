/**
 * gameState.js
 * The single serialisable state container. Everything the save system writes
 * and the config resolver seeds lives here. Systems read and mutate through
 * their own modules rather than reaching in arbitrarily.
 *
 * HARD CONSTRAINT: state is JSON-serializable. Plain objects, arrays, numbers,
 * strings, booleans, null — no functions, Maps, Sets, Dates or class
 * instances. saveLoad.js goes through localStorage, and structuredClone in
 * snapshot() is more permissive than JSON, so a violation would hide here and
 * surface as a corrupt save much later.
 *
 * Nothing derived lives here either. No pixel positions, no cached totals, no
 * modifier sums — those are recomputed (see core/effects.js collectModifiers)
 * so that state stays the minimum needed to reproduce a run.
 */

import { initialSeams } from '../systems/resources/minerals.js';
import { initialWater } from '../systems/water/greywaterLoop.js';
import { initialVitals } from '../systems/population/vitals.js';

/**
 * @param {object} args
 * @param {number} args.chapter
 * @param {object} args.dataset  from config/contentLoader.js
 * @param {number|string} args.seed
 */
export function createGameState({ chapter, dataset, seed }) {
  const { config, catalog, shaft } = dataset;

  return {
    meta: {
      chapter,
      seed,
      version: 1,
      createdAt: Date.now(),
      configHash: dataset.configHash,
      shaftId: shaft.id,
      rngCursors: {},
    },

    clock: null, // set by the engine at boot, from createClock/configureClock

    levels: buildLevels(config, shaft, dataset.tables),
    buildings: [],
    haulage: { trips: [], queue: [], nextTripId: 1 },

    resources: {
      stocks: initialStocks(catalog, shaft),
      seams: initialSeams(shaft),
      abstracts: initialAbstracts(catalog, config),
      flows: {
        power: { generation: 0, demand: 0, brownedOut: [] },
        water: initialWater(),
      },
      cutSupplies: [],
    },

    meters: initialMeters(catalog, chapter),

    population: {
      headcount: config.population.startingHeadcount,
      cohorts: initialCohorts(catalog, config),
      workers: [],
      assignments: {},
      factionSatisfaction: initialFactions(catalog, config),
      lotteryMultiplier: 1,
      nextWorkerId: 1,
      ...initialVitals(config),
      labour: { pool: 0, assigned: 0, wanted: 0 },
      strikes: [],
    },

    governance: {
      enacted: [],
      precedent: {},
      authority: config.governance.authorityStart,
      priorityLadder: null, // null = fall back to config default
    },

    narrative: {
      flags: {},
      capabilities: {},
      unlocked: [],
      timers: [],
      scheduled: [],
      armedBeats: [],
      firedBeats: [],
      firedDirectives: [],
      activeDilemma: null,
      dilemmaCooldowns: {},
      moleId: null,
    },

    board: initialBoard(dataset, config),

    log: [],
    commandLog: [],
  };
}

/**
 * One entry per level, from the shaft profile's layout. Air starts at full
 * quality; the air system degrades it from there.
 */
function buildLevels(config, shaft, tables) {
  const count = shaft.layout?.levels ?? config.structure?.levels ?? 42;
  const template = tables?.levels?.levelTemplate ?? {};

  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    buildSlots: template.buildSlots ?? 10,
    airQuality: 100,
    sealed: false,
  }));
}

/**
 * Every stockable resource at zero, then the shaft profile's opening stores
 * on top. Declaring all ids up front keeps the object's key set stable across
 * a run, which matters for both save size and state fingerprinting.
 */
function initialStocks(catalog, shaft) {
  const stocks = {};
  for (const collection of ['stocks', 'minerals', 'components']) {
    for (const id of catalog[collection]?.ids ?? []) stocks[id] = 0;
  }
  for (const [id, qty] of Object.entries(shaft.startingStocks ?? {})) {
    if (id in stocks) stocks[id] = qty;
  }
  return stocks;
}

function initialAbstracts(catalog, config) {
  return {
    labour: 0,
    focus: 0,
    authority: config.governance.authorityStart,
  };
}

/** Only meters enabled for this chapter get a value, so Chapter 1 has no doubt. */
function initialMeters(catalog, chapter) {
  const meters = {};
  for (const id of catalog.meters.ids) {
    const def = catalog.meters.byId[id];
    if (def.enabled === false) continue;
    if (Array.isArray(def.chapters) && !def.chapters.includes(chapter)) continue;
    if (def.scope !== 'global') continue;
    meters[id] = def.start ?? 0;
  }
  return meters;
}

function initialCohorts(catalog, config) {
  const total = config.population.startingHeadcount;
  const cohorts = {};
  for (const id of catalog.cohorts?.ids ?? []) {
    const def = catalog.cohorts.byId[id];
    cohorts[id] = Math.round(total * (def.startingShare ?? 0));
  }
  return cohorts;
}

function initialFactions(catalog, config) {
  const out = {};
  for (const id of catalog.factions?.ids ?? []) {
    out[id] = catalog.factions.byId[id].satisfactionStart ?? config.factions.satisfactionStart;
  }
  return out;
}

/**
 * Board members exist in every chapter, but doubt only matters in Chapter 2.
 * Keeping the roster present from the start means Chapter 1 can build trust
 * with people the player will later have to lie to.
 */
function initialBoard(dataset, config) {
  const board = {};
  for (const id of dataset.content.boardMembers?.ids ?? []) {
    const member = dataset.content.boardMembers.byId[id];
    board[id] = {
      trust: member.startingTrust ?? 50,
      doubt: config.board.doubtStart,
      replaced: false,
    };
  }
  return board;
}

export function snapshot(state) {
  return structuredClone(state);
}

/**
 * Assert state is JSON-round-trippable. Called by tests and by save; cheap
 * enough to run in development, and it catches a Map or a Date the moment it
 * is introduced rather than at save time.
 */
export function assertSerializable(state) {
  const round = JSON.parse(JSON.stringify(state));
  const a = JSON.stringify(round);
  const b = JSON.stringify(state);
  if (a !== b) throw new Error('gameState: state is not JSON-round-trippable');
  return true;
}
