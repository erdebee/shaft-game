/**
 * Layer resolution order and provenance tracking.
 * TODO: fill in once resolve() is implemented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYER_ORDER } from '../../src/config/configLoader.js';

test('layer order is base-first, sandbox-last', () => {
  assert.equal(LAYER_ORDER[0], 'base');
  assert.equal(LAYER_ORDER.at(-1), 'sandbox');
});

test.todo('later layers override earlier ones key by key');
test.todo('provenance records which layer supplied each value');
test.todo('unknown keys in an override layer fail validation');
