/**
 * The `narrative` system: promise timers first, so a promise kept this tick
 * is kept before the next case is chosen, then the dilemma engine. Runs last
 * in SYSTEM_ORDER, so everything it reads is this tick's.
 */

import * as promises from './promiseTimers.js';
import * as dilemmas from './dilemmaEngine.js';

export function tick(state, ctx) {
  promises.tick(state, ctx);
  dilemmas.tick(state, ctx);
}
