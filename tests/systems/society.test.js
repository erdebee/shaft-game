/**
 * Meters drift toward where conditions put them; discontent becomes
 * warnings, strikes, demands, riots and departures.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, instanceOf } from '../helpers/sim.js';
import { on } from '../../src/core/eventBus.js';
import { dispatch } from '../../src/core/commands.js';
import { meterTarget, workRate } from '../../src/systems/society/meters.js';
import { outputScale } from '../../src/systems/buildings/buildingRegistry.js';
import { collectModifiers } from '../../src/core/effects.js';

const CALM = { 'water.potablePerCapitaPerTick': 0, 'air.contaminantPerCapitaPerTick': 0 };
const FED = { food: 1e6 };

/** Collect one event's payloads while `fn` runs. */
function capture(event, fn) {
  const seen = [];
  const off = on(event, (p) => seen.push(p));
  fn();
  off?.();
  return seen;
}

test('a meter drifts toward its target, and a one-shot bump fades', async () => {
  const run = await runWith([], { stocks: FED, tunables: CALM });
  const def = run.ctx.catalog.meters.byId.morale;
  run.state.meters.morale = 100;
  ticks(run, 2000);
  const target = meterTarget(run.state, def, 0);
  assert.ok(Math.abs(run.state.meters.morale - Math.min(100, Math.max(0, target))) < 1,
    `morale ${run.state.meters.morale} should have settled near ${target}`);
});

test('hunger drags morale down', async () => {
  const fed = await runWith([], { stocks: FED, tunables: CALM });
  const hungry = await runWith([], { stocks: { food: 0 }, tunables: CALM });
  // Long enough for both to settle, not just to drift at full rate.
  ticks(fed, 1000);
  ticks(hungry, 1000);
  assert.ok(hungry.state.meters.morale < fed.state.meters.morale - 5,
    `hungry ${hungry.state.meters.morale} vs fed ${fed.state.meters.morale}`);
});

test('structural integrity accumulates: a working dig face wears the rock', async () => {
  const run = await runWith([['main-generator', 38], ['dig-face', 40]], { stocks: { ...FED, fuel: 500 }, tunables: CALM });
  const start = run.state.meters['structural-integrity'];
  ticks(run, 100);
  assert.ok(run.state.meters['structural-integrity'] < start - 1);
});

test('low productivity slows every building', async () => {
  // A salvage post needs no water, so nothing but the work rate varies.
  const run = await runWith([['main-generator', 38], ['salvage-post', 13]], { stocks: { ...FED, fuel: 500 }, tunables: CALM });
  ticks(run, 1);
  const bay = instanceOf(run, 'salvage-post');
  const def = run.ctx.catalog.buildings.byId['salvage-post'];
  const pivot = run.ctx.catalog.meters.byId.productivity.workRate.pivot;

  run.state.meters.productivity = pivot;
  const normal = outputScale(bay, def, { ...run.ctx, modifiers: collectModifiers(run.state, run.ctx) });
  run.state.meters.productivity = 10;
  const slow = outputScale(bay, def, { ...run.ctx, modifiers: collectModifiers(run.state, run.ctx) });
  assert.equal(workRate({ meters: { productivity: pivot } }, run.ctx), 1);
  assert.ok(normal > 0);
  assert.ok(slow < normal);
});

/**
 * Warnings and demands fire when discontent CROSSES a line during a tick, so
 * tests start it just below and sink morale and trust, which drives it up.
 */
function sour(run) {
  run.state.meters.morale = 0;
  run.state.meters.trust = 0;
}

test('a satisfied faction warns as discontent rises; strikes come from the least satisfied', async () => {
  const run = await runWith([['main-generator', 38], ['hydroponics-bay', 13]], { stocks: { ...FED, fuel: 500 }, tunables: CALM });
  const { unrest } = run.ctx.config;
  const sat = run.state.population.factionSatisfaction;
  // Freeze the factions where the test wants them by making them the only
  // thing that moves slowly: set them, and push discontent past each line.
  Object.assign(sat, { cultivation: 5, engineering: 90, order: 50, archive: 50 });
  run.state.meters.discontent = unrest.warnThreshold - 0.01;
  const warnings = capture('unrest:warning', () => { sour(run); ticks(run, 1); });
  assert.equal(warnings[0]?.faction, 'engineering');

  // Strikes need discontent to be high at a shift change, not to cross.
  const hold = () => { run.state.meters.discontent = Math.max(run.state.meters.discontent, unrest.strikeThreshold + 1); };

  const toShift = run.ctx.config.clock.ticksPerShift - (run.state.clock.tick % run.ctx.config.clock.ticksPerShift);
  const strikes = capture('unrest:strike', () => {
    for (let i = 0; i < toShift; i++) { hold(); Object.assign(sat, { cultivation: 5 }); ticks(run, 1); }
  });
  assert.equal(strikes[0]?.faction, 'cultivation');
  ticks(run, 1);
  assert.equal(instanceOf(run, 'hydroponics-bay').staffing, 0, 'strikers leave their posts');

  const ended = capture('unrest:strikeEnded', () => ticks(run, unrest.strikeDurationTicks));
  assert.equal(ended[0]?.faction, 'cultivation');
});

test('crossing the demands line raises the demand once', async () => {
  const run = await runWith([], { stocks: FED, tunables: CALM });
  const { demandsThreshold } = run.ctx.config.unrest;
  run.state.meters.discontent = demandsThreshold - 0.01;
  const demands = capture('unrest:demands', () => {
    for (let i = 0; i < 20; i++) { sour(run); ticks(run, 1); }
  });
  assert.equal(demands.length, 1);
});

test('riots wreck buildings and tear down what they wreck, never the fixed structure', async () => {
  const run = await runWith([['shaft-exit', 1], ['school', 10], ['canteen', 26]], { stocks: FED, tunables: CALM });
  const { riotThreshold } = run.ctx.config.unrest;
  run.state.maintenance.crewTarget = 0; // nobody patching up behind the rioters
  const demolished = capture('unrest:demolished', () => {
    for (let i = 0; i < 400; i++) { run.state.meters.discontent = riotThreshold + 10; ticks(run, 1); }
  });
  assert.ok(demolished.length >= 1);
  assert.ok(instanceOf(run, 'shaft-exit'), 'the Exit is part of the Shaft, not a target');

  // A building placed after a demolition gets an id nobody has used.
  const used = new Set(run.state.buildings.map((b) => b.instanceId).concat(demolished.map((d) => d.instanceId)));
  dispatch(run.state, run.ctx, { type: 'player:placeBuilding', buildingId: 'school', level: 11 });
  assert.ok(!used.has(run.state.buildings.at(-1).instanceId));
});

test('the deeply discontent leave through the Exit — if there is one', async () => {
  const withExit = await runWith([['shaft-exit', 1]], { stocks: FED, tunables: CALM });
  const without = await runWith([], { stocks: FED, tunables: CALM });
  for (const run of [withExit, without]) {
    for (let i = 0; i < 30; i++) { run.state.meters.discontent = 95; ticks(run, 1); }
  }
  assert.ok(withExit.state.population.vitalStats.departures > 0);
  assert.equal(without.state.population.vitalStats.departures, 0);
});
