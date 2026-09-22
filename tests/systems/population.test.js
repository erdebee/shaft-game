/**
 * The aggregate population: eating, health, deaths by cause, births, and the
 * labour pool dealt out in power-ladder order.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, instanceOf } from '../helpers/sim.js';
import { dispatch } from '../../src/core/commands.js';
import { labourPool } from '../../src/systems/population/staffing.js';

const POWERED = [['main-generator', 38], ['battery-bank', 38]];
const CALM = {
  // Enough water that thirst stays out of tests about something else.
  'water.potablePerCapitaPerTick': 0,
};

test('people eat per head from the food stock', async () => {
  const run = await runWith([], { stocks: { food: 1000 }, tunables: CALM });
  const pop = run.state.population;
  const before = run.state.resources.stocks.food;
  ticks(run, 1);
  const eaten = before - run.state.resources.stocks.food;
  const perHead = run.ctx.config.population.foodPerCapitaPerTick;
  assert.ok(eaten > 0 && eaten <= pop.headcount * perHead * 1.2, `ate ${eaten}`);
  assert.equal(pop.needs.food, 1);
});

test('with no food, people starve — in proportion to how short they are', async () => {
  const run = await runWith([], { stocks: { food: 0 }, tunables: CALM });
  const start = run.state.population.headcount;
  ticks(run, 60);
  const pop = run.state.population;
  assert.equal(pop.needs.food, 0);
  assert.ok(pop.headcount < start);
  // Every cohort shrinks by the same share, so cohorts keep tracking headcount.
  const total = Object.values(pop.cohorts).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - pop.headcount) / pop.headcount < 0.02, 'cohorts track headcount');
});

test('the day report counts deaths by cause, then resets', async () => {
  const run = await runWith([], { stocks: { food: 0 }, tunables: CALM });
  const reports = [];
  const { on } = await import('../../src/core/eventBus.js');
  const off = on('population:day', (p) => reports.push(p));
  ticks(run, 60);
  off?.();
  assert.ok(reports.length >= 1);
  assert.ok(reports.at(-1).deaths.starvation > 0);
  assert.equal(run.state.population.vitalStats.deaths.starvation, 0);
});

test('people on a level with critical air suffocate; clean levels do not', async () => {
  const run = await runWith([['simple-suite', 20]], { stocks: { food: 1e6 }, tunables: CALM });
  run.state.population.headcount = 80;
  const level = run.state.levels[19];
  level.sealed = true; // nothing reaches it, and it goes stale
  ticks(run, 200);
  assert.ok(level.airQuality < run.ctx.config.air.qualityCriticalThreshold);
  assert.ok(run.state.population.headcount < 80);
});

test('health sinks in bad air and a clinic lifts it', async () => {
  // A pump for the clinic's water; nobody else drinks (CALM).
  const layout = [...POWERED, ['deep-pump', 40], ['simple-suite', 20]];
  const tunables = { ...CALM, 'air.contaminantPerCapitaPerTick': 0 };
  const sick = await runWith(layout, { stocks: { food: 1e6, fuel: 500 }, tunables });
  const tended = await runWith([...layout, ['clinic', 22]], { stocks: { food: 1e6, fuel: 500 }, tunables });
  for (const run of [sick, tended]) {
    for (const level of run.state.levels) level.airQuality = 40;
    run.state.population.health = 60;
  }
  ticks(sick, 150);
  ticks(tended, 150);
  assert.ok(sick.state.population.health < 60, `untended health ${sick.state.population.health}`);
  assert.ok(tended.state.population.health > 60, `tended health ${tended.state.population.health}`);
});

test('sickness shrinks the labour pool', async () => {
  const run = await runWith([], { tunables: CALM });
  const healthy = labourPool(run.state, run.ctx);
  run.state.population.health = 10;
  assert.ok(labourPool(run.state, run.ctx) < healthy);
});

test('a short labour pool empties the amenities before life support', async () => {
  const run = await runWith([...POWERED, ['scrubber-bank', 20], ['school', 10]], {
    stocks: { fuel: 500, 'activated-carbon': 100, food: 1e6 }, tunables: CALM,
  });
  const perCrew = run.ctx.config.population.workersPerStaffPoint;
  // Just enough people for the life-support crews and not the school's.
  const lifeSupport = (5 + 1 + 2) * perCrew;
  run.state.population.headcount = 1;
  run.state.population.workers = [];
  run.state.maintenance.crewTarget = 0;
  const factor = labourPool(run.state, run.ctx);
  run.state.population.headcount = (lifeSupport + perCrew / 2) / factor;
  ticks(run, 1);
  assert.equal(instanceOf(run, 'scrubber-bank').staffing, 2);
  assert.equal(instanceOf(run, 'main-generator').staffing, 5);
  assert.equal(instanceOf(run, 'school').staffing, 0);
  assert.ok(run.state.population.labour.wanted > run.state.population.labour.pool);
});

test("the player sets a staff target, capped at the building's posts", async () => {
  const run = await runWith([...POWERED, ['school', 10]], { stocks: { fuel: 500 }, tunables: CALM });
  const school = instanceOf(run, 'school');
  dispatch(run.state, run.ctx, { type: 'player:assignStaff', instanceId: school.instanceId, count: 1 });
  ticks(run, 1);
  assert.equal(instanceOf(run, 'school').staffing, 1);
  dispatch(run.state, run.ctx, { type: 'player:assignStaff', instanceId: school.instanceId, count: 99 });
  ticks(run, 1);
  assert.equal(instanceOf(run, 'school').staffing, run.ctx.catalog.buildings.byId.school.staffing);
});

test("a striking faction's buildings get no staff", async () => {
  const run = await runWith([...POWERED, ['hydroponics-bay', 13]], { stocks: { fuel: 500 }, tunables: CALM });
  run.state.population.strikes.push({ faction: 'cultivation', untilTick: 1e9 });
  ticks(run, 1);
  assert.equal(instanceOf(run, 'hydroponics-bay').staffing, 0);
  assert.equal(instanceOf(run, 'main-generator').staffing, 5);
});

test('the birth lottery adds children once a cycle, in a fed Shaft', async () => {
  // Clean air and water, so nobody dies to muddy the count.
  const run = await runWith([], { stocks: { food: 1e6 }, tunables: { ...CALM, 'air.contaminantPerCapitaPerTick': 0 } });
  const { birthLotteryCycleTicks: cycle, birthLotterySlotsPerCycle: slots } = run.ctx.config.population;
  ticks(run, cycle - 1);
  const children = run.state.population.cohorts.children;
  ticks(run, 1);
  assert.equal(run.state.population.cohorts.children, children + slots);
});

test('a hungry Shaft has no births', async () => {
  const run = await runWith([], { stocks: { food: 0 }, tunables: CALM });
  const cycle = run.ctx.config.population.birthLotteryCycleTicks;
  ticks(run, cycle);
  assert.equal(run.state.population.vitalStats.births, 0);
});
