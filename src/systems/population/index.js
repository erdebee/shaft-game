/**
 * The `population` system: the named roster's rest, then the aggregate
 * population's body (vitals), then the labour pool dealt out for next tick.
 * Staffing runs last so that anyone who died or fell sick this tick is out of
 * the pool before the next tick's production reads it.
 */

import * as roster from './roster.js';
import * as vitals from './vitals.js';
import * as staffing from './staffing.js';

export function tick(state, ctx) {
  roster.tick(state, ctx);
  vitals.tick(state, ctx);
  staffing.tick(state, ctx);
}
