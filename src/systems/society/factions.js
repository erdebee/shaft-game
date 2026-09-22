/**
 * factions.js
 * The four departments' satisfaction. Each faction names what satisfies it
 * (catalog/population/factions.json `satisfiedBy`, a list of predicates), and
 * its satisfaction drifts toward a target set by how many of those hold, less
 * the general discontent — a department is made of people, and people who
 * have had enough are not happy at work either.
 *
 * Owns population.factionSatisfaction.
 */

import { approach, clamp } from '../../utils/math.js';
import { evaluate } from '../../core/predicates.js';

export function tick(state, ctx) {
  const cfg = ctx.config.factions;
  for (const id of ctx.catalog.factions.ids) {
    const def = ctx.catalog.factions.byId[id];
    const current = state.population.factionSatisfaction[id] ?? cfg.satisfactionStart;
    state.population.factionSatisfaction[id] = approach(current, satisfactionTarget(state, ctx, def), cfg.satisfactionApproachPerTick);
  }
}

export function satisfactionTarget(state, ctx, def) {
  const cfg = ctx.config.factions;
  const conditions = def.satisfiedBy ?? [];
  const met = conditions.filter((pred) => evaluate(state, ctx, pred)).length;
  const share = conditions.length ? met / conditions.length : 0.5;
  const discontent = state.meters.discontent ?? 0;
  return clamp(cfg.satisfactionFloor + cfg.satisfactionRange * share - cfg.discontentWeight * discontent, 0, 100);
}
