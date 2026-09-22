/**
 * The default Shaft as the player inherits it. A regression guard on balance:
 * the opening must hold for its first week untouched — nobody dies, nothing
 * goes dark, people have water — while the pressures it is built around
 * (the food running down, the homeless) are already visible.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRun, placeOpening } from '../../src/core/run.js';
import { stepOnce } from '../../src/core/engine.js';
import { dispatch } from '../../src/core/commands.js';
import { dataset, readJson } from '../helpers/sim.js';

test('the opening holds for a week untouched, with its pressures already showing', async () => {
  const { engine, state, ctx } = await createRun({ dataset, seed: 1234, readJson });
  placeOpening(state, ctx, dispatch);
  const start = state.population.headcount;
  const food = state.resources.stocks.food;

  for (let i = 0; i < 7 * 60; i++) stepOnce(engine);

  assert.ok(state.population.headcount >= start, 'nobody should have died in the first week');
  assert.equal(state.resources.flows.power.brownedOut.length, 0, 'nothing should be dark');
  assert.equal(state.population.needs.water, 1, 'everyone should have water');
  assert.ok(state.population.needs.housing < 1, 'the opening is short of homes on purpose');
  assert.ok(state.resources.stocks.food < food, 'the food stock should be running down');
  assert.equal(state.population.strikes.length, 0);
});
