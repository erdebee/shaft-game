/**
 * demography.js
 * Pure reads over the age cohorts. Children eat less than adults and elders
 * work less, so every per-capita rate is weighted by who the population
 * actually is.
 */

/**
 * The population-weighted average of a cohort field — `foodMultiplier`,
 * `waterMultiplier`, `labourMultiplier`. A cohort without the field counts as
 * 1 (or as 0 for labour, via `fallback`), so children never add labour.
 */
export function cohortFactor(state, ctx, field, fallback = 1) {
  let people = 0;
  let weighted = 0;
  for (const [id, count] of Object.entries(state.population.cohorts)) {
    const def = ctx.catalog.cohorts?.byId[id];
    if (!def || count <= 0) continue;
    people += count;
    weighted += count * (def[field] ?? fallback);
  }
  return people > 0 ? weighted / people : fallback;
}
