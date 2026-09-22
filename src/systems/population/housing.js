/**
 * housing.js
 * Where people live. Pure reads over state — nothing here is stored, because
 * residence follows from headcount and the homes that stand, and storing it
 * would be a second source of truth the moment a suite is built or demolished.
 *
 * A home's `housing` is how many people it holds. When the Shaft has more
 * people than homes, the homes fill and the rest sleep where they can —
 * spread evenly across the habitable levels, in halls and corridors — which
 * is what makes crowding a cost the air and the morale both feel.
 */

/** Total places in standing homes. A wrecked home houses nobody. */
export function housingCapacity(state, ctx) {
  let total = 0;
  for (const instance of state.buildings) {
    if (instance.brokenDown) continue;
    total += ctx.catalog.buildings.byId[instance.buildingId]?.housing ?? 0;
  }
  return total;
}

/** People without a home. */
export function unhoused(state, ctx) {
  return Math.max(0, state.population.headcount - housingCapacity(state, ctx));
}

/**
 * Residents on each level, as an array indexed by level number (index 0 is
 * unused, so `byLevel[12]` is level 12). Homes fill in proportion to their
 * size; overflow spreads over levels 1..deepestHabitedLevel.
 */
export function residentsByLevel(state, ctx) {
  const byLevel = new Array(state.levels.length + 1).fill(0);
  const headcount = state.population.headcount;
  const capacity = housingCapacity(state, ctx);

  const occupancy = capacity > 0 ? Math.min(1, headcount / capacity) : 0;
  for (const instance of state.buildings) {
    if (instance.brokenDown) continue;
    const places = ctx.catalog.buildings.byId[instance.buildingId]?.housing ?? 0;
    if (places > 0) byLevel[instance.level] += places * occupancy;
  }

  const overflow = Math.max(0, headcount - capacity);
  if (overflow > 0) {
    const deepest = Math.min(ctx.shaft.layout?.deepestHabitedLevel ?? state.levels.length, state.levels.length);
    for (let level = 1; level <= deepest; level++) byLevel[level] += overflow / deepest;
  }

  return byLevel;
}
