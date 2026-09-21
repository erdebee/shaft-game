/**
 * Stock and flow accounting. Shortfalls must be reported per consumer —
 * who goes without is a governance decision, not an arithmetic one.
 */

import test from 'node:test';

test.todo('inflow above capacity reports spill rather than clamping silently');
test.todo('demand above supply returns per-consumer shortfall');
test.todo('settle is deterministic under a fixed seed');
