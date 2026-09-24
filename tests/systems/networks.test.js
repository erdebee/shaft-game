/**
 * The networks the player lays by hand (systems/infrastructure/networkGraph.js):
 * a junction lights what it reaches once it is cabled to a generator, and
 * the grid serves junctions in priority order with batteries backing only
 * their own; cisterns water what they reach once piped to a source, and what
 * is used drains downhill to reclamation or is dumped; duct fans carry the
 * scrubbers' and the gardens' work to the levels they serve.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, instanceOf, link, setStock } from '../helpers/sim.js';
import { dispatch } from '../../src/core/commands.js';
import { createRun, placeOpening } from '../../src/core/run.js';
import { stepOnce } from '../../src/core/engine.js';
import { readJson } from '../helpers/sim.js';

const FUEL = { fuel: 100 };
const GRID = ['power-grid'];
const at = (run, id, level) => run.state.buildings.find((b) => b.buildingId === id && b.level === level);

/** Run `fn` with the generator making `qty` kW. The catalogue is shared, so it is put back. */
async function generating(run, qty, fn) {
  const def = run.ctx.catalog.buildings.byId['main-generator'];
  const was = def.produces;
  def.produces = [{ id: 'power', qty }];
  try { await fn(); } finally { def.produces = was; }
}

// --- power ------------------------------------------------------------------

test('a junction lights only what it reaches, and only once cabled to a generator', async () => {
  const run = await runWith([['main-generator', 38], ['junction', 30], ['clinic', 32], ['clinic', 20]], { keep: FUEL, networks: GRID });
  ticks(run, 1);
  assert.equal(at(run, 'clinic', 32).powered, false, 'a junction on no cable lights nothing');

  link(run, 'power-grid', 'main-generator', 'junction');
  ticks(run, 1);
  assert.equal(at(run, 'clinic', 32).powered, true);
  assert.equal(at(run, 'clinic', 20).powered, false, 'level 20 is out of the junction\'s reach');
  assert.deepEqual(run.state.resources.flows.power.offGrid, [at(run, 'clinic', 20).instanceId]);
});

test('in a shortfall, junctions are served in priority order', async () => {
  const layout = [['main-generator', 38], ['junction', 30], ['junction', 22], ['clinic', 30], ['clinic', 22]];
  const run = await runWith(layout, { keep: FUEL, networks: GRID });
  link(run, 'power-grid', 'main-generator', ['junction', 30]);
  link(run, 'power-grid', ['junction', 30], ['junction', 22]);
  // A generator good for about one clinic.
  const clinic = run.ctx.catalog.buildings.byId.clinic.powerDraw;
  await generating(run, clinic * 1.2, () => {
    dispatch(run.state, run.ctx, { type: 'player:setPriority', instanceId: at(run, 'junction', 22).instanceId, priority: 1 });
    dispatch(run.state, run.ctx, { type: 'player:setPriority', instanceId: at(run, 'junction', 30).instanceId, priority: 5 });
    ticks(run, 1);
    assert.equal(at(run, 'clinic', 22).powered, true, 'the priority-1 junction is served first');
    assert.equal(at(run, 'clinic', 30).powered, false);

    dispatch(run.state, run.ctx, { type: 'player:setPriority', instanceId: at(run, 'junction', 30).instanceId, priority: 1 });
    dispatch(run.state, run.ctx, { type: 'player:setPriority', instanceId: at(run, 'junction', 22).instanceId, priority: 2 });
    ticks(run, 1);
    assert.equal(at(run, 'clinic', 30).powered, true);
    assert.equal(at(run, 'clinic', 22).powered, false);
  });
});

test('a battery backs up only the junctions it is cabled to, until it is flat', async () => {
  const layout = [['main-generator', 38], ['junction', 30], ['junction', 22], ['battery-bank', 23], ['clinic', 30], ['clinic', 22]];
  const run = await runWith(layout, { keep: FUEL, networks: GRID });
  link(run, 'power-grid', 'main-generator', ['junction', 30]);
  link(run, 'power-grid', ['junction', 30], ['junction', 22]);
  link(run, 'power-grid', 'battery-bank', ['junction', 22]);
  ticks(run, 1);

  await generating(run, 0, () => {
    ticks(run, 1);
    assert.equal(at(run, 'clinic', 22).powered, true, 'the battery keeps its junction lit');
    assert.equal(at(run, 'clinic', 30).powered, false, 'and no other');

    const battery = instanceOf(run, 'battery-bank').instanceId;
    run.state.resources.flows.power.batteries[battery] = 1;
    ticks(run, 1);
    assert.equal(at(run, 'clinic', 22).powered, false, 'a flat battery lights nothing');
  });
});

test('a surplus charges a battery', async () => {
  const run = await runWith([['main-generator', 38], ['junction', 30], ['battery-bank', 31]], { keep: FUEL, networks: GRID });
  link(run, 'power-grid', 'main-generator', 'junction');
  link(run, 'power-grid', 'battery-bank', 'junction');
  const id = instanceOf(run, 'battery-bank').instanceId;
  ticks(run, 1);
  run.state.resources.flows.power.batteries[id] = 0;
  ticks(run, 2);
  assert.equal(run.state.resources.flows.power.batteries[id], 2 * run.ctx.config.power.batteryChargeRatePerTick);
});

test('a junction carries no more than its capacity', async () => {
  const layout = [['main-generator', 38], ['junction', 30], ['clinic', 29], ['clinic', 30], ['clinic', 31]];
  const run = await runWith(layout, { keep: FUEL, networks: GRID });
  link(run, 'power-grid', 'main-generator', 'junction');
  const junction = run.ctx.catalog.buildings.byId.junction;
  junction.effects = [{ op: 'network.capacity', target: 'power-grid', value: 130 }];
  try {
    ticks(run, 1);
    const lit = run.state.buildings.filter((b) => b.buildingId === 'clinic' && b.powered).length;
    assert.equal(lit, 2);
  } finally {
    junction.effects = [{ op: 'network.capacity', target: 'power-grid', value: 800 }];
  }
});

// --- links --------------------------------------------------------------------

test('links join only what the network allows, within its span, and cost materials', async () => {
  const run = await runWith([['main-generator', 38], ['junction', 30], ['junction', 12], ['clinic', 30], ['storehouse', 30]], { networks: GRID });
  const refused = [];
  const { on } = await import('../../src/core/eventBus.js');
  const off = on('link:refused', (p) => refused.push(p.reason));
  const id = (b, l) => at(run, b, l).instanceId;
  try {
    dispatch(run.state, run.ctx, { type: 'player:link', network: 'power-grid', from: id('main-generator', 38), to: id('clinic', 30) });
    dispatch(run.state, run.ctx, { type: 'player:link', network: 'power-grid', from: id('junction', 30), to: id('junction', 12) });
    setStock(run, 'copper-wire', 0);
    dispatch(run.state, run.ctx, { type: 'player:link', network: 'power-grid', from: id('main-generator', 38), to: id('junction', 30) });
    setStock(run, 'copper-wire', 50);
    dispatch(run.state, run.ctx, { type: 'player:link', network: 'power-grid', from: id('main-generator', 38), to: id('junction', 30) });
    dispatch(run.state, run.ctx, { type: 'player:link', network: 'power-grid', from: id('junction', 30), to: id('main-generator', 38) });
  } finally {
    off();
  }
  assert.deepEqual(refused, ['cannot-join', 'too-long', 'cost', 'linked']);
  assert.equal(run.state.infrastructure.links.length, 1);
  // 8 levels at half a wire a level.
  assert.equal(at(run, 'storehouse', 30).stock['copper-wire'], 50 - 4);
});

test('demolishing a building takes its links with it; a link can be taken out', async () => {
  const run = await runWith([['main-generator', 38], ['junction', 30], ['junction', 22]], { networks: GRID });
  link(run, 'power-grid', 'main-generator', ['junction', 30]);
  link(run, 'power-grid', ['junction', 30], ['junction', 22]);
  dispatch(run.state, run.ctx, { type: 'player:demolish', instanceId: at(run, 'junction', 22).instanceId });
  assert.equal(run.state.infrastructure.links.length, 1);
  dispatch(run.state, run.ctx, { type: 'player:unlink', linkId: run.state.infrastructure.links[0].id });
  assert.equal(run.state.infrastructure.links.length, 0);
});

// --- water and sewage -----------------------------------------------------------

const WATERWORKS = ['water-mains', 'sewer'];

test('a cistern waters what it reaches only once piped to a source', async () => {
  const layout = [['main-generator', 38], ['deep-pump', 40], ['cistern', 30], ['hydroponics-bay', 29], ['hydroponics-bay', 20]];
  const run = await runWith(layout, { keep: FUEL, networks: ['water-mains'], tunables: { 'water.potablePerCapitaPerTick': 0 } });
  const water = run.state.resources.flows.water;
  ticks(run, 5);
  assert.equal(at(run, 'hydroponics-bay', 29).waterShare, 1, 'the cistern opens full');
  assert.equal(at(run, 'hydroponics-bay', 20).waterShare, 0, 'level 20 is out of its reach');
  assert.ok(water.unserved.includes(at(run, 'hydroponics-bay', 20).instanceId));
  ticks(run, 60);
  assert.equal(at(run, 'hydroponics-bay', 29).waterShare, 0, 'unpiped, it runs dry');

  link(run, 'water-mains', 'deep-pump', 'cistern');
  ticks(run, 2);
  assert.equal(at(run, 'hydroponics-bay', 29).waterShare, 1);
});

test('sewage drains downhill to reclamation, and is dumped where no drain goes', async () => {
  const layout = [['main-generator', 38], ['deep-pump', 40], ['reclamation-plant', 42], ['cistern', 30], ['hydroponics-bay', 30]];
  const run = await runWith(layout, { keep: FUEL, networks: WATERWORKS, tunables: { 'water.potablePerCapitaPerTick': 0 } });
  link(run, 'water-mains', 'deep-pump', 'cistern');
  link(run, 'water-mains', 'reclamation-plant', 'cistern');
  ticks(run, 2);
  const water = run.state.resources.flows.water;
  assert.ok(water.spilled[30] > 0, 'no drain: the sewage is dumped on its level');
  assert.equal(water.greywater, 0);

  link(run, 'sewer', 'cistern', 'reclamation-plant');
  ticks(run, 2);
  assert.equal(water.spilled[30], 0);
  assert.ok(water.greywater > 0);
  assert.ok(water.reclaimed > 0, 'and the plant recovers it');
});

test('a drain never carries sewage uphill', async () => {
  const layout = [['main-generator', 38], ['deep-pump', 40], ['reclamation-plant', 29], ['cistern', 30], ['hydroponics-bay', 30]];
  const run = await runWith(layout, { keep: FUEL, networks: WATERWORKS, tunables: { 'water.potablePerCapitaPerTick': 0 } });
  link(run, 'water-mains', 'deep-pump', 'cistern');
  link(run, 'sewer', 'cistern', 'reclamation-plant');
  ticks(run, 2);
  assert.ok(run.state.resources.flows.water.spilled[30] > 0);
});

test('dumped sewage fouls the air of its level', async () => {
  const layout = [['main-generator', 38], ['deep-pump', 40], ['cistern', 30], ['hydroponics-bay', 30]];
  const tunables = { 'water.potablePerCapitaPerTick': 0, 'air.migrationRateBetweenLevels': 0, 'air.contaminantPerCapitaPerTick': 0 };
  const run = await runWith(layout, { keep: FUEL, networks: WATERWORKS, tunables });
  link(run, 'water-mains', 'deep-pump', 'cistern');
  ticks(run, 20);
  assert.ok(run.state.levels[29].airQuality < 100);
  assert.equal(run.state.levels[28].airQuality, 100);
});

// --- air ------------------------------------------------------------------------

const AIR = ['duct-network', 'oxygen-ducts'];
const SCRUBBING = { ...FUEL, 'activated-carbon': 100, 'scrubber-catalyst': 1 };

test('a duct fan carries a scrubber\'s work to the levels it serves', async () => {
  const layout = [['main-generator', 38], ['scrubber-bank', 20], ['duct-fan', 26], ['simple-suite', 25]];
  const tunables = { 'air.migrationRateBetweenLevels': 0, 'air.oxygenPerCapitaPerTick': 0 };
  const unducted = await runWith(layout, { keep: SCRUBBING, networks: AIR, tunables });
  const ducted = await runWith(layout, { keep: SCRUBBING, networks: AIR, tunables });
  link(ducted, 'duct-network', 'duct-fan', 'scrubber-bank');
  for (const run of [unducted, ducted]) { run.state.population.headcount = 80; ticks(run, 60); }
  assert.ok(unducted.state.levels[24].airQuality < 90, `got ${unducted.state.levels[24].airQuality}`);
  assert.ok(ducted.state.levels[24].airQuality > 99, `got ${ducted.state.levels[24].airQuality}`);
});

test('an oxygen garden\'s oxygen reaches only where it is ducted', async () => {
  const layout = [['main-generator', 38], ['oxygen-garden', 6], ['duct-fan', 12], ['simple-suite', 13]];
  const tunables = { 'air.migrationRateBetweenLevels': 0, 'water.potablePerCapitaPerTick': 0 };
  const alone = await runWith(layout, { keep: { ...FUEL }, networks: AIR, tunables });
  const ducted = await runWith(layout, { keep: { ...FUEL }, networks: AIR, tunables });
  link(ducted, 'oxygen-ducts', 'oxygen-garden', 'duct-fan');
  for (const run of [alone, ducted]) {
    run.engine.systems.water = { tick() {} }; // the garden's water is not the question
    run.state.population.headcount = 200;
    ticks(run, 60);
  }
  assert.ok(alone.state.levels[12].oxygen < 90, `got ${alone.state.levels[12].oxygen}`);
  assert.ok(ducted.state.levels[12].oxygen > alone.state.levels[12].oxygen + 10);
});

test('plants grow slower in foul air', async () => {
  const run = await runWith([['main-generator', 38], ['hydroponics-bay', 20]], {
    keep: FUEL, networks: AIR, tunables: { 'air.migrationRateBetweenLevels': 0 },
  });
  const need = run.ctx.catalog.buildings.byId['hydroponics-bay'].airNeed;
  run.state.levels[19].airQuality = need / 2;
  run.state.population.headcount = 0;
  ticks(run, 1);
  const bay = instanceOf(run, 'hydroponics-bay');
  assert.ok(bay.airShare > 0.4 && bay.airShare < 0.6, `got ${bay.airShare}`);
});

// --- the opening ------------------------------------------------------------------

test('the Shaft opens wired: every room lit, every home watered, no sewage dumped', async () => {
  const run = await createRun({ readJson, seed: 7 });
  placeOpening(run.state, run.ctx, dispatch);
  for (let i = 0; i < 30; i++) stepOnce(run.engine);
  const power = run.state.resources.flows.power;
  const water = run.state.resources.flows.water;
  assert.deepEqual(power.offGrid, []);
  assert.deepEqual(power.brownedOut, []);
  assert.deepEqual(water.dryLevels, []);
  assert.deepEqual(water.unserved, []);
  assert.equal(water.spilled.reduce((a, b) => a + b, 0), 0);
  assert.ok(run.state.infrastructure.links.length > 20);
});
