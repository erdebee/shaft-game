/**
 * Water: pumped, used, reclaimed, stored and rationed — people first.
 * Air: fouled per level by residents and industry, scrubbed within a radius,
 * mixed between neighbours, and lost on a sealed level.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, instanceOf } from '../helpers/sim.js';
import { residentsByLevel, housingCapacity } from '../../src/systems/population/housing.js';
import { powerDemand } from '../../src/systems/buildings/buildingRegistry.js';

const POWERED = [['main-generator', 38], ['battery-bank', 38]];
const FUEL = { fuel: 100 };

test('residents fill homes, and the overflow spreads over the habitable levels', async () => {
  const run = await runWith([['simple-suite', 24]]);
  const places = run.ctx.catalog.buildings.byId['simple-suite'].housing;
  run.state.population.headcount = places + 340;
  const byLevel = residentsByLevel(run.state, run.ctx);
  assert.equal(housingCapacity(run.state, run.ctx), places);
  const deepest = run.ctx.shaft.layout.deepestHabitedLevel;
  assert.ok(Math.abs(byLevel[24] - (places + 340 / deepest)) < 1e-9);
  assert.equal(byLevel[deepest + 1] ?? 0, 0);
  assert.ok(Math.abs(byLevel.reduce((a, b) => a + b, 0) - (places + 340)) < 1e-9);
});

test('when water runs short, people drink first and buildings are rationed', async () => {
  const layout = [...POWERED, ['deep-pump', 40], ['hydroponics-bay', 13], ['simple-suite', 24]];

  const plenty = await runWith(layout, { keep: FUEL, tunables: { 'water.potablePerCapitaPerTick': 0.001 } });
  ticks(plenty, 5);
  assert.equal(plenty.state.resources.flows.water.peopleShare, 1);
  assert.equal(plenty.state.resources.flows.water.buildingShare, 1);

  // 2400 people at the default rate drink far more than one pump lifts.
  const short = await runWith(layout, { keep: FUEL });
  ticks(short, 5);
  const water = short.state.resources.flows.water;
  assert.ok(water.peopleShare > 0 && water.peopleShare < 1);
  assert.equal(water.buildingShare, 0, 'buildings get nothing until people have drunk');
  assert.equal(instanceOf(short, 'hydroponics-bay').waterShare, 0);
});

test('cisterns bank a surplus and release it in a shortfall', async () => {
  const run = await runWith([...POWERED, ['deep-pump', 40], ['cistern', 32]], {
    keep: FUEL, tunables: { 'water.potablePerCapitaPerTick': 0.001 },
  });
  ticks(run, 20);
  const water = run.state.resources.flows.water;
  assert.equal(water.capacity, 200);
  assert.equal(water.stored, 200);

  // Pump off: the cistern carries the demand.
  instanceOf(run, 'deep-pump').brokenDown = true;
  ticks(run, 1);
  assert.equal(run.state.resources.flows.water.peopleShare, 1);
  assert.ok(run.state.resources.flows.water.stored < 200);
});

test('reclaimed water fouls the supply unless a purifier treats it', async () => {
  const layout = [...POWERED, ['deep-pump', 40], ['reclamation-plant', 42]];
  const tunables = { 'water.potablePerCapitaPerTick': 0.01 };
  const dirty = await runWith(layout, { keep: FUEL, tunables });
  const clean = await runWith([...layout, ['purifier', 41]], { keep: { ...FUEL, 'activated-carbon': 100, 'scrubber-catalyst': 1 }, tunables });
  ticks(dirty, 200);
  ticks(clean, 200);
  assert.ok(dirty.state.resources.flows.water.quality < 90, `got ${dirty.state.resources.flows.water.quality}`);
  assert.ok(clean.state.resources.flows.water.quality > dirty.state.resources.flows.water.quality);
});

test('a pump draws more power the higher people live', async () => {
  const low = await runWith([...POWERED, ['deep-pump', 40], ['simple-suite', 34]], { keep: FUEL });
  const high = await runWith([...POWERED, ['deep-pump', 40], ['simple-suite', 4]], { keep: FUEL });
  for (const run of [low, high]) { run.state.population.headcount = 80; ticks(run, 2); }
  const draw = (run) => {
    const pump = instanceOf(run, 'deep-pump');
    return powerDemand(pump, run.ctx.catalog.buildings.byId['deep-pump'], run.ctx, run.state);
  };
  assert.ok(draw(high) > draw(low));
});

test('residents foul their own level, and an unducted scrubber cleans only its own', async () => {
  const run = await runWith([...POWERED, ['scrubber-bank', 20], ['simple-suite', 20], ['simple-suite', 22]], {
    keep: { ...FUEL, 'activated-carbon': 100, 'scrubber-catalyst': 1 },
    networks: ['duct-network'],
    tunables: { 'air.migrationRateBetweenLevels': 0 },
  });
  run.state.population.headcount = 160;
  ticks(run, 60);
  const air = (i) => run.state.levels[i - 1].airQuality;
  assert.ok(air(20) > 95, `the scrubbed level should stay clean, got ${air(20)}`);
  assert.ok(air(22) < air(20), 'the crowded level two floors down should be worse');
});

test('a sealed level loses its air even with a scrubber next door', async () => {
  const run = await runWith([...POWERED, ['scrubber-bank', 20]], { keep: { ...FUEL, 'activated-carbon': 100, 'scrubber-catalyst': 1 } });
  run.state.population.headcount = 0;
  run.state.levels[20].sealed = true; // level 21
  ticks(run, 30);
  assert.ok(run.state.levels[20].airQuality < 100 - 20);
  assert.equal(run.state.levels[19].airQuality, 100);
});

test('the catalyst arrives from outside on schedule, until the supply is cut', async () => {
  const run = await runWith([['shaft-exit', 1]]);
  const exit = instanceOf(run, 'shaft-exit');
  const every = run.ctx.config.air.catalystDeliveryIntervalTicks;
  const qty = run.ctx.config.air.catalystDeliveryQty;
  ticks(run, every);
  assert.equal(exit.stock['scrubber-catalyst'], qty, 'it lands at the Exit, for a porter to carry down');

  run.state.resources.cutSupplies.push('scrubber-catalyst');
  ticks(run, every);
  assert.equal(exit.stock['scrubber-catalyst'], qty);
});
