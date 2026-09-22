/**
 * The `society` system: meters drift toward where conditions put them,
 * the departments' satisfaction follows, and discontent turns into warnings,
 * strikes, demands and riots. Runs after population, so the needs it reads
 * are this tick's.
 */

import * as meters from './meters.js';
import * as factions from './factions.js';
import * as unrest from './unrest.js';

export function tick(state, ctx) {
  const before = state.meters.discontent ?? 0;
  meters.tick(state, ctx);
  factions.tick(state, ctx);
  unrest.tick(state, ctx, before);
}
