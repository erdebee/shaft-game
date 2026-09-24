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
  const { homes, overflow } = residentsByHome(state, ctx);
  const byLevel = [...overflow];
  for (const { instance, residents } of homes) byLevel[instance.level] += residents;
  return byLevel;
}

/**
 * Who lives where, home by home: `homes` is [{ instance, residents }] for
 * every standing home, filled in proportion to its size, and `overflow` the
 * people with no home, by level as residentsByLevel has them. The water
 * system reads it: a home's residents drink through the home's own feed line.
 */
export function residentsByHome(state, ctx) {
  const overflow = new Array(state.levels.length + 1).fill(0);
  const headcount = state.population.headcount;
  const capacity = housingCapacity(state, ctx);

  const occupancy = capacity > 0 ? Math.min(1, headcount / capacity) : 0;
  const homes = [];
  for (const instance of state.buildings) {
    if (instance.brokenDown) continue;
    const places = ctx.catalog.buildings.byId[instance.buildingId]?.housing ?? 0;
    if (places > 0) homes.push({ instance, residents: places * occupancy });
  }

  const homeless = Math.max(0, headcount - capacity);
  if (homeless > 0) {
    const deepest = Math.min(ctx.shaft.layout?.deepestHabitedLevel ?? state.levels.length, state.levels.length);
    for (let level = 1; level <= deepest; level++) overflow[level] += homeless / deepest;
  }

  return { homes, overflow };
}
