/**
 * The `resources` system: extraction, then refining, then every building's
 * plain produces/consumes. One entry in SYSTEM_ORDER, three stages, in the
 * order goods actually move — ore cut this tick can be smelted this tick.
 */

import * as minerals from './minerals.js';
import * as componentChain from './componentChain.js';
import * as flowStock from './flowStock.js';

export function tick(state, ctx) {
  minerals.tick(state, ctx);
  componentChain.tick(state, ctx);
  flowStock.tick(state, ctx);
}
