/**
 * Porters: hired at a station, walking the route the player gives them,
 * picking up and dropping off at each stop, resting when worn out, and
 * waiting at the station when they have nothing to do.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, instanceOf } from '../helpers/sim.js';
import { dispatch } from '../../src/core/commands.js';
import { porterStatus } from '../../src/systems/haulage/haulageMethods.js';

const CALM = { 'water.potablePerCapitaPerTick': 0, 'air.contaminantPerCapitaPerTick': 0 };

async function withPorter(layout, options = {}) {
  const run = await runWith([['porter-station', 20], ...layout], { tunables: CALM, ...options });
  const station = instanceOf(run, 'porter-station');
  dispatch(run.state, run.ctx, { type: 'player:hirePorter', instanceId: station.instanceId });
  const porter = run.state.population.workers.at(-1);
  return { run, station, porter };
}

function route(run, porter, stops) {
  dispatch(run.state, run.ctx, { type: 'player:setRoute', workerId: porter.id, stops });
}

test('a porter is hired at a station and waits there with no route', async () => {
  const { run, station, porter } = await withPorter([]);
  assert.equal(porter.job, 'porter');
  assert.equal(porter.stationId, station.instanceId);
  assert.equal(porter.level, station.level);
  ticks(run, 5);
  assert.equal(porterStatus(run.state, porter), 'idle');
  assert.equal(run.state.haulage.trips.length, 0);
});

test('a porter carries a good from one building to another along the route', async () => {
  const { run, porter } = await withPorter([['depot', 13], ['depot', 26]]);
  const [from, to] = run.state.buildings.filter((b) => b.buildingId === 'depot');
  // Scrap, because food spoils a little in a porter's hands.
  from.stock = { scrap: 150 };
  route(run, porter, [
    { instanceId: from.instanceId, action: 'pickup', goodId: 'scrap', qty: 'all' },
    { instanceId: to.instanceId, action: 'dropoff', goodId: 'scrap', qty: 'all' },
  ]);
  ticks(run, 80);
  assert.equal(from.stock.scrap ?? 0, 0);
  assert.equal(to.stock.scrap, 150);
  assert.ok(porter.levelsWalked > 0);
});

test('a porter carries no more than one load, and a set quantity caps a stop', async () => {
  const { run, porter } = await withPorter([['depot', 20], ['depot', 21]]);
  const [from, to] = run.state.buildings.filter((b) => b.buildingId === 'depot');
  const load = run.ctx.config.haulage.porterCapacity;
  from.stock = { coal: load * 3 };
  route(run, porter, [
    { instanceId: from.instanceId, action: 'pickup', goodId: 'coal', qty: 'all' },
    { instanceId: to.instanceId, action: 'dropoff', goodId: 'coal', qty: 50 },
  ]);
  ticks(run, 1);
  assert.equal(porter.carrying.coal, load);
  ticks(run, 4);
  assert.ok(to.stock.coal <= 50 + 1e-9, 'only 50 per visit is left');
});

test('a drop-off leaves only what the building has room for', async () => {
  const { run, porter } = await withPorter([['main-generator', 38], ['depot', 38]]);
  const depot = instanceOf(run, 'depot');
  const generator = instanceOf(run, 'main-generator');
  depot.stock = { fuel: 150 };
  generator.stock = {};
  route(run, porter, [
    { instanceId: depot.instanceId, action: 'pickup', goodId: 'fuel', qty: 'all' },
    { instanceId: generator.instanceId, action: 'dropoff', goodId: 'fuel', qty: 'all' },
  ]);
  ticks(run, 60); // the walk down from the station on 20
  const room = run.ctx.config.stores.inputBufferTicks * 0.2;
  assert.ok(generator.stock.fuel <= room + 1e-9);
  assert.ok(porter.carrying.fuel > 0, 'the rest stays in hand');
});

test('a stop at a demolished building is skipped', async () => {
  const { run, porter } = await withPorter([['depot', 20], ['school', 21], ['depot', 22]]);
  const [a, b] = run.state.buildings.filter((x) => x.buildingId === 'depot');
  const school = instanceOf(run, 'school');
  a.stock = { paper: 20 };
  route(run, porter, [
    { instanceId: a.instanceId, action: 'pickup', goodId: 'paper', qty: 'all' },
    { instanceId: school.instanceId, action: 'dropoff', goodId: 'paper', qty: 'all' },
    { instanceId: b.instanceId, action: 'dropoff', goodId: 'paper', qty: 'all' },
  ]);
  dispatch(run.state, run.ctx, { type: 'player:demolish', instanceId: school.instanceId });
  ticks(run, 20);
  assert.equal(b.stock.paper, 20);
});

test('a worn-out porter goes home to rest, then takes up the route again', async () => {
  const { run, station, porter } = await withPorter([['depot', 5], ['depot', 35]]);
  const [from, to] = run.state.buildings.filter((b) => b.buildingId === 'depot');
  from.stock = { wood: 1000 };
  route(run, porter, [
    { instanceId: from.instanceId, action: 'pickup', goodId: 'wood', qty: 10 },
    { instanceId: to.instanceId, action: 'dropoff', goodId: 'wood', qty: 'all' },
  ]);
  porter.fatigue = run.ctx.config.haulage.porterRestAt;
  ticks(run, 1);
  assert.equal(porter.resting, true);
  ticks(run, 20); // fifteen levels home, at a level a tick
  assert.equal(porter.level, station.level, 'rests at the station');
  assert.equal(porter.resting, true);
  ticks(run, 400);
  assert.equal(porter.resting, false);
  assert.ok((to.stock.wood ?? 0) > 0, 'back at work');
});

test('a station houses only so many porters, and a dismissed porter is gone', async () => {
  const { run, station } = await withPorter([]);
  const beds = run.ctx.catalog.buildings.byId['porter-station'].porterStation.porters;
  for (let i = 0; i < beds + 3; i++) dispatch(run.state, run.ctx, { type: 'player:hirePorter', instanceId: station.instanceId });
  const living = () => run.state.population.workers.filter((w) => w.stationId === station.instanceId);
  assert.equal(living().length, beds);
  dispatch(run.state, run.ctx, { type: 'player:dismissPorter', workerId: living()[0].id });
  assert.equal(living().length, beds - 1);
});

test('a route with a malformed stop is refused whole', async () => {
  const { run, porter } = await withPorter([['depot', 20]]);
  const depot = instanceOf(run, 'depot');
  route(run, porter, [{ instanceId: depot.instanceId, action: 'pickup', goodId: 'food', qty: 'all' }]);
  route(run, porter, [
    { instanceId: depot.instanceId, action: 'pickup', goodId: 'food', qty: 'all' },
    { instanceId: depot.instanceId, action: 'steal', goodId: 'food', qty: 'all' },
  ]);
  assert.equal(porter.route.length, 1);
  route(run, porter, [{ instanceId: 'b999', action: 'pickup', goodId: 'food', qty: 'all' }]);
  assert.equal(porter.route[0].instanceId, depot.instanceId);
});
