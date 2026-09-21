/**
 * perLevelAir.js
 * Air is tracked per level, not settlement-wide. Contaminants accumulate where
 * they are produced and migrate between adjacent levels; scrubbers clean a
 * limited volume. Deep levels degrade first, which is a political fact as much
 * as a physical one.
 */

export function tick(state) {
  // TODO: produce, migrate, scrub, apply health effects
}

export function scrubberEfficiency(scrubber, catalystStock) {
  // TODO: efficiency falls as catalyst depletes
}
