/**
 * Porters: hired at a station, walking the route the player gives them,
 * picking up and dropping off at each stop, resting when worn out, and
 * waiting at the station when they have nothing to do.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, instanceOf } from '../helpers/sim.js';
import { dispatch } from '../../src/core/commands.js';
import { porterStatus, stopsOf, portersOn } from '../../src/systems/haulage/haulageMethods.js';

const CALM = { 'water.potablePerCapitaPerTick': 0, 'air.contaminantPerCapitaPerTick': 0 };

async function withPorter(layout, options = {}) {
  const run = await runWith([['porter-station', 20], ...layout], { tunables: CALM, ...options });
  const station = instanceOf(run, 'porter-station');
  dispatch(run.state, run.ctx, { type: 'player:hirePorter', instanceId: station.instanceId });
  const porter = run.state.population.workers.at(-1);
  return { run, station, porter };
}

/** Set the porter's route's stops, giving them a route of their own first if they have none. */
function route(run, porter, stops) {
  if (porter.routeId === null) dispatch(run.state, run.ctx, { type: 'player:createRoute', workerId: porter.id });
  dispatch(run.state, run.ctx, { type: 'player:setRoute', routeId: porter.routeId, stops });
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
  while (!porter.carrying.coal) ticks(run, 1); // along the floor to the depot
  assert.equal(porter.carrying.coal, load);
  while (!to.stock?.coal) ticks(run, 1);
  assert.equal(to.stock.coal, 50, 'only 50 per visit is left');
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

test('a porter walks the floor to the room, and takes time to load and unload', async () => {
  const { run, station, porter } = await withPorter([['depot', 20], ['depot', 24]]);
  const [from, to] = run.state.buildings.filter((b) => b.buildingId === 'depot');
  from.stock = { scrap: 600 };
  route(run, porter, [
    { instanceId: from.instanceId, action: 'pickup', goodId: 'scrap', qty: 'all' },
    { instanceId: to.instanceId, action: 'dropoff', goodId: 'scrap', qty: 'all' },
  ]);
  ticks(run, 1);
  const across = run.state.haulage.trips[0];
  assert.deepEqual(across.legs.map((l) => l.kind), ['floor'], 'same level: along the floor only');
  assert.equal(across.legs[0].fromId, station.instanceId);
  assert.equal(across.toId, from.instanceId);

  while (porterStatus(run.state, porter) !== 'loading') ticks(run, 1);
  assert.equal(porter.at, from.instanceId);
  assert.equal(porter.handling.goodId, 'scrap');
  assert.equal(porter.handling.qty, 600);
  const held = porter.handling.untilTick - run.state.clock.tick;
  assert.ok(held >= 1, 'loading takes time');
  ticks(run, held);
  assert.equal(porterStatus(run.state, porter), 'walking', 'on the way once loaded');
  const down = run.state.haulage.trips.find((t) => t.workerId === porter.id);
  assert.deepEqual(down.legs.map((l) => l.kind), ['floor', 'stair', 'floor'], 'to the stairs, down, and along');

  while (porterStatus(run.state, porter) !== 'unloading') ticks(run, 1);
  assert.equal(porter.at, to.instanceId);
  assert.equal(to.stock.scrap, 600);
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
  assert.equal(stopsOf(run.state, porter).length, 1);
  route(run, porter, [{ instanceId: 'b999', action: 'pickup', goodId: 'food', qty: 'all' }]);
  assert.equal(stopsOf(run.state, porter)[0].instanceId, depot.instanceId);
});

test('a drop-off with a share leaves that share of what the porter holds, and carries the rest on', async () => {
  const { run, porter } = await withPorter([['depot', 20], ['depot', 21], ['depot', 22]]);
  const [from, half, rest] = run.state.buildings.filter((b) => b.buildingId === 'depot');
  from.stock = { scrap: 200 };
  route(run, porter, [
    { instanceId: from.instanceId, action: 'pickup', goodId: 'scrap', qty: 'all' },
    { instanceId: half.instanceId, action: 'dropoff', goodId: 'scrap', qty: 'all', share: 0.25 },
    { instanceId: rest.instanceId, action: 'dropoff', goodId: 'scrap', qty: 'all' },
  ]);
  while (!rest.stock?.scrap) ticks(run, 1);
  assert.equal(half.stock.scrap, 50, 'a quarter of the 200 carried');
  assert.equal(rest.stock.scrap, 150, 'the rest goes on to the next stop');
});

test('a pick-up of 0 takes nothing, and a share is only for drop-offs', async () => {
  const { run, porter } = await withPorter([['depot', 20]]);
  const depot = instanceOf(run, 'depot');
  depot.stock = { scrap: 100 };
  route(run, porter, [{ instanceId: depot.instanceId, action: 'pickup', goodId: 'scrap', qty: 0 }]);
  assert.equal(stopsOf(run.state, porter)[0].goods[0].qty, 0);
  ticks(run, 30);
  assert.equal(depot.stock.scrap, 100);
  assert.equal(porter.carrying.scrap ?? 0, 0);

  route(run, porter, [{ instanceId: depot.instanceId, action: 'pickup', goodId: 'scrap', qty: 'all', share: 0.5 }]);
  assert.equal(stopsOf(run.state, porter)[0].goods[0].qty, 0, 'refused: a pick-up has no share');
  route(run, porter, [{ instanceId: depot.instanceId, action: 'dropoff', goodId: 'scrap', qty: 'all', share: 1.5 }]);
  assert.equal(stopsOf(run.state, porter)[0].goods[0].action, 'pickup', 'refused: a share is at most 1');
});

test('routes are named, shared by the porters assigned to them, and let go when deleted', async () => {
  const { run, station, porter } = await withPorter([['depot', 20], ['depot', 21]]);
  dispatch(run.state, run.ctx, { type: 'player:hirePorter', instanceId: station.instanceId });
  const second = run.state.population.workers.at(-1);
  const [from, to] = run.state.buildings.filter((b) => b.buildingId === 'depot');
  from.stock = { scrap: 300 };

  dispatch(run.state, run.ctx, { type: 'player:createRoute', name: '  Scrap run  ' });
  const made = run.state.haulage.routes.at(-1);
  assert.equal(made.name, 'Scrap run');
  assert.equal(made.stops.length, 0);
  dispatch(run.state, run.ctx, { type: 'player:renameRoute', routeId: made.id, name: '   ' });
  assert.equal(made.name, 'Scrap run', 'a blank name is refused');
  dispatch(run.state, run.ctx, { type: 'player:renameRoute', routeId: made.id, name: 'Down the stairs' });
  assert.equal(made.name, 'Down the stairs');

  dispatch(run.state, run.ctx, { type: 'player:setRoute', routeId: made.id, stops: [
    { instanceId: from.instanceId, action: 'pickup', goodId: 'scrap', qty: 'all' },
    { instanceId: to.instanceId, action: 'dropoff', goodId: 'scrap', qty: 'all' },
  ] });
  for (const w of [porter, second]) dispatch(run.state, run.ctx, { type: 'player:assignRoute', workerId: w.id, routeId: made.id });
  assert.deepEqual(portersOn(run.state, made.id).map((w) => w.id), [porter.id, second.id]);
  dispatch(run.state, run.ctx, { type: 'player:assignRoute', workerId: porter.id, routeId: 'r999' });
  assert.equal(porter.routeId, made.id, 'an unknown route is refused');

  ticks(run, 120);
  assert.equal(to.stock.scrap, 300, 'both porters walk the one route');
  assert.ok(porter.levelsWalked > 0 && second.levelsWalked > 0);

  dispatch(run.state, run.ctx, { type: 'player:deleteRoute', routeId: made.id });
  assert.equal(run.state.haulage.routes.length, 0);
  assert.equal(porter.routeId, null);
  assert.equal(second.routeId, null);
  ticks(run, 60);
  assert.equal(porterStatus(run.state, porter), 'idle');
  assert.equal(porter.at, station.instanceId, 'a porter with no route goes home');
});

test('a new route can be made for a porter in the same command', async () => {
  const { run, porter } = await withPorter([]);
  dispatch(run.state, run.ctx, { type: 'player:createRoute', workerId: porter.id });
  assert.equal(porter.routeId, run.state.haulage.routes.at(-1).id);
  assert.equal(run.state.haulage.routes.at(-1).name, 'Route 1');
});

test('a stop handles several goods, each with its own amount: drop-offs first, then pick-ups', async () => {
  const { run, porter } = await withPorter([['depot', 20], ['depot', 21]]);
  const [a, b] = run.state.buildings.filter((x) => x.buildingId === 'depot');
  const cap = run.ctx.config.haulage.porterCapacity;
  a.stock = { scrap: 100, coal: 100 };
  b.stock = { coal: cap };
  route(run, porter, [
    { instanceId: a.instanceId, goods: [
      { action: 'pickup', goodId: 'scrap', qty: 'all' },
      { action: 'pickup', goodId: 'coal', qty: 30 },
    ] },
    { instanceId: b.instanceId, goods: [
      { action: 'pickup', goodId: 'coal', qty: cap },
      { action: 'dropoff', goodId: 'scrap', qty: 'all', share: 0.5 },
      { action: 'dropoff', goodId: 'coal', qty: 'all' },
    ] },
  ]);
  const stop = stopsOf(run.state, porter)[1];
  assert.equal(stop.goods.length, 3);
  // Until the porter has been round once and set off back to the first stop.
  while (!(b.stock.scrap && porter.stop === 0 && porter.tripId !== null)) ticks(run, 1);
  assert.equal(a.stock.scrap ?? 0, 0, 'all the scrap was taken');
  assert.equal(a.stock.coal, 70, 'and 30 of the coal');
  assert.equal(b.stock.scrap, 50, 'half the scrap was left at the second stop');
  assert.equal(porter.carrying.scrap, 50, 'and the other half carried on');
  // The coal was dropped before the pick-up, so it went into a full depot's
  // room only as far as there was room, and then the porter filled their arms.
  assert.ok(porter.carrying.coal > 0);
});

test('a stop in the old one-good form is still taken, as a stop with that one good', async () => {
  const { run, porter } = await withPorter([['depot', 20]]);
  const depot = instanceOf(run, 'depot');
  route(run, porter, [{ instanceId: depot.instanceId, action: 'pickup', goodId: 'scrap', qty: 5 }]);
  assert.deepEqual(stopsOf(run.state, porter), [{ instanceId: depot.instanceId, goods: [{ action: 'pickup', goodId: 'scrap', qty: 5 }] }]);
  route(run, porter, [{ instanceId: depot.instanceId, goods: [] }]);
  assert.equal(stopsOf(run.state, porter)[0].goods[0].qty, 5, 'refused: a stop needs a good');
});
