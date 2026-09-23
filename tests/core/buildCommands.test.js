/**
 * The player's building commands: placing costs materials and says why it
 * cannot, demolition spares the fixed structure, recipes can be pinned.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, instanceOf } from '../helpers/sim.js';
import { dispatch, placement, buildCost } from '../../src/core/commands.js';

test('building costs its materials, and is refused without them', async () => {
  const run = await runWith([]);
  const def = run.ctx.catalog.buildings.byId.workshop;
  const cost = buildCost(run.ctx, def);
  assert.ok(cost.length > 0);

  for (const c of cost) run.state.resources.stocks[c.id] = c.qty;
  dispatch(run.state, run.ctx, { type: 'player:placeBuilding', buildingId: 'workshop', level: 36 });
  assert.ok(instanceOf(run, 'workshop'));
  for (const c of cost) assert.equal(run.state.resources.stocks[c.id], 0);

  const again = placement(run.state, run.ctx, 'workshop', 35);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'cost');
});

test('placement explains a refusal', async () => {
  const run = await runWith([], { stocks: { 'basic-parts': 1e4, concrete: 1e4 } });
  assert.equal(placement(run.state, run.ctx, 'dig-face', 5).reason, 'wrong-depth');
  assert.equal(placement(run.state, run.ctx, 'shaft-exit', 7, { inherited: true }).reason, 'fixed');
  assert.equal(placement(run.state, run.ctx, 'school', 99).reason, 'no-level');
  for (let i = 0; i < 5; i++) dispatch(run.state, run.ctx, { type: 'player:placeBuilding', buildingId: 'school', level: 10 });
  assert.equal(placement(run.state, run.ctx, 'school', 10).ok, false);
});

test('demolition removes a building, but never the fixed structure', async () => {
  const run = await runWith([['school', 10], ['shaft-exit', 1]]);
  dispatch(run.state, run.ctx, { type: 'player:demolish', instanceId: instanceOf(run, 'school').instanceId });
  dispatch(run.state, run.ctx, { type: 'player:demolish', instanceId: instanceOf(run, 'shaft-exit').instanceId });
  assert.equal(instanceOf(run, 'school'), undefined);
  assert.ok(instanceOf(run, 'shaft-exit'));
});

test('a recipe can be pinned, and only to its own building', async () => {
  const run = await runWith([['smelter', 37]]);
  const smelter = instanceOf(run, 'smelter');
  dispatch(run.state, run.ctx, { type: 'player:setRecipe', instanceId: smelter.instanceId, recipeId: 'make-basic-parts' });
  assert.equal(smelter.recipeId, null, 'a workshop recipe cannot be pinned on a smelter');
  dispatch(run.state, run.ctx, { type: 'player:setRecipe', instanceId: smelter.instanceId, recipeId: 'melt-glass' });
  assert.equal(smelter.recipeId, 'melt-glass');
  dispatch(run.state, run.ctx, { type: 'player:setRecipe', instanceId: smelter.instanceId, recipeId: null });
  assert.equal(smelter.recipeId, null);
});
