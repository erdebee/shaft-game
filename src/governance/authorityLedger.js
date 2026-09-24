/**
 * authorityLedger.js
 * Authority is political capital, spent enacting Accord amendments and earned
 * back as each amendment session opens (governance.authorityRegenPerWindow).
 * Controversial laws cost more; contradicting your own precedent costs more
 * still (statuteEngine.js costOf), which is what makes consistency itself a
 * spendable resource.
 *
 * Owns state.governance.authority, and nothing else. The four departments'
 * satisfaction, which an earlier sketch of this file also carried, lives in
 * systems/society/factions.js.
 */

import { clamp } from '../utils/math.js';

export function balance(state) {
  return state.governance.authority;
}

export function canAfford(state, amount) {
  return state.governance.authority >= amount;
}

/**
 * Take `amount` if it is there. Returns whether it was: a law the Shaft
 * cannot pay for is not enacted on credit.
 */
export function spend(state, amount) {
  if (!canAfford(state, amount)) return false;
  state.governance.authority -= amount;
  return true;
}

/** Add (or, negative, remove) Authority, held between 0 and the cap. */
export function earn(state, ctx, amount) {
  state.governance.authority = clamp(
    state.governance.authority + amount, 0, ctx.config.governance.authorityCap,
  );
}
