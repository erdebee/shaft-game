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
import { initialLedger } from '../systems/resources/ledger.js';
import { initialWater } from '../systems/water/greywaterLoop.js';
import { initialPower } from '../systems/power/priorityLadder.js';
import { initialAir } from '../systems/airQuality/airflow.js';
import { initialVitals } from '../systems/population/vitals.js';
import { initialUnrest } from '../systems/society/unrest.js';
import { initialMaintenance } from '../systems/buildings/maintenance.js';

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
    nextInstanceId: 1,
    maintenance: initialMaintenance(config),
    haulage: { trips: [], nextTripId: 1 },
    // The networks the player lays by hand (systems/infrastructure/
    // networkGraph.js): cables, pipes, drains and ducts between buildings.
    infrastructure: { links: [], nextLinkId: 1 },

    resources: {
      seams: initialSeams(shaft),
      abstracts: initialAbstracts(catalog, config),
      flows: {
        power: initialPower(),
        water: initialWater(),
        air: initialAir(),
      },
      cutSupplies: [],
      ledger: initialLedger(),
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
      unrest: initialUnrest(),
    },

    governance: {
      enacted: [],
      history: [],   // every enactment and repeal, in order — never rewritten
      precedent: {}, // ruling counts by theme and leaning
      cases: [],     // one entry per ruling (governance/precedentTracker.js)
      authority: config.governance.authorityStart,
      priorityLadder: null, // null = fall back to config default
    },

    narrative: {
      flags: {},
      capabilities: {},
      unlocked: [],
      timers: [],
      promiseRecord: { kept: 0, broken: 0 },
      shifts: {},    // meter.shift: where a meter settles, moved for good
      scheduled: [],
      armedBeats: [],
      firedBeats: [],
      firedDirectives: [],
      activeDilemma: null,
      nextDilemmaTick: null,
      dilemmaCooldowns: {},
      firedDilemmas: [],
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
    airQuality: 100, // purity: what the scrubbers fight
    oxygen: 100,     // what the gardens make and everyone breathes
    sealed: false,
  }));
}

function initialAbstracts(catalog, config) {
  return {
    labour: 0,
    focus: 0,
    // Authority is held in state.governance.authority (governance/authorityLedger.js).
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
