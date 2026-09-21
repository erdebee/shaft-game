/**
 * roster.js
 * Individually-tracked workers. Most of the settlement is aggregate — cohort
 * headcounts in state.population.cohorts — because simulating 2400 people
 * individually buys nothing a management sim needs.
 *
 * Porters are the exception. Their movement is visible, their fatigue accrues
 * to a person rather than a pool, and "this porter has walked four thousand
 * levels this month" is the kind of small human detail the tone asks for. The
 * roster holds only roles that earn that cost; `job` is what decides.
 *
 * Names are drawn from the 'names' RNG stream, which nothing else touches, so
 * hiring a porter can never shift the economy's sequence.
 */

import { clamp } from '../../utils/math.js';

/**
 * Fatigue recovery, and retirement of trips that have arrived.
 * Fatigue accrues in haulageMethods where the walking happens; this is the
 * other half — resting while unassigned.
 */
export function tick(state, ctx) {
  const recovery = ctx.config.haulage.fatiguePerLevelHauled * 2;

  for (const worker of state.population.workers) {
    if (worker.tripId === null) {
      worker.fatigue = clamp(worker.fatigue - recovery, 0, 1);
    }
  }
}

/**
 * Hire a worker into an individually-tracked role.
 * Ids are sequential from state so they survive a save; names come from the
 * seeded pool so the same run always produces the same people.
 */
export function hire(state, ctx, job, level = 1) {
  const id = `w${state.population.nextWorkerId}`;
  state.population.nextWorkerId += 1;

  const worker = {
    id,
    name: makeName(ctx),
    job,
    level,
    fatigue: 0,
    tripId: null,
    levelsWalked: 0,
  };
  state.population.workers.push(worker);
  return worker;
}

/** Workers in a role, in hire order. */
export function workersInJob(state, job) {
  return state.population.workers.filter((w) => w.job === job);
}

/**
 * An idle worker in a role, least fatigued first. Ties break on id so the
 * choice never depends on array order after a load.
 */
export function idleWorker(state, job) {
  return workersInJob(state, job)
    .filter((w) => w.tripId === null)
    .sort((a, b) => a.fatigue - b.fatigue || a.id.localeCompare(b.id))[0] ?? null;
}

function makeName(ctx) {
  const pools = ctx.tables?.names;
  if (!pools) return 'Unnamed';
  const given = ctx.rng.names.pick(pools.given);
  const family = ctx.rng.names.pick(pools.family);
  return `${given} ${family}`;
}

/**
 * Seed the starting roster. Porter count comes from the haulage demand the
 * shaft is expected to carry, not from a magic number — one porter per two
 * levels is enough to keep the stairwell busy without saturating it.
 */
export function seedRoster(state, ctx) {
  const porters = Math.max(4, Math.round(state.levels.length / 4));
  for (let i = 0; i < porters; i++) {
    hire(state, ctx, 'porter', 1 + ((i * 7) % state.levels.length));
  }
}
