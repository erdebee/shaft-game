/**
 * precedentTracker.js
 * Records how the player has actually ruled, independent of what the Accord
 * says. Consistency builds legitimacy; contradicting your own precedent is
 * cheap once and expensive the fourth time.
 */

export function record(state, { situation, ruling, tick }) {
  // TODO
}

export function findSimilar(state, situation) {
  // TODO: return prior rulings the Board will cite back at the player
  return [];
}

export function consistencyScore(state) {
  // TODO
}
