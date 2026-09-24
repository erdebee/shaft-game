/**
 * Local supply: what a building's own bins mean. These cover the reading of a
 * store rather than the moving of goods — the bands the inspector's bars and
 * the shaft view's shortage popover both draw from, and which have to be one
 * judgement rather than two.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, ticksKeeping, instanceOf } from '../helpers/sim.js';
import { bandOf, shortages, nameOf, amount, capacity } from '../../src/systems/resources/stores.js';

const defOf = (run, instance) => run.ctx.catalog.buildings.byId[instance.buildingId];
const idsOf = (list, band) => list.filter((e) => e.band === band).map((e) => e.id).sort();

test('both ends of a bin band at the same mark, from opposite directions', async () => {
  const run = await runWith([['main-generator', 38]], { tunables: { 'stores.lowMark': 0.25 } });
  const { ctx } = run;

  // An input is drawn DOWN, so it goes amber below the mark.
  assert.equal(bandOf(0, 100, 'in', ctx), 'out');
  assert.equal(bandOf(24, 100, 'in', ctx), 'low');
  assert.equal(bandOf(25, 100, 'in', ctx), 'ok', 'the mark itself is not yet low');
  assert.equal(bandOf(90, 100, 'in', ctx), 'ok');

  // An output is filled UP, so it goes amber above the same mark — a made
  // good that nobody has collected is a porter problem long before the bin
  // is actually full.
  assert.equal(bandOf(25, 100, 'out', ctx), 'ok', 'the mark itself is not yet filling');
  assert.equal(bandOf(26, 100, 'out', ctx), 'filling');
  assert.equal(bandOf(99, 100, 'out', ctx), 'filling');
  assert.equal(bandOf(100, 100, 'out', ctx), 'full');

  // A good nothing here wants is never a problem, however little of it there is.
  assert.equal(bandOf(0, 100, 'held', ctx), 'ok');
  assert.equal(bandOf(0, 0, 'out', ctx), 'ok', 'a bin with no capacity cannot be full');
});

test('a working building is not short of the bins it is not using', async () => {
  // A smelter has a place for all six ores. Given coal and iron it makes
  // steel, and the empty silica bin is not a problem it has.
  const run = await runWith([['main-generator', 38], ['smelter', 37]], {
    stocks: { coal: 0, 'iron-ore': 0, 'copper-ore': 0, limestone: 0, 'silica-sand': 0, 'gold-ore': 0 },
  });
  const smelter = instanceOf(run, 'smelter');
  const def = defOf(run, smelter);
  smelter.stock = { coal: 12, 'iron-ore': 12 };
  ticksKeeping(run, 3, { fuel: 100 });

  assert.ok(smelter.job, 'expected the smelter to have found a batch it could run');
  assert.equal(amount(smelter, 'silica-sand'), 0, 'and to be holding no silica');
  assert.deepEqual(shortages(smelter, def, run.ctx), [],
    'an empty bin it never asked for is not a shortage');
});

test('a building that has stopped names the goods that stopped it, and only those', async () => {
  const run = await runWith([['main-generator', 38], ['smelter', 37]], {
    stocks: { coal: 0, 'iron-ore': 0, 'copper-ore': 0, limestone: 0, 'silica-sand': 0, 'gold-ore': 0 },
  });
  ticksKeeping(run, 5, { fuel: 100 });

  const smelter = instanceOf(run, 'smelter');
  const short = shortages(smelter, defOf(run, smelter), run.ctx);
  assert.ok(smelter.missing.length > 0, 'expected a smelter with nothing at all to be waiting');
  assert.deepEqual(idsOf(short, 'out'), smelter.missing.slice().sort(),
    'out is exactly what the sim said it was waiting for, no more and no less');
  assert.ok(!short.some((e) => e.id === 'gold-ore'),
    'gold is refined at the machine shop, so an empty gold bin here is nobody\'s shortage');
  assert.ok(short.every((e) => e.band === 'out'), 'an empty bin cannot also be low');
});

test('a bin running down reads low while the building is still working', async () => {
  const run = await runWith([['main-generator', 38], ['smelter', 37]], {
    stocks: { coal: 0, 'iron-ore': 0, 'copper-ore': 0, limestone: 0, 'silica-sand': 0, 'gold-ore': 0 },
  });
  const smelter = instanceOf(run, 'smelter');
  const def = defOf(run, smelter);
  smelter.stock = { coal: 12, 'iron-ore': 12 };
  ticksKeeping(run, 3, { fuel: 100 });
  assert.deepEqual(shortages(smelter, def, run.ctx), [], 'a working smelter is short of nothing');

  // Draw the iron down without letting a tick notice: it is still running,
  // and this is the warning that is meant to arrive before it stops.
  smelter.stock['iron-ore'] = 0.2;
  const short = shortages(smelter, def, run.ctx);
  assert.deepEqual(idsOf(short, 'low'), ['iron-ore']);
  assert.deepEqual(idsOf(short, 'out'), [], 'low is a warning, not a stoppage');

  // The plate draws a low bin's bar at the share still held.
  const cap = capacity(smelter, def, run.ctx, 'iron-ore');
  assert.equal(short.find((e) => e.id === 'iron-ore').level, 0.2 / cap);
});

test('a building with nothing coming in is never short of anything', async () => {
  const run = await runWith([['main-generator', 38], ['storehouse', 35]], { stocks: { fuel: 100 } });
  ticks(run, 5);
  const store = instanceOf(run, 'storehouse');
  assert.deepEqual(shortages(store, defOf(run, store), run.ctx), [],
    'a storehouse holds goods for others and consumes none');
});

test('a rationed building is short of water, which is never in a store', async () => {
  const run = await runWith([['main-generator', 38], ['hydroponics-bay', 13]], { stocks: { fuel: 100 } });
  ticks(run, 3);
  const bay = instanceOf(run, 'hydroponics-bay');
  const def = defOf(run, bay);
  assert.equal(amount(bay, 'water'), 0, 'water is piped, so it is never in a bin');

  bay.waterShare = 0.5;
  assert.deepEqual(idsOf(shortages(bay, def, run.ctx), 'low'), ['water']);
  assert.equal(shortages(bay, def, run.ctx).find((e) => e.id === 'water').level, 0.5,
    'a rationed room\'s bar is its ration');

  bay.waterShare = 0;
  assert.deepEqual(idsOf(shortages(bay, def, run.ctx), 'out'), ['water']);

  bay.waterShare = 1;
  assert.ok(!shortages(bay, def, run.ctx).some((e) => e.id === 'water'));
});

test('the worst shortages come first, so a truncated list drops the least urgent', async () => {
  const run = await runWith([['main-generator', 38], ['workshop', 36]], { stocks: { fuel: 100 } });
  ticks(run, 3);
  const shop = instanceOf(run, 'workshop');
  const def = defOf(run, shop);

  shop.stock = { 'steel-billet': 0.3, 'copper-wire': 0.3 };
  shop.missing = ['steel-billet'];
  const bands = shortages(shop, def, run.ctx).map((e) => e.band);
  assert.equal(bands[0], 'out');
  assert.ok(!bands.slice(bands.lastIndexOf('out') + 1).includes('out'), 'every out precedes every low');
});

test('a resource is named, not spelled with its id', async () => {
  const run = await runWith([['main-generator', 38]]);
  assert.equal(nameOf(run.ctx, 'activated-carbon'), 'Activated carbon');
  assert.equal(nameOf(run.ctx, 'iron-ore'), 'Iron ore');
  assert.equal(nameOf(run.ctx, 'water'), 'Water', 'a flow has a name too');
  assert.equal(nameOf(run.ctx, 'focus'), 'Focus', 'so does an abstract');
  assert.equal(nameOf(run.ctx, 'no-such-thing'), 'no-such-thing', 'and an unknown id is left alone');
});
