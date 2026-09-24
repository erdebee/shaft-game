/**
 * The networks the player lays by hand, socket by socket
 * (systems/infrastructure/networkGraph.js): a junction lights the rooms
 * wired into it once a generator feeds it, and the grid serves junctions in
 * priority order with batteries backing only their own; cisterns water the
 * rooms fed from them once piped to a source, and what is used drains
 * downhill to reclamation or is dumped; duct fans carry the scrubbers' and
 * the gardens' work to the levels they serve.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, instanceOf, link, tap, setStock } from '../helpers/sim.js';
import { dispatch } from '../../src/core/commands.js';
import { createRun, placeOpening } from '../../src/core/run.js';
import { stepOnce } from '../../src/core/engine.js';
import { readJson } from '../helpers/sim.js';
import { canLink, canTap, socketsOf } from '../../src/systems/infrastructure/networkGraph.js';
import { batteryCapacity } from '../../src/systems/power/priorityLadder.js';

const FUEL = { fuel: 100 };
const GRID = ['power-grid', 'power-lines'];
const at = (run, id, level) => run.state.buildings.find((b) => b.buildingId === id && b.level === level);

/** Run `fn` with the generator making `qty` kW. The catalogue is shared, so it is put back. */
async function generating(run, qty, fn) {
  const def = run.ctx.catalog.buildings.byId['main-generator'];
  const was = def.produces;
  def.produces = [{ id: 'power', qty }];
  try { await fn(); } finally { def.produces = was; }
}

// --- power ------------------------------------------------------------------

test('a room is lit only when wired to a junction that a generator feeds', async () => {
  const run = await runWith([['main-generator', 38], ['junction', 30], ['clinic', 32], ['clinic', 29]], { keep: FUEL, networks: GRID });
  link(run, 'power-lines', 'junction', ['clinic', 32]);
  ticks(run, 1);
  assert.equal(at(run, 'clinic', 32).powered, false, 'a junction with no high-voltage feed lights nothing');

  link(run, 'power-grid', 'main-generator', 'junction');
  ticks(run, 1);
  assert.equal(at(run, 'clinic', 32).powered, true);
  assert.equal(at(run, 'clinic', 29).powered, false, 'a level away, but on no wire');
  assert.deepEqual(run.state.resources.flows.power.offGrid, [at(run, 'clinic', 29).instanceId]);
});

test('in a shortfall, junctions are served in priority order', async () => {
  const layout = [['main-generator', 38], ['junction', 30], ['junction', 22], ['clinic', 30], ['clinic', 22]];
  const run = await runWith(layout, { keep: FUEL, networks: GRID });
  link(run, 'power-grid', 'main-generator', ['junction', 30]);
  link(run, 'power-grid', 'main-generator', ['junction', 22]);
  link(run, 'power-lines', ['junction', 30], ['clinic', 30]);
  link(run, 'power-lines', ['junction', 22], ['clinic', 22]);
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

test('a battery backs up only the junction it feeds, until it is flat', async () => {
  const layout = [['main-generator', 38], ['junction', 30], ['junction', 22], ['battery-bank', 23], ['clinic', 30], ['clinic', 22]];
  const run = await runWith(layout, { keep: FUEL, networks: GRID });
  link(run, 'power-grid', 'main-generator', ['junction', 30]);
  link(run, 'power-grid', 'main-generator', 'battery-bank');
  link(run, 'power-grid', 'battery-bank', ['junction', 22]);
  link(run, 'power-lines', ['junction', 30], ['clinic', 30]);
  link(run, 'power-lines', ['junction', 22], ['clinic', 22]);
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

test('batteries chain in series, and every battery in the chain backs the junction at its end', async () => {
  const layout = [['main-generator', 38], ['junction', 22], ['battery-bank', 23], ['battery-bank', 24], ['clinic', 22]];
  const run = await runWith(layout, { keep: FUEL, networks: GRID });
  const [first, second] = run.state.buildings.filter((b) => b.buildingId === 'battery-bank');
  const lay = (from, to) => dispatch(run.state, run.ctx, { type: 'player:link', network: 'power-grid', from, to, inherited: true });
  lay(at(run, 'main-generator', 38).instanceId, first.instanceId);
  lay(first.instanceId, second.instanceId);
  lay(second.instanceId, at(run, 'junction', 22).instanceId);
  assert.equal(run.state.infrastructure.links.length, 3);
  assert.deepEqual(run.state.infrastructure.links.map((l) => [l.fromSocket, l.toSocket]), [['out', 'in'], ['out', 'in'], ['out', 'in']]);
  link(run, 'power-lines', 'junction', 'clinic');
  ticks(run, 1);

  await generating(run, 0, () => {
    const charge = run.state.resources.flows.power.batteries;
    charge[second.instanceId] = 1; // the one next to the junction is flat
    ticks(run, 1);
    assert.equal(at(run, 'clinic', 22).powered, true, 'the battery further up the chain still carries it');
    assert.ok(charge[first.instanceId] < batteryCapacity(run.ctx.catalog.buildings.byId['battery-bank']));
  });
});

test('a pump sits in line: one pipe in from the plant, one out to the cisterns', async () => {
  const layout = [['main-generator', 38], ['deep-pump', 40], ['reclamation-plant', 42], ['cistern', 30], ['cistern', 31]];
  const run = await runWith(layout, { keep: FUEL, networks: WATERWORKS });
  const id = (b, l) => at(run, b, l).instanceId;
  // Laid pump-first, it still takes the pump's out: water runs pump to cistern.
  link(run, 'water-mains', 'deep-pump', ['cistern', 30]);
  link(run, 'water-mains', 'reclamation-plant', 'deep-pump');
  const [out, into] = run.state.infrastructure.links;
  assert.equal(out.fromSocket, 'out');
  assert.equal(into.toSocket, 'in');
  assert.equal(canLink(run.state, run.ctx, 'water-mains', id('deep-pump', 40), id('cistern', 31)).reason, 'full', 'one out: the next cistern tees in');
  tap(run, 'water-mains', ['cistern', 31], out.id);
});

test('a tee branches a pipe: several cisterns off one pump, and their drains into one plant', async () => {
  const layout = [['main-generator', 38], ['deep-pump', 40], ['reclamation-plant', 42], ['cistern', 30], ['cistern', 22], ['clinic', 22]];
  const run = await runWith(layout, { keep: FUEL, networks: [...WATERWORKS, 'water-feeds'], tunables: { 'water.potablePerCapitaPerTick': 0 } });
  const id = (b, l) => at(run, b, l).instanceId;
  link(run, 'water-mains', 'reclamation-plant', 'deep-pump');
  const main = run.state.infrastructure.links.at(-1);
  link(run, 'water-mains', 'deep-pump', ['cistern', 30]);
  const up = run.state.infrastructure.links.at(-1);
  link(run, 'sewer', ['cistern', 30], 'reclamation-plant');
  const drain = run.state.infrastructure.links.at(-1);
  link(run, 'water-feeds', ['cistern', 22], 'clinic');

  // One sleeve each: the cistern on 22 cannot take its own pipe from the pump.
  assert.equal(canLink(run.state, run.ctx, 'water-mains', id('deep-pump', 40), id('cistern', 22)).reason, 'full');
  const check = canTap(run.state, run.ctx, 'water-mains', id('cistern', 22), up.id);
  assert.deepEqual([check.ok, check.level, check.span], [true, 30, 8], 'the tee sits where the run meets level 30');
  assert.equal(canTap(run.state, run.ctx, 'power-grid', id('cistern', 22), main.id).reason, 'no-taps', 'a cable is not branched');
  tap(run, 'water-mains', ['cistern', 22], up.id);
  tap(run, 'sewer', ['cistern', 22], drain.id);
  ticks(run, 60);
  assert.equal(at(run, 'clinic', 22).waterShare, 1, 'watered through the tee');
  const water = run.state.resources.flows.water;
  assert.equal(water.spilled[22], 0, 'and drained through the other');
  assert.equal(water.pipes[up.id].to, id('cistern', 30), 'the flow still runs up the tapped pipe');

  // Take the tapped pipe out, and the line teed into it goes with it.
  dispatch(run.state, run.ctx, { type: 'player:unlink', linkId: up.id });
  assert.equal(run.state.infrastructure.links.filter((l) => l.network === 'water-mains').length, 1);
});

test('a surplus charges a battery', async () => {
  const run = await runWith([['main-generator', 38], ['junction', 30], ['battery-bank', 31]], { keep: FUEL, networks: GRID });
  link(run, 'power-grid', 'main-generator', 'battery-bank');
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
  for (const level of [29, 30, 31]) link(run, 'power-lines', 'junction', ['clinic', level]);
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
  const run = await runWith([['main-generator', 38], ['junction', 30], ['junction', 12], ['clinic', 30], ['clinic', 20], ['storehouse', 30]], { networks: GRID });
  const refused = [];
  const { on } = await import('../../src/core/eventBus.js');
  const off = on('link:refused', (p) => refused.push(p.reason));
  const id = (b, l) => at(run, b, l).instanceId;
  const lay = (network, from, to) => dispatch(run.state, run.ctx, { type: 'player:link', network, from, to });
  try {
    lay('power-grid', id('main-generator', 38), id('clinic', 30));
    lay('power-grid', id('junction', 30), id('junction', 12));
    lay('power-lines', id('junction', 30), id('clinic', 20));
    setStock(run, 'copper-wire', 0);
    lay('power-grid', id('main-generator', 38), id('junction', 30));
    setStock(run, 'copper-wire', 50);
    lay('power-grid', id('main-generator', 38), id('junction', 30));
    lay('power-grid', id('junction', 30), id('main-generator', 38));
  } finally {
    off();
  }
  assert.deepEqual(refused, ['cannot-join', 'cannot-join', 'too-long', 'cost', 'linked']);
  assert.equal(run.state.infrastructure.links.length, 1);
  // 8 levels at half a wire a level.
  assert.equal(at(run, 'storehouse', 30).stock['copper-wire'], 50 - 4);
});

test('every link plugs a free socket into one that fits', async () => {
  const layout = [['main-generator', 38], ['main-generator', 36], ['junction', 30], ['battery-bank', 31], ['clinic', 30]];
  const run = await runWith(layout, { networks: GRID });
  const [genA, genB] = run.state.buildings.filter((b) => b.buildingId === 'main-generator');
  const id = (b, l) => at(run, b, l).instanceId;
  const check = (network, from, to, sockets) => canLink(run.state, run.ctx, network, from, to, sockets);

  // Out into in: the generator's output finds the junction's input, whichever end is named first.
  const laid = check('power-grid', id('junction', 30), genA.instanceId);
  assert.deepEqual([laid.ok, laid.fromSocket, laid.toSocket], [true, 'in', 'out']);
  link(run, 'power-grid', ['junction', 30], ['main-generator', 38]);
  assert.equal(run.state.infrastructure.links[0].fromSocket, 'in');
  // A junction takes one feed in: the second generator finds it full.
  assert.equal(check('power-grid', genB.instanceId, id('junction', 30)).reason, 'full');
  // A battery's input does not fit a junction's input.
  assert.equal(check('power-grid', id('battery-bank', 31), id('junction', 30), { fromSocket: 'in' }).reason, 'no-socket');
  // A room has one wire: a second junction would find it taken.
  link(run, 'power-lines', 'junction', 'clinic');
  assert.equal(check('power-lines', id('junction', 30), id('clinic', 30)).reason, 'linked');

  // A junction has only so many low-voltage sockets: fill the rest, and the clinic finds it full.
  const junction = at(run, 'junction', 30);
  const clinic = at(run, 'clinic', 30);
  run.state.infrastructure.links = run.state.infrastructure.links.filter((l) => l.network !== 'power-lines');
  const sockets = socketsOf(run.ctx, 'power-lines', 'junction')[0].count;
  for (let i = 0; i < sockets; i++) {
    run.state.infrastructure.links.push({ id: `x${i}`, network: 'power-lines', from: junction.instanceId, to: genB.instanceId, fromSocket: 'out', toSocket: 'in' });
  }
  assert.equal(check('power-lines', junction.instanceId, clinic.instanceId).reason, 'full');
});

test('demolishing a building takes its links with it; a link can be taken out', async () => {
  const run = await runWith([['main-generator', 38], ['junction', 30], ['junction', 22]], { networks: GRID });
  link(run, 'power-grid', 'main-generator', ['junction', 30]);
  link(run, 'power-grid', 'main-generator', ['junction', 22]);
  dispatch(run.state, run.ctx, { type: 'player:demolish', instanceId: at(run, 'junction', 22).instanceId });
  assert.equal(run.state.infrastructure.links.length, 1);
  dispatch(run.state, run.ctx, { type: 'player:unlink', linkId: run.state.infrastructure.links[0].id });
  assert.equal(run.state.infrastructure.links.length, 0);
});

// --- water and sewage -----------------------------------------------------------

const WATERWORKS = ['water-mains', 'sewer'];

test('a cistern waters only what is fed from it, and only once piped to a source', async () => {
  const layout = [['main-generator', 38], ['deep-pump', 40], ['cistern', 30], ['clinic', 29], ['clinic', 31]];
  const run = await runWith(layout, { keep: FUEL, networks: ['water-mains', 'water-feeds'], tunables: { 'water.potablePerCapitaPerTick': 0 } });
  link(run, 'water-feeds', 'cistern', ['clinic', 29]);
  const water = run.state.resources.flows.water;
  ticks(run, 5);
  assert.equal(at(run, 'clinic', 29).waterShare, 1, 'the cistern opens full');
  assert.equal(at(run, 'clinic', 31).waterShare, 0, 'a level away, but on no feed line');
  assert.ok(water.unserved.includes(at(run, 'clinic', 31).instanceId));
  ticks(run, 60);
  assert.equal(at(run, 'clinic', 29).waterShare, 0, 'unpiped, it runs dry');

  link(run, 'water-mains', 'deep-pump', 'cistern');
  ticks(run, 2);
  assert.equal(at(run, 'clinic', 29).waterShare, 1);
});

test('a home\'s residents drink through its feed line', async () => {
  const layout = [['main-generator', 38], ['deep-pump', 40], ['cistern', 30], ['simple-suite', 30]];
  const run = await runWith(layout, { keep: FUEL, networks: ['water-mains', 'water-feeds'] });
  run.state.population.headcount = run.ctx.catalog.buildings.byId['simple-suite'].housing;
  link(run, 'water-mains', 'deep-pump', 'cistern');
  ticks(run, 2);
  assert.deepEqual(run.state.resources.flows.water.dryLevels, [30], 'no feed line: nobody in it drinks');

  link(run, 'water-feeds', 'cistern', 'simple-suite');
  ticks(run, 2);
  assert.deepEqual(run.state.resources.flows.water.dryLevels, []);
  assert.equal(run.state.resources.flows.water.peopleShare, 1);
});

test('sewage drains downhill to reclamation, and is dumped where no drain goes', async () => {
  const layout = [['main-generator', 38], ['deep-pump', 40], ['reclamation-plant', 42], ['cistern', 30], ['clinic', 30]];
  const run = await runWith(layout, { keep: FUEL, networks: WATERWORKS, tunables: { 'water.potablePerCapitaPerTick': 0 } });
  link(run, 'water-mains', 'deep-pump', 'cistern');
  link(run, 'water-mains', 'reclamation-plant', 'deep-pump');
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

test('water is a loop: reclaimed water gets back to the mains only through a pump', async () => {
  const layout = [['main-generator', 38], ['deep-pump', 40], ['reclamation-plant', 42], ['cistern', 30], ['clinic', 30]];
  const run = await runWith(layout, { keep: FUEL, networks: WATERWORKS, tunables: { 'water.potablePerCapitaPerTick': 0 } });
  link(run, 'water-mains', 'deep-pump', 'cistern');
  link(run, 'sewer', 'cistern', 'reclamation-plant');
  ticks(run, 3);
  const water = run.state.resources.flows.water;
  assert.equal(water.reclaimed, 0, 'the plant is piped to no pump');
  assert.ok(water.stranded > 0, 'so what it recovers is wasted');

  link(run, 'water-mains', 'reclamation-plant', 'deep-pump');
  ticks(run, 3);
  assert.ok(water.reclaimed > 0);
  assert.equal(water.stranded, 0);
  // And the flow runs round: plant to pump, pump up to the cistern, cistern down the drain.
  const [pumpToCistern, drain, plantToPump] = run.state.infrastructure.links;
  assert.equal(water.pipes[plantToPump.id].to, at(run, 'deep-pump', 40).instanceId);
  assert.equal(water.pipes[pumpToCistern.id].to, at(run, 'cistern', 30).instanceId);
  assert.equal(water.pipes[drain.id].to, at(run, 'reclamation-plant', 42).instanceId);
});

test('a drain never carries sewage uphill', async () => {
  const layout = [['main-generator', 38], ['deep-pump', 40], ['reclamation-plant', 29], ['cistern', 30], ['clinic', 30]];
  const run = await runWith(layout, { keep: FUEL, networks: WATERWORKS, tunables: { 'water.potablePerCapitaPerTick': 0 } });
  link(run, 'water-mains', 'deep-pump', 'cistern');
  link(run, 'sewer', 'cistern', 'reclamation-plant');
  ticks(run, 2);
  assert.ok(run.state.resources.flows.water.spilled[30] > 0);
});

test('dumped sewage fouls the air of its level', async () => {
  const layout = [['main-generator', 38], ['deep-pump', 40], ['cistern', 30], ['clinic', 30]];
  const tunables = { 'water.potablePerCapitaPerTick': 0, 'air.migrationRateBetweenLevels': 0, 'air.contaminantPerCapitaPerTick': 0 };
  const run = await runWith(layout, { keep: FUEL, networks: WATERWORKS, tunables });
  link(run, 'water-mains', 'deep-pump', 'cistern');
  ticks(run, 20);
  assert.ok(run.state.levels[29].airQuality < 100);
  assert.equal(run.state.levels[28].airQuality, 100);
});

test('the big pipes join only pumps, cisterns and plants: a cultivation room is served by its cistern', async () => {
  const layout = [['main-generator', 38], ['deep-pump', 40], ['reclamation-plant', 42], ['cistern', 30], ['hydroponics-bay', 31]];
  const run = await runWith(layout, { keep: FUEL, networks: WATERWORKS, tunables: { 'water.potablePerCapitaPerTick': 0 } });
  const bay = at(run, 'hydroponics-bay', 31);
  for (const network of WATERWORKS) {
    assert.equal(canLink(run.state, run.ctx, network, at(run, 'cistern', 30).instanceId, bay.instanceId).reason, 'cannot-join');
  }
  link(run, 'water-mains', 'deep-pump', 'cistern');
  link(run, 'sewer', 'cistern', 'reclamation-plant');
  ticks(run, 2);
  const water = run.state.resources.flows.water;
  assert.equal(bay.waterShare, 1, 'watered by the cistern in reach');
  assert.equal(water.spilled[31], 0, 'and drained by it');
});

// --- air ------------------------------------------------------------------------

const AIR = ['foul-ducts', 'fresh-ducts'];
const SCRUBBING = { ...FUEL, 'activated-carbon': 100, 'scrubber-catalyst': 1 };
const STILL = { 'air.migrationRateBetweenLevels': 0, 'air.oxygenPerCapitaPerTick': 0 };
const fan = (run, level) => at(run, 'duct-fan', level).instanceId;
const setFan = (run, level, mode) => dispatch(run.state, run.ctx, { type: 'player:setFanMode', instanceId: fan(run, level), mode });

/** A fan sucking the deep levels through a scrubber, and one blowing onto the suites. */
async function ventilated(modes) {
  const layout = [['main-generator', 38], ['duct-fan', 36], ['scrubber-bank', 30], ['duct-fan', 25], ['simple-suite', 25]];
  const run = await runWith(layout, { keep: SCRUBBING, networks: AIR, tunables: STILL });
  link(run, 'foul-ducts', ['duct-fan', 36], 'scrubber-bank');
  link(run, 'fresh-ducts', 'scrubber-bank', ['duct-fan', 25]);
  setFan(run, 36, modes[0]);
  setFan(run, 25, modes[1]);
  run.state.population.headcount = 80;
  return run;
}

test('air moves only from a sucking fan to a blowing one, cleaned on the way', async () => {
  const flowing = await ventilated(['suck', 'blow']);
  const still = await ventilated(['blow', 'blow']);
  for (const run of [flowing, still]) {
    for (const l of run.state.levels) l.airQuality = 50;
    ticks(run, 1);
  }
  assert.ok(flowing.state.resources.flows.air.moved > 0);
  assert.equal(still.state.resources.flows.air.moved, 0, 'two blowers move nothing');
  assert.ok(flowing.state.levels[24].airQuality > still.state.levels[24].airQuality + 5,
    `blown ${flowing.state.levels[24].airQuality} vs still ${still.state.levels[24].airQuality}`);
});

test('the flow on each duct is recorded, running from sucker to blower', async () => {
  const run = await ventilated(['suck', 'blow']);
  ticks(run, 1);
  const air = run.state.resources.flows.air;
  const [intoScrubber, outOfScrubber] = run.state.infrastructure.links;
  const cap = run.ctx.catalog.buildings.byId['duct-fan'].airflowPerTick;
  assert.equal(air.links[intoScrubber.id].to, at(run, 'scrubber-bank', 30).instanceId);
  assert.equal(air.links[outOfScrubber.id].to, fan(run, 25));
  assert.ok(Math.abs(air.links[outOfScrubber.id].flow - cap) < 1e-9);
  assert.ok(air.levelIn[25] > 0 && air.levelOut[36] > 0);
  assert.ok(air.links[outOfScrubber.id].airQuality >= air.links[intoScrubber.id].airQuality);
  // And back through the rooms, blower to sucker, carrying the dirt off.
  const [stream] = air.paths;
  assert.equal(stream.from, fan(run, 25));
  assert.equal(stream.to, fan(run, 36));
  assert.ok(Math.abs(stream.flow - cap) < 1e-9);
  assert.ok(stream.blown.airQuality >= stream.drawn.airQuality);

  // Turned round, the fans would push foul air up the fresh line: the loop
  // only runs into a scrubber on foul ducts and out of it on fresh ones.
  setFan(run, 36, 'blow');
  setFan(run, 25, 'suck');
  ticks(run, 1);
  assert.equal(run.state.resources.flows.air.moved, 0);
});

test('between blower and sucker the air goes through every level, and two blowers leave a still gap', async () => {
  // One sucker at 36, blowers at 20 and 30: all the air they blow heads
  // down to 36, so the levels between the two blowers see only what the
  // upper one sends past, the levels above it nothing at all.
  const layout = [['main-generator', 38], ['duct-fan', 36], ['scrubber-bank', 33], ['duct-fan', 30], ['duct-fan', 20]];
  const run = await runWith(layout, { keep: SCRUBBING, networks: AIR, tunables: STILL });
  link(run, 'foul-ducts', ['duct-fan', 36], 'scrubber-bank');
  link(run, 'fresh-ducts', 'scrubber-bank', ['duct-fan', 30]);
  tap(run, 'fresh-ducts', ['duct-fan', 20], run.state.infrastructure.links.at(-1).id);
  setFan(run, 36, 'suck');
  ticks(run, 1);
  const air = run.state.resources.flows.air;
  const cap = run.ctx.catalog.buildings.byId['duct-fan'].airflowPerTick;
  // The flow down the stairwell is what has been blown in above, less what has been drawn out.
  assert.equal(air.shaft[15], 0, 'nothing crosses above the upper blower');
  assert.ok(Math.abs(air.shaft[25] - cap / 2) < 1e-6, `between the blowers: ${air.shaft[25]}`);
  assert.ok(Math.abs(air.shaft[33] - cap) < 1e-6, `below both: ${air.shaft[33]}`);
  assert.equal(air.through[15], 0);
  assert.ok(air.through[25] > 0 && air.through[25] < air.through[33]);
  // As streams: each blower's air to the sucker, neither crossing the other.
  assert.deepEqual(air.paths.map((p) => p.to), [fan(run, 36), fan(run, 36)]);
});

test('no air moves round a loop that does not pass a scrubber', async () => {
  const layout = [['main-generator', 38], ['duct-fan', 30], ['duct-fan', 25]];
  const run = await runWith(layout, { keep: FUEL, networks: AIR, tunables: STILL });
  link(run, 'foul-ducts', ['duct-fan', 30], ['duct-fan', 25]);
  setFan(run, 30, 'suck');
  ticks(run, 1);
  assert.equal(run.state.resources.flows.air.moved, 0);
});

test('a scrubber cleans only what its ducts carry through it, never the air passing it', async () => {
  const layout = [['main-generator', 38], ['scrubber-bank', 20], ['simple-suite', 20], ['duct-fan', 18], ['duct-fan', 24]];
  const run = await runWith(layout, { keep: SCRUBBING, networks: AIR, tunables: STILL });
  run.state.population.headcount = 160;
  // Two fans with the scrubber between them, blowing and sucking through the
  // Shaft past it — but not ducted to it.
  setFan(run, 24, 'suck');
  link(run, 'foul-ducts', ['duct-fan', 24], ['duct-fan', 18]);
  ticks(run, 60);
  const air = (i) => run.state.levels[i - 1].airQuality;
  assert.ok(air(20) < 90, `the Shaft's air drifts past it uncleaned, got ${air(20)}`);

  // Ducted into a loop through it, the air it cleans is what the ducts carry.
  run.state.infrastructure.links = [];
  link(run, 'foul-ducts', ['duct-fan', 24], 'scrubber-bank');
  link(run, 'fresh-ducts', 'scrubber-bank', ['duct-fan', 18]);
  const before = air(20);
  ticks(run, 60);
  assert.ok(run.state.resources.flows.air.moved > 0);
  assert.ok(air(20) > before + 10, `ducted, it cleans: ${before} to ${air(20)}`);
});

test('an oxygen garden\'s oxygen reaches only where the air carries it', async () => {
  const layout = [['main-generator', 38], ['duct-fan', 4], ['oxygen-garden', 6], ['scrubber-bank', 9], ['duct-fan', 13], ['simple-suite', 13]];
  const tunables = { 'air.migrationRateBetweenLevels': 0, 'water.potablePerCapitaPerTick': 0 };
  const alone = await runWith(layout, { keep: SCRUBBING, networks: AIR, tunables });
  const ducted = await runWith(layout, { keep: SCRUBBING, networks: AIR, tunables });
  // Foul air in at the garden's foul sleeve, breathed into, out at its fresh.
  link(ducted, 'foul-ducts', ['duct-fan', 4], 'oxygen-garden');
  link(ducted, 'fresh-ducts', 'oxygen-garden', ['duct-fan', 13]);
  setFan(ducted, 4, 'suck');
  for (const run of [alone, ducted]) {
    run.engine.systems.water = { tick() {} }; // the garden's water is not the question
    run.state.population.headcount = 200;
    ticks(run, 60);
  }
  assert.ok(alone.state.levels[12].oxygen < 90, `got ${alone.state.levels[12].oxygen}`);
  assert.ok(ducted.state.levels[12].oxygen > alone.state.levels[12].oxygen + 10);
});

test('only a duct fan takes a direction', async () => {
  const run = await runWith([['duct-fan', 20], ['scrubber-bank', 22]], { networks: AIR });
  dispatch(run.state, run.ctx, { type: 'player:setFanMode', instanceId: at(run, 'scrubber-bank', 22).instanceId, mode: 'suck' });
  dispatch(run.state, run.ctx, { type: 'player:setFanMode', instanceId: fan(run, 20), mode: 'sideways' });
  assert.equal(at(run, 'scrubber-bank', 22).fanMode, undefined);
  assert.equal(at(run, 'duct-fan', 20).fanMode, undefined);
  setFan(run, 20, 'suck');
  assert.equal(at(run, 'duct-fan', 20).fanMode, 'suck');
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

test('the surface is outside the Shaft\'s air: always clean, never vented', async () => {
  const layout = [['main-generator', 38], ['duct-fan', 2], ['scrubber-bank', 5], ['duct-fan', 8]];
  const run = await runWith(layout, { keep: SCRUBBING, networks: AIR });
  link(run, 'foul-ducts', ['duct-fan', 2], 'scrubber-bank');
  link(run, 'fresh-ducts', 'scrubber-bank', ['duct-fan', 8]);
  setFan(run, 2, 'suck');
  for (const l of run.state.levels) l.airQuality = 50;
  ticks(run, 1);
  const air = run.state.resources.flows.air;
  assert.equal(run.state.levels[0].airQuality, 100);
  assert.equal(run.state.levels[0].oxygen, 100);
  assert.equal(air.levelOut[1], 0, 'no vent opens on the surface');
  assert.ok(air.levelOut[2] > 0);
});
