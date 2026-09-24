/**
 * The `resources` system: extraction, then refining, then every building's
 * plain produces/consumes. One entry in SYSTEM_ORDER, three stages, in the
 * order goods actually move — ore cut this tick can be smelted this tick.
 *
 * Before any of it, the ledger rolls the last tick's made/used tally into its
 * running rates (ledger.js), so a roll always covers one whole tick.
 */

import * as minerals from './minerals.js';
import * as componentChain from './componentChain.js';
import * as flowStock from './flowStock.js';
import { roll } from './ledger.js';

export function tick(state, ctx) {
  roll(state, ctx);
  minerals.tick(state, ctx);
  componentChain.tick(state, ctx);
  flowStock.tick(state, ctx);
}
