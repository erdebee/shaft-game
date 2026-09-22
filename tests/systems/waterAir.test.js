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
const FUEL = { fuel: 1000 };

test('residents fill homes, and the overflow spreads over the habitable levels', async () => {
  const run = await runWith([['simple-suite', 24]]);
  run.state.population.headcount = 80 + 340;
  const byLevel = residentsByLevel(run.state, run.ctx);
  assert.equal(housingCapacity(run.state, run.ctx), 80);
  const deepest = run.ctx.shaft.layout.deepestHabitedLevel;
  assert.ok(Math.abs(byLevel[24] - (80 + 340 / deepest)) < 1e-9);
  assert.equal(byLevel[deepest + 1] ?? 0, 0);
  assert.ok(Math.abs(byLevel.reduce((a, b) => a + b, 0) - 420) < 1e-9);
});

test('when water runs short, people drink first and buildings are rationed', async () => {
  const layout = [...POWERED, ['deep-pump', 40], ['hydroponics-bay', 13], ['simple-suite', 24]];

  const plenty = await runWith(layout, { stocks: FUEL, tunables: { 'water.potablePerCapitaPerTick': 0.001 } });
  ticks(plenty, 5);
  assert.equal(plenty.state.resources.flows.water.peopleShare, 1);
  assert.equal(plenty.state.resources.flows.water.buildingShare, 1);

  // 2400 people at the default rate drink far more than one pump lifts.
  const short = await runWith(layout, { stocks: FUEL });
  ticks(short, 5);
  const water = short.state.resources.flows.water;
  assert.ok(water.peopleShare > 0 && water.peopleShare < 1);
  assert.equal(water.buildingShare, 0, 'buildings get nothing until people have drunk');
  assert.equal(instanceOf(short, 'hydroponics-bay').waterShare, 0);
});

test('cisterns bank a surplus and release it in a shortfall', async () => {
  const run = await runWith([...POWERED, ['deep-pump', 40], ['cistern', 32]], {
    stocks: FUEL, tunables: { 'water.potablePerCapitaPerTick': 0.001 },
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
  const dirty = await runWith(layout, { stocks: FUEL, tunables });
  const clean = await runWith([...layout, ['purifier', 41]], { stocks: { ...FUEL, 'activated-carbon': 100 }, tunables });
  ticks(dirty, 200);
  ticks(clean, 200);
  assert.ok(dirty.state.resources.flows.water.quality < 90, `got ${dirty.state.resources.flows.water.quality}`);
  assert.ok(clean.state.resources.flows.water.quality > dirty.state.resources.flows.water.quality);
});

test('a pump draws more power the higher people live', async () => {
  const low = await runWith([...POWERED, ['deep-pump', 40], ['simple-suite', 34]], { stocks: FUEL });
  const high = await runWith([...POWERED, ['deep-pump', 40], ['simple-suite', 4]], { stocks: FUEL });
  for (const run of [low, high]) { run.state.population.headcount = 80; ticks(run, 2); }
  const draw = (run) => {
    const pump = instanceOf(run, 'deep-pump');
    return powerDemand(pump, run.ctx.catalog.buildings.byId['deep-pump'], run.ctx, run.state);
  };
  assert.ok(draw(high) > draw(low));
});

test('residents foul their own level, and a scrubber cleans only within its radius', async () => {
  const run = await runWith([...POWERED, ['scrubber-bank', 20], ['simple-suite', 20], ['simple-suite', 30]], {
    stocks: { ...FUEL, 'activated-carbon': 100 },
  });
  run.state.population.headcount = 160;
  ticks(run, 60);
  const air = (i) => run.state.levels[i - 1].airQuality;
  const radius = run.ctx.config.air.scrubberRadiusLevels;
  assert.ok(air(20) > 95, `the scrubbed level should stay clean, got ${air(20)}`);
  assert.ok(air(30) < air(20), 'the unscrubbed crowded level should be worse');
  assert.ok(20 + radius < 30, 'test assumes level 30 is out of reach');
});

test('a sealed level loses its air even with a scrubber next door', async () => {
  const run = await runWith([...POWERED, ['scrubber-bank', 20]], { stocks: { ...FUEL, 'activated-carbon': 100 } });
  run.state.population.headcount = 0;
  run.state.levels[20].sealed = true; // level 21
  ticks(run, 30);
  assert.ok(run.state.levels[20].airQuality < 100 - 20);
  assert.equal(run.state.levels[19].airQuality, 100);
});

test('the catalyst arrives from outside on schedule, until the supply is cut', async () => {
  const run = await runWith([]);
  const every = run.ctx.config.air.catalystDeliveryIntervalTicks;
  const start = run.state.resources.stocks['scrubber-catalyst'];
  ticks(run, every);
  assert.equal(run.state.resources.stocks['scrubber-catalyst'], start + run.ctx.config.air.catalystDeliveryQty);

  run.state.resources.cutSupplies.push('scrubber-catalyst');
  ticks(run, every);
  assert.equal(run.state.resources.stocks['scrubber-catalyst'], start + run.ctx.config.air.catalystDeliveryQty);
});
