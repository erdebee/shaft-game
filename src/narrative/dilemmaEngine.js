/**
 * dilemmaEngine.js
 * Selects and presents dilemmas. A dilemma is eligible when its preconditions
 * hold (state thresholds, flags, prior choices) and its cooldown has elapsed.
 * Options carry consequences applied through the event bus, never directly.
 */

export function tick(state) {
  // TODO: evaluate eligibility, weight, draw from the 'narrative' RNG stream
}

export function eligible(dilemma, state) {
  // TODO
}

export function resolve(state, dilemmaId, optionId) {
  // TODO: apply effects, set flags, record precedent, log
}
