/**
 * Statute compilation and conflict detection — the highest-risk logic in the
 * project, since players will write article combinations nobody anticipated.
 * Also the Accord's calendar, its prices and the repeal penalty.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWith, ticks, KITCHEN } from '../helpers/sim.js';
import { dispatch } from '../../src/core/commands.js';
import { collectModifiers } from '../../src/core/effects.js';
import { sessionOf, costOf, check, conflicts, repealPenalty } from '../../src/governance/statuteEngine.js';

const enact = (run, cardId) => dispatch(run.state, run.ctx, { type: 'player:enactStatute', cardId });
const repeal = (run, cardId) => dispatch(run.state, run.ctx, { type: 'player:repealStatute', cardId });
const active = (run, cardId) => run.state.governance.enacted.some((e) => e.id === cardId);

test('an enacted article produces the expected system effect', async () => {
  const run = await runWith(KITCHEN);
  const before = collectModifiers(run.state, run.ctx);
  enact(run, 'public-assembly-rights');
  assert.ok(active(run, 'public-assembly-rights'));
  const after = collectModifiers(run.state, run.ctx);
  assert.equal((after.meter.trust ?? 0) - (before.meter.trust ?? 0), 10);
  assert.equal((after.meter.stability ?? 0) - (before.meter.stability ?? 0), -6);
  // A statute's faction effect stands for as long as it is law.
  assert.equal(after.faction.order, -8);
  assert.equal(run.state.governance.authority, run.ctx.config.governance.authorityStart - 7);
});

test('law changes only while a session sits, and Authority is paid as one opens', async () => {
  const run = await runWith(KITCHEN);
  const { sessionTicks, authorityRegenPerWindow } = run.ctx.config.governance;
  const every = run.ctx.config.clock.ticksPerAmendmentWindow;
  assert.equal(sessionOf(run.state, run.ctx).open, true, 'the run opens in session');

  ticks(run, sessionTicks);
  assert.equal(sessionOf(run.state, run.ctx).open, false);
  enact(run, 'mandatory-curfew');
  assert.equal(active(run, 'mandatory-curfew'), false, 'refused out of session');

  const before = run.state.governance.authority;
  ticks(run, every - sessionTicks);
  assert.equal(sessionOf(run.state, run.ctx).open, true);
  assert.equal(run.state.governance.authority, Math.min(run.ctx.config.governance.authorityCap, before + authorityRegenPerWindow));
  enact(run, 'mandatory-curfew');
  assert.ok(active(run, 'mandatory-curfew'));
});

test('contradicting your own precedent costs more, and a law you cannot pay for is refused', async () => {
  const run = await runWith(KITCHEN);
  assert.equal(costOf(run.state, run.ctx, 'public-assembly-rights').total, 7);

  // Three harsh dissent rulings: six leaning steps from a lenient dissent law.
  run.state.governance.precedent.dissent = { harsh: 3 };
  const cost = costOf(run.state, run.ctx, 'public-assembly-rights');
  assert.equal(cost.steps, 6);
  assert.equal(cost.total, 7 + Math.ceil(7 * 0.25 * 6));
  // And a harsh law in the same theme costs what it always did.
  assert.equal(costOf(run.state, run.ctx, 'mandatory-curfew').total, 6);

  run.state.governance.authority = cost.total - 1;
  assert.equal(check(run.state, run.ctx, 'public-assembly-rights').reason, 'authority');
  enact(run, 'public-assembly-rights');
  assert.equal(active(run, 'public-assembly-rights'), false);
});

test('a card whose requirement is unmet is refused', async () => {
  const run = await runWith(KITCHEN);
  assert.equal(check(run.state, run.ctx, 'restricted-zone').reason, 'requires');
  const guarded = await runWith([...KITCHEN, ['security-post', 5]]);
  assert.equal(check(guarded.state, guarded.ctx, 'restricted-zone').ok, true);
});

test('contradictory articles are reported, not silently resolved', async () => {
  const run = await runWith(KITCHEN);
  enact(run, 'mandatory-curfew');
  enact(run, 'public-assembly-rights');
  assert.ok(active(run, 'mandatory-curfew') && active(run, 'public-assembly-rights'), 'both stand');
  assert.deepEqual(conflicts(run.state, run.ctx), [{ article: 'assembly', ids: ['mandatory-curfew', 'public-assembly-rights'] }]);
  // Same article, same direction: no conflict.
  const quiet = await runWith(KITCHEN);
  enact(quiet, 'petition-system');
  enact(quiet, 'public-assembly-rights');
  assert.deepEqual(conflicts(quiet.state, quiet.ctx), []);
});

test.todo('an amendment forbidden by the Core Mandate is rejected with its clause');

test('repeal removes effects without rewriting history, at a price that grows with standing', async () => {
  const run = await runWith(KITCHEN);
  enact(run, 'mandatory-curfew');
  assert.equal(repealPenalty(run.state, run.ctx, 'mandatory-curfew').penalty, 0, 'fresh law is cheap to reverse');

  // Two amendment windows later, in the third session.
  const every = run.ctx.config.clock.ticksPerAmendmentWindow;
  ticks(run, every * 2);
  const { penalty } = repealPenalty(run.state, run.ctx, 'mandatory-curfew');
  assert.equal(penalty, Math.round(run.ctx.config.governance.flipFlopPenaltyPerWindowStood * 2));

  const trust = run.state.meters.trust;
  repeal(run, 'mandatory-curfew');
  assert.equal(active(run, 'mandatory-curfew'), false);
  assert.ok(Math.abs(run.state.meters.trust - (trust - penalty)) < 1e-9);
  assert.equal(collectModifiers(run.state, run.ctx).meter.freedom ?? 0, 0, 'its standing effects are gone');
  assert.deepEqual(run.state.governance.history.map((h) => h.act), ['enacted', 'repealed']);
});
