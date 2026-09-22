/**
 * staffing.js
 * The labour pool, and who gets it. Every job draws from the same pool, so
 * assignment is the primary zero-sum decision in the sim layer.
 *
 * A building's `staffing` in the catalogue counts CREWS; a crew is
 * population.workersPerStaffPoint people. The pool is the working-age share
 * of the headcount (children do not work; apprentices and elders work part
 * time — cohorts.json labourMultiplier), less the sick, less the porters,
 * who are tracked by name in the roster.
 *
 * The player sets a `staffTarget` per building (it starts full). Each tick
 * the pool is dealt out against those targets in power-ladder order — life
 * support first, amenities last, shallower first within a class — so a
 * shrinking workforce empties the amenities before the scrubbers. A building
 * whose faction is on strike gets nobody.
 *
 * Owns instance.staffing and population.labour. Writing `staffing` on an
 * instance is the one reach into another domain, and it is here for the same
 * reason `powered` is in the power system: who works where is a property of
 * the labour pool, not of the building.
 */

import { sickShare } from './vitals.js';
import { cohortFactor } from './demography.js';
import { currentLadder } from '../power/priorityLadder.js';

export function tick(state, ctx) {
  const perCrew = ctx.config.population.workersPerStaffPoint;
  const pool = labourPool(state, ctx);
  const striking = new Set(state.population.strikes?.map((s) => s.faction) ?? []);

  let left = pool;
  let wanted = 0;
  for (const { instance, def } of inLadderOrder(state, ctx)) {
    const target = instance.staffTarget ?? def.staffing ?? 0;
    wanted += target * perCrew;
    if (striking.has(factionOf(ctx, def.id))) {
      instance.staffing = 0;
      continue;
    }
    const crews = Math.min(target, Math.floor(left / perCrew));
    instance.staffing = crews;
    left -= crews * perCrew;
  }

  state.population.labour = { pool, assigned: pool - left, wanted };
  if (wanted > pool) ctx.emit('labour:shortfall', { pool, wanted });
}

/** People able to work right now. */
export function labourPool(state, ctx) {
  const pop = state.population;
  const working = pop.headcount * cohortFactor(state, ctx, 'labourMultiplier', 0);
  const porters = pop.workers.length;
  return Math.max(0, working * (1 - sickShare(state, ctx)) - porters);
}

/** The faction that controls a building, or null. */
export function factionOf(ctx, buildingId) {
  for (const id of ctx.catalog.factions.ids) {
    if (ctx.catalog.factions.byId[id].controls?.includes(buildingId)) return id;
  }
  return null;
}

/**
 * Staffed buildings by the power ladder's priority class, then level, then
 * id — the same order the grid serves them, so the two shortages agree about
 * what matters.
 */
function inLadderOrder(state, ctx) {
  const ladder = currentLadder(state, ctx);
  const rank = (cls) => {
    const i = ladder.indexOf(cls);
    return i === -1 ? ladder.length : i;
  };
  return state.buildings
    .map((instance) => ({ instance, def: ctx.catalog.buildings.byId[instance.buildingId] }))
    .filter(({ def }) => (def?.staffing ?? 0) > 0)
    .sort((a, b) =>
      rank(a.def.priorityClass) - rank(b.def.priorityClass) ||
      a.instance.level - b.instance.level ||
      a.instance.instanceId.localeCompare(b.instance.instanceId));
}
