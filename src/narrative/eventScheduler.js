/**
 * eventScheduler.js
 * Queues timed and conditional events: scheduled Board sessions, delayed
 * consequences, chapter beats that must fire regardless of player state.
 */

export function schedule(state, { eventId, atTick, condition }) {
  // TODO
}

export function tick(state) {
  // TODO: fire due events whose conditions still hold, drop the rest
}

export function cancel(state, eventId) {
  // TODO
}
