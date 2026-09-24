/**
 * The dilemma engine end to end, on the ration theft (design-document §4):
 * raised by a shortage, ruled on, recorded as precedent, reshaped by the
 * player's own law, and — after three consistent rulings — offered as policy.
 * Plus the promise the lenient ruling makes, kept and broken.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, KITCHEN, FED_KEEP } from '../helpers/sim.js';
import { dispatch } from '../../src/core/commands.js';
import { stepOnce } from '../../src/core/engine.js';
import { SPEEDS } from '../../src/core/clock.js';
import { replay } from '../../src/core/run.js';
import { present } from '../../src/narrative/dilemmaEngine.js';
import { collectModifiers } from '../../src/core/effects.js';
import { readJson } from '../helpers/sim.js';

const THEFT = 'ration-theft';
const raise = (run) => dispatch(run.state, run.ctx, { type: 'debug:raiseDilemma', dilemmaId: THEFT });
const rule = (run, optionId) => dispatch(run.state, run.ctx, { type: 'player:resolveDilemma', dilemmaId: THEFT, optionId });
const option = (run, id) => present(run.state, run.ctx).options.find((o) => o.id === id);

test('a food shortage raises the ration theft, and it holds the clock', async () => {
  const run = await runWith(KITCHEN, { stocks: { food: 200 } });
  run.state.clock.speed = SPEEDS.NORMAL;
  ticks(run, 900);
  assert.equal(run.state.narrative.activeDilemma?.id, THEFT);
  assert.equal(run.state.clock.speed, SPEEDS.PAUSED);

  // The player cannot unpause past it.
  dispatch(run.state, run.ctx, { type: 'player:setSpeed', speed: 'NORMAL' });
  assert.equal(run.state.clock.speed, SPEEDS.PAUSED);
});

test('no shortage, no case', async () => {
  const run = await runWith(KITCHEN, { keep: FED_KEEP, tunables: { 'population.foodPerCapitaPerTick': 0.0001 } });
  ticks(run, 900);
  assert.equal(run.state.narrative.activeDilemma, null);
});

test('a ruling applies its effects, records precedent, and closes the case', async () => {
  const run = await runWith(KITCHEN);
  raise(run);
  const productivity = run.state.meters.productivity;
  rule(run, 'double-shifts');

  assert.equal(run.state.narrative.activeDilemma, null);
  assert.equal(run.state.meters.productivity, productivity - 6);
  assert.deepEqual(run.state.governance.precedent.scarcity, { pragmatic: 1 });
  assert.equal(run.state.governance.cases.length, 1);
  assert.equal(run.state.governance.cases[0].optionId, 'double-shifts');
  assert.equal(run.state.narrative.dilemmaCooldowns[THEFT], run.state.clock.tick);
});

test('making an example of him needs somewhere to hold him', async () => {
  const run = await runWith(KITCHEN);
  raise(run);
  assert.equal(option(run, 'cut-rations').available, false);
  assert.equal(option(run, 'cut-rations').reason, 'requires');
  rule(run, 'cut-rations');
  assert.ok(run.state.narrative.activeDilemma, 'an unavailable ruling changes nothing');

  const cells = await runWith([...KITCHEN, ['holding-cells', 5]]);
  raise(cells);
  assert.equal(option(cells, 'cut-rations').available, true);
});

test('with rationing quotas already law, the case reads differently and the harsh ruling is withdrawn', async () => {
  const run = await runWith([...KITCHEN, ['holding-cells', 5]]);
  const plain = (raise(run), present(run.state, run.ctx));
  rule(run, 'double-shifts');

  dispatch(run.state, run.ctx, { type: 'player:enactStatute', cardId: 'rationing-quotas' });
  raise(run);
  const view = present(run.state, run.ctx);
  assert.equal(view.variant, true);
  assert.notEqual(view.prompt, plain.prompt);
  assert.ok(view.prompt.length > 0);
  assert.deepEqual(view.options.map((o) => o.id), ['double-shifts', 'give-your-word']);
});

test('a promise kept makes its trust permanent and strengthens later soft rulings', async () => {
  const run = await runWith(KITCHEN, { keep: FED_KEEP, tunables: { 'population.foodPerCapitaPerTick': 0.0001 } });
  raise(run);
  rule(run, 'give-your-word');
  assert.equal(run.state.narrative.timers.length, 1);

  // A second promise on the same matter cannot be given while one is pending.
  raise(run);
  assert.equal(option(run, 'give-your-word').reason, 'promised');
  rule(run, 'double-shifts');

  ticks(run, run.state.narrative.timers[0].holdTicks + 1);
  assert.equal(run.state.narrative.timers.length, 0);
  assert.equal(run.state.narrative.flags['keeps-promises'], true);
  assert.equal(run.state.narrative.promiseRecord.kept, 1);
  assert.equal(run.state.narrative.shifts.trust, 8);
  assert.ok(collectModifiers(run.state, run.ctx).meter.trust >= 8, 'where trust settles has moved for good');

  raise(run);
  const trust = option(run, 'give-your-word').effects.find((e) => e.op === 'meter.add' && e.target === 'trust');
  assert.equal(trust.value, 8 * (1 + run.ctx.config.narrative.promiseKeptSoftBonus));
});

test('a promise broken costs more than the harsh ruling would have, and devalues the next one', async () => {
  const run = await runWith(KITCHEN, { stocks: { food: 100 } });
  raise(run);
  const trust = run.state.meters.trust;
  rule(run, 'give-your-word');
  const timer = run.state.narrative.timers[0];
  timer.expiresTick = run.state.clock.tick + 3;
  ticks(run, 4);

  assert.equal(run.state.narrative.flags['broken-promise'], true);
  assert.equal(run.state.narrative.promiseRecord.broken, 1);
  assert.equal(run.state.narrative.shifts.trust, -4);
  assert.ok(run.state.meters.trust < trust - 10 + 1, `trust ${run.state.meters.trust} should end below what cutting rations costs`);

  run.state.narrative.dilemmaCooldowns = {};
  raise(run);
  const gain = option(run, 'give-your-word').effects.find((e) => e.op === 'meter.add' && e.target === 'trust');
  assert.equal(gain.value, 8 * (1 - run.ctx.config.narrative.promiseBrokenSoftMalus));
});

test('three consistent rulings make the pattern available as policy, at a discount', async () => {
  const run = await runWith(KITCHEN);
  for (let i = 0; i < 3; i++) {
    raise(run);
    assert.equal(option(run, 'codify'), undefined, `not yet codifiable after ${i} rulings`);
    rule(run, 'double-shifts');
  }
  // Out of session: codifying from a ruling does not wait for one.
  ticks(run, run.ctx.config.governance.sessionTicks);

  raise(run);
  const codify = option(run, 'codify');
  assert.ok(codify, 'the fourth case offers policy');
  assert.equal(codify.leaning, 'pragmatic');
  assert.equal(codify.codify.cardId, 'overtime-mandate');
  assert.equal(codify.codify.cost, Math.ceil(5 * (1 - run.ctx.config.governance.codificationDiscount)));

  const authority = run.state.governance.authority;
  rule(run, 'codify');
  assert.ok(run.state.governance.enacted.some((e) => e.id === 'overtime-mandate'));
  assert.equal(run.state.governance.authority, authority - codify.codify.cost);
  assert.equal(run.state.governance.precedent.scarcity.pragmatic, 4, 'it still counts as the ruling it is');
  assert.equal(run.state.governance.history.at(-1).via, 'codified');

  raise(run);
  assert.equal(option(run, 'codify'), undefined, 'a law already enacted is not offered again');
});

test('a mixed record is not a pattern', async () => {
  const run = await runWith([...KITCHEN, ['holding-cells', 5]]);
  for (const choice of ['double-shifts', 'double-shifts', 'double-shifts', 'cut-rations']) {
    raise(run);
    rule(run, choice);
  }
  raise(run);
  assert.equal(option(run, 'codify'), undefined);
});

test('a run with rulings, law and promises replays from its command log', async () => {
  const live = await runWith([...KITCHEN, ['holding-cells', 5]], { seed: 31 });
  const step = (n) => { for (let i = 0; i < n; i++) stepOnce(live.engine); };
  step(20);
  dispatch(live.state, live.ctx, { type: 'player:enactStatute', cardId: 'mandatory-curfew' });
  raise(live);
  rule(live, 'give-your-word');
  step(40);
  raise(live);
  rule(live, 'cut-rations');
  step(40);

  const replayed = await replay(live.state.commandLog, live.state.clock.tick, { dataset: live.dataset, seed: 31, chapter: 1, readJson });
  assert.deepEqual(replayed.state.governance, live.state.governance);
  assert.deepEqual(replayed.state.narrative, live.state.narrative);
  assert.deepEqual(replayed.state.meters, live.state.meters);
});
