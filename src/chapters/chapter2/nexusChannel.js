/**
 * chapter2/nexusChannel.js
 * The Nexus: the covert channel carrying directives from outside. Messages
 * arrive on the Presidium's schedule, not the player's. Compliance is tracked;
 * so is delay. The player may answer, stall, or lie, and lying is detectable.
 */

export function receive(state, tick) {
  // TODO: deliver scheduled directives from resources/data
}

export function respond(state, directiveId, response) {
  // TODO: comply / stall / misreport — each with a different exposure profile
}

export function suspicion(state) {
  // TODO: Presidium's read on the Chair's reliability
}
