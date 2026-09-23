/**
 * The production chain: extraction at the dig face, batches at the smelter
 * and workshop, and buildings that stop when their inputs run out.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, ticksKeeping, instanceOf, dataset } from '../helpers/sim.js';
import { canProduce } from '../../src/systems/resources/componentChain.js';
import { collectModifiers } from '../../src/core/effects.js';

test('a dig face cuts every vein into its own store, and the seams deplete', async () => {
  const run = await runWith([['main-generator', 38], ['dig-face', 40]], { stocks: { fuel: 100 } });
  ticks(run, 60);

  const face = instanceOf(run, 'dig-face');
  assert.ok(face.stock['iron-ore'] > 0, 'expected iron ore at the face');
  assert.ok(face.stock.coal > 0, 'expected coal at the face');
  assert.ok(run.state.resources.seams['iron-ore'] < 1, 'expected the iron seam to have been worked');
  // Richer veins yield more: iron (abundance 1.0) beats gold (0.25).
  assert.ok(face.stock['iron-ore'] > face.stock['gold-ore']);
});

test('a dig face nobody empties fills up and stops cutting', async () => {
  const run = await runWith([['main-generator', 38], ['dig-face', 40]]);
  ticksKeeping(run, 400, { fuel: 100 });
  const face = instanceOf(run, 'dig-face');
  assert.equal(face.blocked, true);
  assert.ok(face.full.length > 0);
  const seam = run.state.resources.seams[face.full[0]];
  ticksKeeping(run, 20, { fuel: 100 });
  assert.equal(run.state.resources.seams[face.full[0]], seam, 'a full face leaves that vein alone');
});

test('a smelter cokes its own coal into fuel and carbon when both are short', async () => {
  const run = await runWith([['main-generator', 38], ['smelter', 37]], {
    stocks: { coal: 40, fuel: 10, 'activated-carbon': 0 },
  });
  ticks(run, 20);
  const smelter = instanceOf(run, 'smelter');
  assert.ok((smelter.stock['activated-carbon'] ?? 0) > 0, 'carbon lands in the smelter');
  assert.ok((smelter.stock.fuel ?? 0) > 0, 'fuel lands in the smelter');
});

test('a smelter whose output store is full holds its finished batch', async () => {
  const run = await runWith([['main-generator', 38], ['smelter', 37]]);
  instanceOf(run, 'smelter').recipeId = 'coke-coal';
  ticksKeeping(run, 100, { coal: 100, fuel: 100 });
  const smelter = instanceOf(run, 'smelter');
  assert.equal(smelter.blocked, true);
  assert.ok(smelter.full.length > 0);
});

test('a recipe building draws power only while it has a batch on', async () => {
  const run = await runWith([['main-generator', 38], ['smelter', 37], ['storehouse', 10]], {
    // The Shaft holds everything the smelter makes at reserve, so it idles.
    stocks: { fuel: 500, 'activated-carbon': 500, 'steel-billet': 500, 'copper-wire': 500, concrete: 500, glass: 500, coal: 20 },
  });
  ticks(run, 5);
  assert.equal(instanceOf(run, 'smelter').job, null);
  assert.equal(instanceOf(run, 'smelter').starved, false, 'idle at reserve is rest, not starvation');
  const idle = run.state.resources.flows.power.demand; // the storehouse's lights

  delete instanceOf(run, 'storehouse').stock.fuel;
  ticks(run, 2);
  assert.equal(instanceOf(run, 'smelter').job?.recipeId, 'coke-coal');
  assert.ok(run.state.resources.flows.power.demand > idle);
});

test('a pinned recipe runs even with its output at reserve', async () => {
  const run = await runWith([['main-generator', 38], ['smelter', 37], ['storehouse', 10]], {
    stocks: { fuel: 500, 'activated-carbon': 500, 'steel-billet': 500, 'iron-ore': 50, coal: 50 },
  });
  instanceOf(run, 'smelter').recipeId = 'smelt-steel';
  ticks(run, 2);
  assert.equal(instanceOf(run, 'smelter').job?.recipeId, 'smelt-steel');
});

test('a building starves on its own empty store, whatever a storehouse elsewhere holds', async () => {
  const run = await runWith([['main-generator', 38], ['storehouse', 10]], { stocks: { fuel: 500 } });
  delete instanceOf(run, 'main-generator').stock.fuel;
  ticks(run, 3);
  const generator = instanceOf(run, 'main-generator');
  assert.equal(generator.starved, true);
  assert.deepEqual(generator.missing, ['fuel']);
  assert.equal(run.state.resources.flows.power.generation, 0);
  assert.ok(instanceOf(run, 'storehouse').stock.fuel > 0, 'the fuel is there, just not here');
});

test('a starved generator restarts when fuel is brought', async () => {
  const run = await runWith([['main-generator', 38]], { stocks: { fuel: 0 } });
  ticks(run, 3);
  assert.equal(run.state.resources.flows.power.generation, 0);
  instanceOf(run, 'main-generator').stock.fuel = 20;
  ticks(run, 3);
  assert.ok(run.state.resources.flows.power.generation > 0);
});

test('a scrubber scrubs with carbon, and supplies nothing without it', async () => {
  const run = await runWith([['main-generator', 38], ['scrubber-bank', 20]], {
    stocks: { fuel: 100, 'activated-carbon': 10, 'scrubber-catalyst': 1 },
  });
  ticks(run, 3);
  assert.ok(collectModifiers(run.state, run.ctx).scrub['air-quality'] > 0);

  delete instanceOf(run, 'scrubber-bank').stock['activated-carbon'];
  ticks(run, 3);
  assert.equal(instanceOf(run, 'scrubber-bank').starved, true);
  assert.equal(collectModifiers(run.state, run.ctx).scrub['air-quality'] ?? 0, 0);
});

test('nothing local can make the scrubber catalyst', () => {
  assert.equal(canProduce('scrubber-catalyst', { catalog: dataset.catalog }), false);
  assert.equal(canProduce('fuel', { catalog: dataset.catalog }), true);
});
