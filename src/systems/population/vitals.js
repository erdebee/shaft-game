/**
 * vitals.js
 * The aggregate population's body: what it eats, how healthy it is, who dies
 * and who is born. Most of the Shaft is cohort headcounts, not people — see
 * roster.js for the few who are tracked by name.
 *
 * Each tick:
 *   1. EAT      per-capita food from the shared stock; a shortfall is hunger
 *   2. NEEDS    a snapshot of how well every need was met this tick — food,
 *               water, water quality, air, a home, a lit home. Read by health
 *               below, by the meters, and by the dashboard.
 *   3. HEALTH   drifts toward a target set by those needs and the clinics
 *   4. DEATHS   hunger, thirst, suffocation and illness, each at its own rate
 *   5. LEAVING  people who have had enough go out through the Exit, and
 *               nobody who goes out comes back
 *   6. BIRTHS   the birth lottery, once a cycle, and only in a fed Shaft
 *
 * Headcount is the authority; cohorts carry the age mix and shrink in
 * proportion when people die. Both are fractional — a tick's worth of
 * starvation is rarely a whole person — and are rounded for display.
 *
 * Owns population.headcount, .cohorts, .health, .needs and .vitalStats.
 */

import { approach, clamp } from '../../utils/math.js';
import { residentsByLevel, housingCapacity } from './housing.js';
import { cohortFactor } from './demography.js';

const CAUSES = ['starvation', 'thirst', 'suffocation', 'illness'];

export function initialVitals(config) {
  return {
    health: config.population.healthStart,
    needs: { food: 1, water: 1, waterQuality: 100, air: 100, housing: 1, homePower: 1 },
    vitalStats: emptyStats(),
  };
}

export function tick(state, ctx) {
  const pop = state.population;
  const cfg = ctx.config.population;

  // --- 1. eat ---------------------------------------------------------------
  const demand = pop.headcount * cfg.foodPerCapitaPerTick * cohortFactor(state, ctx, 'foodMultiplier');
  const eaten = Math.min(demand, state.resources.stocks.food ?? 0);
  state.resources.stocks.food = (state.resources.stocks.food ?? 0) - eaten;
  const foodShare = demand > 0 ? eaten / demand : 1;
  if (foodShare < 1) ctx.emit('population:hungry', { share: foodShare, shortfall: demand - eaten });

  // --- 2. needs -------------------------------------------------------------
  const residents = residentsByLevel(state, ctx);
  pop.needs = {
    food: foodShare,
    water: state.resources.flows.water?.peopleShare ?? 1,
    waterQuality: state.resources.flows.water?.quality ?? 100,
    air: residentAir(state, residents),
    housing: pop.headcount > 0 ? Math.min(1, housingCapacity(state, ctx) / pop.headcount) : 1,
    homePower: litHomes(state, ctx),
  };

  // --- 3. health ------------------------------------------------------------
  pop.health = approach(pop.health, healthTarget(pop.needs, state, ctx), cfg.healthDriftPerTick);

  // --- 4. deaths ------------------------------------------------------------
  const deaths = {
    starvation: pop.headcount * cfg.starvationDeathRate * (1 - pop.needs.food),
    thirst: pop.headcount * cfg.thirstDeathRate * (1 - pop.needs.water),
    suffocation: suffocating(state, ctx, residents) * cfg.suffocationDeathRate,
    illness: pop.headcount * cfg.illnessDeathRate * below(pop.health, cfg.illnessThreshold),
  };
  let died = 0;
  for (const cause of CAUSES) {
    pop.vitalStats.deaths[cause] += deaths[cause];
    died += deaths[cause];
  }
  if (died > 0) remove(pop, died);

  // --- 5. leaving -----------------------------------------------------------
  const leaving = departures(state, ctx);
  if (leaving > 0) {
    pop.vitalStats.departures += leaving;
    remove(pop, leaving);
  }

  // --- 6. births ------------------------------------------------------------
  if (cfg.birthLotteryCycleTicks > 0 && state.clock.tick % cfg.birthLotteryCycleTicks === 0 && pop.needs.food >= 1) {
    const born = cfg.birthLotterySlotsPerCycle * (pop.lotteryMultiplier ?? 1);
    if (born > 0) {
      pop.headcount += born;
      pop.cohorts.children = (pop.cohorts.children ?? 0) + born;
      pop.vitalStats.births += born;
    }
  }

  // --- daily report ---------------------------------------------------------
  const ticksPerDay = ctx.config.clock.ticksPerShift * ctx.config.clock.shiftsPerDay;
  if (state.clock.tick % ticksPerDay === 0) {
    ctx.emit('population:day', { ...pop.vitalStats, headcount: pop.headcount, health: pop.health });
    pop.vitalStats = emptyStats();
  }
}

/** Share of the population too sick to work: none while health is good. */
export function sickShare(state, ctx) {
  const { sickShareAtZeroHealth, illnessThreshold } = ctx.config.population;
  return sickShareAtZeroHealth * below(state.population.health, illnessThreshold * 2);
}

/**
 * Where health is heading. A healthy baseline, lifted by clinics, pulled down
 * by every unmet need in proportion to how badly it is unmet.
 */
function healthTarget(needs, state, ctx) {
  const cfg = ctx.config.population;
  const air = ctx.config.air;
  const clinics = ctx.modifiers.meter.healthRate ?? 0;

  const target = cfg.healthBaseline + clinics * 100
    - cfg.hungerHealthPenalty * (1 - needs.food)
    - cfg.thirstHealthPenalty * (1 - needs.water)
    - cfg.badWaterHealthPenalty * below(needs.waterQuality, cfg.waterQualitySafe)
    - cfg.badAirHealthPenalty * below(needs.air, air.qualityWarnThreshold);
  return clamp(target, 0, 100);
}

/** How far below a threshold a value sits, as a share of it: 0 at or above. */
function below(value, threshold) {
  return threshold > 0 ? clamp((threshold - value) / threshold, 0, 1) : 0;
}

/** Air quality averaged over where people actually are. */
function residentAir(state, residents) {
  let people = 0;
  let sum = 0;
  for (const level of state.levels) {
    const n = residents[level.index] ?? 0;
    people += n;
    sum += n * level.airQuality;
  }
  return people > 0 ? sum / people : 100;
}

/** People breathing critical air, weighted by how far below critical it is. */
function suffocating(state, ctx, residents) {
  const critical = ctx.config.air.qualityCriticalThreshold;
  let exposed = 0;
  for (const level of state.levels) {
    exposed += (residents[level.index] ?? 0) * below(level.airQuality, critical);
  }
  return exposed;
}

/** Share of home places that have power. 1 when there are no homes to light. */
function litHomes(state, ctx) {
  let places = 0;
  let lit = 0;
  for (const instance of state.buildings) {
    const housing = ctx.catalog.buildings.byId[instance.buildingId]?.housing ?? 0;
    if (!housing || instance.brokenDown) continue;
    places += housing;
    if (instance.powered !== false) lit += housing;
  }
  return places > 0 ? lit / places : 1;
}

/**
 * People leaving through the Exit this tick. Nobody leaves below
 * unrest.departureThreshold; above it, a share of the population that grows
 * with discontent. Only while the Exit stands and works — a sealed Exit keeps
 * everyone in, which is its own kind of answer.
 */
function departures(state, ctx) {
  const { departureThreshold, departureRatePerTick } = ctx.config.unrest;
  const discontent = state.meters.discontent ?? 0;
  if (discontent <= departureThreshold) return 0;
  if (!ctx.modifiers.capabilities.departure) return 0;
  const intensity = (discontent - departureThreshold) / (100 - departureThreshold);
  return state.population.headcount * departureRatePerTick * intensity;
}

/** Take `n` people out of the population, from every cohort in proportion. */
function remove(pop, n) {
  const before = pop.headcount;
  const after = Math.max(0, before - n);
  const keep = before > 0 ? after / before : 0;
  for (const id of Object.keys(pop.cohorts)) pop.cohorts[id] *= keep;
  pop.headcount = after;
}

function emptyStats() {
  return { deaths: Object.fromEntries(CAUSES.map((c) => [c, 0])), births: 0, departures: 0 };
}
