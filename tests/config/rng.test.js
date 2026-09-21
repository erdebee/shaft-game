/**
 * Seeded RNG determinism. Run: npm test
 * Named streams must be independent — adding a draw in one stream must not
 * shift another, or narrative edits will silently rebalance the economy.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStream } from '../../src/config/rng.js';

test('same seed and stream name produce the same sequence', () => {
  const a = createStream('seed-1', 'economy');
  const b = createStream('seed-1', 'economy');
  assert.equal(a.next(), b.next());
  assert.equal(a.next(), b.next());
});

test('different stream names diverge', () => {
  const a = createStream('seed-1', 'economy');
  const b = createStream('seed-1', 'narrative');
  assert.notEqual(a.next(), b.next());
});

test('draws in one stream do not affect another', () => {
  const control = createStream('seed-1', 'narrative').next();
  const economy = createStream('seed-1', 'economy');
  economy.next(); economy.next();
  assert.equal(createStream('seed-1', 'narrative').next(), control);
});
