/**
 * The ledger: what the Shaft makes and uses up, by source. The resource card
 * shows these numbers as "making 180 a day", so they have to be the goods that
 * were actually made and eaten — not the goods that were merely moved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, ticksKeeping, instanceOf, KITCHEN, FED_KEEP } from '../helpers/sim.js';
import { made, used, roll, ratesOf, sourcesOf } from '../../src/systems/resources/ledger.js';

test('a rate settles on what is made each tick, whatever the batches look like', async () => {
  const run = await runWith([['main-generator', 38]], { tunables: { 'stores.rateWindowTicks': 10 } });
  const { state, ctx } = run;
  state.resources.ledger = { tally: {}, rates: {} };

  // Six a tick, in one lump every third tick: two a tick, on average.
  for (let t = 0; t < 300; t++) {
    if (t % 3 === 0) made(state, 'steel-billet', 6, 'smelter');
    roll(state, ctx);
  }
  const rate = ratesOf(state, 'steel-billet');
  assert.ok(Math.abs(rate.madeTotal - 2) < 0.4, `expected about 2 a tick, got ${rate.madeTotal}`);
  assert.deepEqual(rate.made.map(([s]) => s), ['smelter']);
  assert.equal(rate.usedTotal, 0);
});

test('a source that stops fades out of the ledger rather than lingering', async () => {
  const run = await runWith([['main-generator', 38]], { tunables: { 'stores.rateWindowTicks': 5 } });
  const { state, ctx } = run;
  state.resources.ledger = { tally: {}, rates: {} };
  used(state, 'coal', 10, 'smelter');
  roll(state, ctx);
  assert.ok(ratesOf(state, 'coal').usedTotal > 0);
  for (let t = 0; t < 200; t++) roll(state, ctx);
  assert.equal(state.resources.ledger.rates.coal, undefined, 'a long-idle good is dropped');
});

test('people eating and a generator burning are recorded under their own names', async () => {
  const run = await runWith(KITCHEN, { keep: FED_KEEP });
  ticks(run, 40);
  const food = ratesOf(run.state, 'food');
  const fuel = ratesOf(run.state, 'fuel');
  assert.ok(food.used.some(([s, q]) => s === 'people' && q > 0), 'the canteens feed people');
  assert.ok(fuel.used.some(([s, q]) => s === 'main-generator' && q > 0), 'the generator burns fuel');
});

test('hauling is not production', async () => {
  // A porter carrying food from a bay to a canteen moves it; nobody made any
  // on the way. The ledger's food production has to be the bays' alone.
  const run = await runWith([...KITCHEN, ['hydroponics-bay', 27], ['porter-station', 26]], { keep: { fuel: 100 } });
  ticksKeeping(run, 80, { fuel: 100 });
  const food = ratesOf(run.state, 'food');
  assert.deepEqual(food.made.map(([s]) => s), ['hydroponics-bay']);
});

test('a smelter batch is counted once, in and out', async () => {
  const run = await runWith([['main-generator', 38], ['smelter', 37]], {
    stocks: { coal: 0, 'iron-ore': 0, 'copper-ore': 0, limestone: 0, 'silica-sand': 0, 'gold-ore': 0 },
    tunables: { 'stores.rateWindowTicks': 1 },
  });
  const smelter = instanceOf(run, 'smelter');
  smelter.stock = { coal: 12, 'iron-ore': 12 };
  smelter.recipeId = 'smelt-steel';

  // With a one-tick window a rate is exactly last tick's tally, so the tick a
  // batch starts shows its inputs and the tick it lands shows its output.
  let coal = 0;
  let steel = 0;
  for (let t = 0; t < 12; t++) {
    ticksKeeping(run, 1, { fuel: 100 });
    // The roll at the top of the NEXT tick is what publishes this one.
    const probe = structuredClone(run.state.resources.ledger);
    roll({ resources: { ledger: probe } }, run.ctx);
    coal += probe.rates.coal?.used?.smelter ?? 0;
    steel += probe.rates['steel-billet']?.made?.smelter ?? 0;
  }
  assert.ok(coal > 0 && steel > 0, 'expected at least one whole batch');
  // Inputs leave when a batch starts and the billet lands when it ends, so a
  // batch still on the go has used its coal and made nothing yet.
  const running = smelter.job ? 1 : 0;
  assert.equal(coal, steel + running, 'smelt-steel takes one coal for each billet');
});

test('the catalogue says who could make and use each good, built or not', async () => {
  const run = await runWith([['main-generator', 38]]);
  const { ctx } = run;
  const food = sourcesOf(ctx, 'food');
  assert.deepEqual(food.madeBy, ['hydroponics-bay', 'protein-vats']);
  assert.ok(food.usedBy.includes('people') && food.usedBy.includes('spoilage'));

  assert.ok(sourcesOf(ctx, 'iron-ore').madeBy.includes('dig-face'), 'ore comes from the dig face');
  assert.ok(sourcesOf(ctx, 'basic-parts').usedBy.includes('repairs'), 'parts go on repairs');
  assert.deepEqual(sourcesOf(ctx, 'scrubber-catalyst').madeBy, ['outside'],
    'nobody in the Shaft makes catalyst');
  assert.ok(sourcesOf(ctx, 'power').usedBy.length > 5, 'most rooms draw power');
});
