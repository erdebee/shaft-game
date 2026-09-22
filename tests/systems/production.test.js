/**
 * The production chain: extraction at the dig face, batches at the smelter
 * and workshop, and buildings that stop when their inputs run out.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, instanceOf, dataset } from '../helpers/sim.js';
import { canProduce } from '../../src/systems/resources/componentChain.js';
import { collectModifiers } from '../../src/core/effects.js';

test('a dig face cuts every vein, and the seams deplete', async () => {
  const run = await runWith([['main-generator', 38], ['dig-face', 40]], { stocks: { 'iron-ore': 0, coal: 0 } });
  ticks(run, 60);

  const { stocks, seams } = run.state.resources;
  assert.ok(stocks['iron-ore'] > 0, 'expected iron ore');
  assert.ok(stocks.coal > 0, 'expected coal');
  assert.ok(seams['iron-ore'] < 1, 'expected the iron seam to have been worked');
  // Richer veins yield more: iron (abundance 1.0) beats gold (0.25).
  assert.ok(stocks['iron-ore'] > stocks['gold-ore']);
});

test('a smelter cokes coal into fuel and carbon when both are short', async () => {
  const run = await runWith([['main-generator', 38], ['smelter', 37]], {
    stocks: { coal: 40, fuel: 10, 'activated-carbon': 0, 'iron-ore': 0, limestone: 0, 'silica-sand': 0 },
  });
  const carbonBefore = run.state.resources.stocks['activated-carbon'];
  ticks(run, 20);
  assert.ok(run.state.resources.stocks['activated-carbon'] > carbonBefore);
  assert.ok(run.state.resources.stocks.coal < 40);
});

test('a recipe building draws power only while it has a batch on', async () => {
  const run = await runWith([['main-generator', 38], ['smelter', 37]], {
    // Everything the smelter makes is already at reserve, so it idles.
    stocks: { fuel: 500, 'activated-carbon': 500, 'steel-billet': 500, 'copper-wire': 500, concrete: 500, glass: 500 },
  });
  ticks(run, 5);
  const smelter = instanceOf(run, 'smelter');
  assert.equal(smelter.job, null);
  assert.equal(run.state.resources.flows.power.demand, 0);

  run.state.resources.stocks.fuel = 0;
  ticks(run, 2);
  assert.equal(instanceOf(run, 'smelter').job?.recipeId, 'coke-coal');
  assert.ok(run.state.resources.flows.power.demand > 0);
});

test('a pinned recipe runs even with its output at reserve', async () => {
  const run = await runWith([['main-generator', 38], ['smelter', 37]], {
    stocks: { fuel: 500, 'activated-carbon': 500, 'steel-billet': 500, 'iron-ore': 50, coal: 50 },
  });
  instanceOf(run, 'smelter').recipeId = 'smelt-steel';
  ticks(run, 2);
  assert.equal(instanceOf(run, 'smelter').job?.recipeId, 'smelt-steel');
});

test('a generator with no fuel stops generating', async () => {
  const run = await runWith([['main-generator', 38], ['clinic', 22]], { stocks: { fuel: 1 } });
  ticks(run, 3);
  assert.ok(run.state.resources.flows.power.generation > 0, 'expected power while fuel lasts');
  ticks(run, 10);
  assert.equal(instanceOf(run, 'main-generator').starved, true);
  assert.equal(run.state.resources.flows.power.generation, 0);
});

test('a starved generator restarts when fuel returns', async () => {
  const run = await runWith([['main-generator', 38]], { stocks: { fuel: 0 } });
  ticks(run, 3);
  assert.equal(run.state.resources.flows.power.generation, 0);
  run.state.resources.stocks.fuel = 50;
  ticks(run, 3);
  assert.ok(run.state.resources.flows.power.generation > 0);
});

test('a scrubber scrubs with carbon, and supplies nothing without it', async () => {
  const run = await runWith([['main-generator', 38], ['scrubber-bank', 20]], {
    stocks: { fuel: 100, 'activated-carbon': 10 },
  });
  ticks(run, 3);
  assert.ok(collectModifiers(run.state, run.ctx).scrub['air-quality'] > 0);

  run.state.resources.stocks['activated-carbon'] = 0;
  ticks(run, 3);
  assert.equal(instanceOf(run, 'scrubber-bank').starved, true);
  assert.equal(collectModifiers(run.state, run.ctx).scrub['air-quality'] ?? 0, 0);
});

test('nothing local can make the scrubber catalyst', () => {
  assert.equal(canProduce('scrubber-catalyst', { catalog: dataset.catalog }), false);
  assert.equal(canProduce('fuel', { catalog: dataset.catalog }), true);
});
