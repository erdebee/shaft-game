/**
 * predicates.js
 * The single evaluator for every `preconditions`, `requires`, `armedBy`,
 * `satisfiedBy` and dilemma-variant `when` clause in the content layer.
 *
 * One grammar, one interpreter. Content types do not get local variants — if a
 * new question needs asking, it becomes a predicate here and an entry in
 * schema.js's PREDICATES, so validation can see it.
 *
 * Every predicate is a pure read. Evaluating one must never mutate state or
 * draw from an RNG stream, or the same content would behave differently
 * depending on how often the UI happened to ask.
 */

import * as S from './selectors.js';
import { PREDICATES } from '../config/schema.js';

const HANDLERS = {
  'all-of': (state, ctx, p) => asArray(p.of).every((q) => evaluate(state, ctx, q)),
  'any-of': (state, ctx, p) => asArray(p.of).some((q) => evaluate(state, ctx, q)),
  'not': (state, ctx, p) => !asArray(p.of).every((q) => evaluate(state, ctx, q)),

  'meter.above': (state, ctx, p) => S.meterValue(state, p.target) > p.value,
  'meter.below': (state, ctx, p) => S.meterValue(state, p.target) < p.value,

  'stock.above': (state, ctx, p) => S.stockAmount(state, p.target) > p.value,
  'stock.aboveDaysOfSupply': (state, ctx, p) => S.daysOfSupply(state, ctx, p.target) > p.value,
  'stock.belowDaysOfSupply': (state, ctx, p) => S.daysOfSupply(state, ctx, p.target) < p.value,

  'flow.shortfall': (state, ctx, p) => S.hasShortfall(state, p.target),

  // How well the people are served, 0–1 for food and water (population.needs).
  'need.below': (state, ctx, p) => S.needOf(state, p.target) < p.value,
  'need.atLeast': (state, ctx, p) => S.needOf(state, p.target) >= p.value,

  'building.exists': (state, ctx, p) => S.instancesOf(state, p.target).length > 0,
  'buildings.noneBelowCondition': (state, ctx, p) =>
    state.buildings.every((b) => b.condition >= p.value),

  'statute.active': (state, ctx, p) => S.statuteActive(state, p.target),
  'leaning.atLeast': (state, ctx, p) => S.leaningCount(state, p.theme, p.leaning) >= (p.count ?? 1),

  'capability.enabled': (state, ctx, p) => S.capabilityEnabled(state, p.target),
  'flag.set': (state, ctx, p) => S.flagSet(state, p.target),

  'doubt.anyAbove': (state, ctx, p) =>
    Object.values(state.board).some((m) => m.doubt > p.value),
  'directive.fired': (state, ctx, p) => state.narrative.firedDirectives.includes(p.target),

  'chapter.is': (state, ctx, p) => state.meta.chapter === p.value,
  'tick.after': (state, ctx, p) => state.clock.tick > p.value,
};

/**
 * Evaluate a predicate tree.
 * `null`/`undefined` is vacuously true — content with no preconditions is
 * always eligible. A bare array is shorthand for `all-of`.
 */
export function evaluate(state, ctx, pred) {
  if (pred === null || pred === undefined) return true;
  if (Array.isArray(pred)) return pred.every((p) => evaluate(state, ctx, p));

  const handler = HANDLERS[pred.pred];
  if (!handler) {
    // Declared in schema but unimplemented here is a different bug from
    // undeclared entirely, and the message should say which.
    const known = pred.pred in PREDICATES;
    throw new Error(
      known
        ? `predicates: "${pred.pred}" is declared in schema.js but has no handler`
        : `predicates: unknown predicate "${pred.pred}"`,
    );
  }
  return handler(state, ctx, pred);
}

function asArray(of) {
  if (of === null || of === undefined) return [];
  return Array.isArray(of) ? of : [of];
}

/** Predicates declared in schema.js with no handler here. Used by tests. */
export function unimplementedPredicates() {
  return Object.keys(PREDICATES).filter((p) => !(p in HANDLERS));
}
