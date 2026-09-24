/**
 * The default Shaft as the player inherits it. A regression guard on balance:
 * the opening must hold for its first week untouched — nobody dies, nothing
 * goes dark, people have water — while the pressures it is built around
 * (the food running down, the homeless) are already visible.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRun, placeOpening } from '../../src/core/run.js';
import { stepOnce } from '../../src/core/engine.js';
import { dispatch } from '../../src/core/commands.js';
import { dataset, readJson } from '../helpers/sim.js';
import { total } from '../../src/systems/resources/stores.js';

test('the opening holds for a week untouched, with its pressures already showing', async () => {
  const { engine, state, ctx } = await createRun({ dataset, seed: 1234, readJson });
  placeOpening(state, ctx, dispatch);
  const start = state.population.headcount;
  const scrap = total(state, 'scrap');

  for (let i = 0; i < 7 * 60; i++) stepOnce(engine);

  assert.ok(state.population.headcount >= start * 0.995, `almost nobody should die in the first week (${start - state.population.headcount})`);
  assert.equal(state.resources.flows.power.brownedOut.length, 0, 'nothing should be dark');
  assert.equal(state.population.needs.water, 1, 'everyone should have water');
  assert.ok(state.population.needs.housing < 1, 'the opening is short of homes on purpose');
  assert.ok(total(state, 'scrap') < scrap, 'the vats are eating through the scrap nobody makes');
  assert.equal(state.population.strikes.length, 0);
});

test('every opening porter is hired at a station and walking a route', async () => {
  const { state, ctx } = await createRun({ dataset, seed: 1234, readJson });
  placeOpening(state, ctx, dispatch);
  const porters = state.population.workers.filter((w) => w.job === 'porter');
  assert.equal(porters.length, ctx.shaft.openingPorters.length);
  for (const p of porters) {
    assert.ok(state.buildings.some((b) => b.instanceId === p.stationId), `${p.name} has a station`);
    const route = state.haulage.routes.find((r) => r.id === p.routeId);
    assert.ok(route?.stops.length > 0, `${p.name} has a route`);
    assert.ok(!/^Route \d+$/.test(route.name), `${p.name}'s route is named in the data`);
  }
});
