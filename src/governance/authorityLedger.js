/**
 * authorityLedger.js
 * Authority is political capital, spent enacting Accord amendments and earned
 * back between amendment windows. Controversial laws cost more; contradicting
 * your own precedent costs more still, which is what makes consistency itself
 * a spendable resource.
 *
 * Separately tracks satisfaction with each of the four departments —
 * Cultivation, Engineering, Order, Archive (catalog/population/factions.json).
 * A dissatisfied faction slows output and becomes sabotage-prone; a satisfied
 * one is reliable and warns the player about trouble early.
 *
 * No faction can end the run on its own. Falling below a faction's
 * sabotageThreshold costs capability in that faction's domain, the same shape
 * as Board doubt — the failure states that do end a run are declared in
 * catalog/meters.json.
 */

export function spend(state, faction, amount, reason) {
  // TODO
}

export function earn(state, faction, amount, reason) {
  // TODO
}

export function canCompel(state, faction) {
  // TODO: below a threshold, orders are ignored rather than refused
}
