/**
 * componentChain.js
 * Multi-stage refinement: ore -> ingot -> part -> assembly. Defines which
 * inputs a recipe needs and which stages the settlement can perform locally.
 *
 * NOTE: the scrubber catalyst deliberately has no local recipe. That gap is
 * seeded as a mystery in Chapter 1 and becomes the Presidium's leverage in
 * Chapter 2 — do not add a self-production path without a narrative decision.
 */

export function tick(state) {
  // TODO: run recipes in dependency order against available inputs
}

export function canProduce(recipeId, config) {
  // TODO: false for externally-supplied goods
}
