import { total } from '../systems/resources/stores.js';

/**
 * selectors.js
 * Pure derived reads over game state. No mutation, no side effects, no RNG.
 *
 * Predicates and the UI both need answers like "how many days of food is
 * that?" — putting them here keeps the predicate evaluator thin and makes the
 * arithmetic testable without constructing a whole engine.
 */

/**
 * A good's amount across the whole Shaft — every building's store and every
 * porter's load. Goods are local (systems/resources/stores.js); this is the
 * sum a planner reads, not a pile anyone can draw from.
 */
export function stockAmount(state, id) {
  return total(state, id);
}

export function meterValue(state, id) {
  return state.meters[id] ?? 0;
}

/**
 * How well a need is met right now (population.needs): food and water as the
 * share of people served, 0–1; air and water quality 0–100. A need not yet
 * computed reads as met, so a predicate on it cannot fire on tick zero.
 */
export function needOf(state, id) {
  return state.population.needs?.[id] ?? 1;
}

export function flagSet(state, flag) {
  return state.narrative.flags[flag] === true;
}

export function capabilityEnabled(state, capability) {
  return state.narrative.capabilities[capability] === true;
}

export function doubtOf(state, memberId) {
  return state.board[memberId]?.doubt ?? 0;
}

export function highestDoubt(state) {
  return pickBoardMember(state, (a, b) => b.doubt - a.doubt);
}

export function lowestDoubt(state) {
  return pickBoardMember(state, (a, b) => a.doubt - b.doubt);
}

/**
 * Sorted by the comparator, tie-broken by id so the result never depends on
 * object key order (determinism principle 8).
 */
function pickBoardMember(state, compare) {
  const entries = Object.entries(state.board)
    .map(([id, m]) => ({ id, ...m }))
    .sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
  return entries[0]?.id ?? null;
}

/** Placed instances of a building definition. */
export function instancesOf(state, buildingId) {
  return state.buildings.filter((b) => b.buildingId === buildingId);
}

/** How breathable a level is: the worse of its purity and its oxygen. */
export function breathable(level) {
  return Math.min(level.airQuality, level.oxygen ?? 100);
}

export function levelAir(state, levelIndex) {
  const level = state.levels.find((l) => l.index === levelIndex);
  return level ? breathable(level) : 0;
}

export function flowOf(state, id) {
  return state.resources.flows[id] ?? { generation: 0, demand: 0, brownedOut: [] };
}

/** True when a flow's demand exceeds what is available to meet it. */
export function hasShortfall(state, id) {
  const flow = flowOf(state, id);
  return flow.demand > flow.generation;
}

/**
 * Ticks of supply remaining at the current consumption rate, converted to
 * in-game days. Infinity when nothing is consuming it — a stock nobody wants
 * is not running out.
 */
export function daysOfSupply(state, ctx, id) {
  const perTick = consumptionRate(state, ctx, id);
  if (perTick <= 0) return Infinity;
  const ticksPerDay = ctx.config.clock.ticksPerShift * ctx.config.clock.shiftsPerDay;
  return stockAmount(state, id) / perTick / ticksPerDay;
}

/**
 * Current consumption of a resource per tick: per-capita draw plus whatever
 * placed buildings consume. Recomputed rather than cached, so it always
 * reflects the buildings standing right now.
 */
export function consumptionRate(state, ctx, id) {
  let rate = 0;

  const perCapita = {
    food: ctx.config.population.foodPerCapitaPerTick,
    water: ctx.config.water.potablePerCapitaPerTick,
  }[id];
  if (perCapita) rate += perCapita * state.population.headcount;

  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    for (const input of def?.consumes ?? []) {
      if (input.id === id) rate += input.qty;
    }
  }

  return rate;
}

/** The active power priority ladder: statute first, config default otherwise. */
export function priorityLadder(state, ctx) {
  return state.governance.priorityLadder ?? ctx.config.power.defaultPriorityLadder;
}

/** Leaning count for a theme, as accumulated by precedent.record. */
export function leaningCount(state, theme, leaning) {
  return state.governance.precedent[theme]?.[leaning] ?? 0;
}

export function statuteActive(state, lawCardId) {
  return state.governance.enacted.some((e) => e.id === lawCardId);
}

export function factionSatisfaction(state, factionId) {
  return state.population.factionSatisfaction[factionId] ?? 0;
}
