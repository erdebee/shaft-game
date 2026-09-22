/**
 * Maintenance: crews restore condition at a cost in parts, broken buildings
 * and life support first, and stall when the parts run out.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, instanceOf } from '../helpers/sim.js';
import { dispatch } from '../../src/core/commands.js';

const CALM = { 'water.potablePerCapitaPerTick': 0, 'air.contaminantPerCapitaPerTick': 0 };
const STOCKED = { food: 1e6, fuel: 500, 'basic-parts': 100, concrete: 50 };

test('crews restore a worn building and spend its repair cost', async () => {
  const run = await runWith([['main-generator', 38], ['workshop', 36]], { stocks: STOCKED, tunables: CALM });
  const workshop = instanceOf(run, 'workshop');
  workshop.condition = 0.5;
  const parts = run.state.resources.stocks['basic-parts'];
  ticks(run, 40);
  assert.ok(instanceOf(run, 'workshop').condition > 0.9);
  assert.ok(run.state.resources.stocks['basic-parts'] < parts);
});

test('a broken-down building is repaired before a merely worn one', async () => {
  const run = await runWith([['main-generator', 38], ['school', 10], ['canteen', 26]], {
    stocks: STOCKED, tunables: { ...CALM, 'buildings.maintenanceCrewsStart': 1 },
  });
  const school = instanceOf(run, 'school');
  const canteen = instanceOf(run, 'canteen');
  school.condition = 0.5;
  canteen.condition = 0.1;
  canteen.brokenDown = true;
  ticks(run, 3);
  assert.ok(instanceOf(run, 'canteen').condition > 0.1);
  // It wears a hair meanwhile, but nobody has touched it.
  assert.ok(instanceOf(run, 'school').condition <= 0.5, 'the school waits its turn');
});

test('with no parts, repairs stall and say so', async () => {
  const run = await runWith([['main-generator', 38], ['school', 10]], {
    stocks: { ...STOCKED, 'basic-parts': 0 }, tunables: CALM,
  });
  instanceOf(run, 'school').condition = 0.5;
  ticks(run, 10);
  assert.ok(instanceOf(run, 'school').condition <= 0.5);
  assert.equal(run.state.maintenance.stalledOn, 'basic-parts');
});

test('crews come out of the labour pool, and the player sets how many', async () => {
  const run = await runWith([['main-generator', 38]], { stocks: STOCKED, tunables: CALM });
  dispatch(run.state, run.ctx, { type: 'player:setMaintenanceCrews', count: 4 });
  ticks(run, 1);
  assert.equal(run.state.maintenance.crews, 4);
  const perCrew = run.ctx.config.population.workersPerStaffPoint;
  assert.ok(run.state.population.labour.assigned >= 4 * perCrew);
});

test('an unmaintained building wears down over weeks, not days', async () => {
  const run = await runWith([['main-generator', 38], ['hydroponics-bay', 13], ['deep-pump', 40]], {
    stocks: STOCKED, tunables: { ...CALM, 'buildings.maintenanceCrewsStart': 0 },
  });
  const ticksPerDay = 60;
  ticks(run, 7 * ticksPerDay);
  assert.ok(instanceOf(run, 'hydroponics-bay').condition > 0.6, 'still working after a week');
});
