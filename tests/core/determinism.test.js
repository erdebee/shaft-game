/**
 * Determinism. The load-bearing test suite.
 *
 * The project promises three things about randomness and time:
 *   - headless fast-forward reproduces a real-time run exactly
 *   - a run replays from seed + configHash + commandLog
 *   - a save/reload resumes without diverging
 *
 * None of those survive contact with a growing codebase unless something
 * checks them. These are the checks. If one fails, the fix is the engine, not
 * the test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRun, replay } from '../../src/core/run.js';
import { stepOnce, step, fastForward } from '../../src/core/engine.js';
import { dispatch } from '../../src/core/commands.js';
import { assertSerializable } from '../../src/core/gameState.js';
import { hashData } from '../../src/utils/hash.js';
import { loadDataset } from '../../src/config/contentLoader.js';
import { unimplementedOps } from '../../src/core/effects.js';
import { unimplementedPredicates } from '../../src/core/predicates.js';
import { SPEEDS } from '../../src/core/clock.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = join(ROOT, 'resources/data');
const readJson = async (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'));

/** One dataset, shared: loading is the slow part and it is immutable per chapter. */
const dataset = await loadDataset({ readJson, chapter: 1, profile: 'default' });

/** A small opening layout, enough to make power and haulage do real work. */
const LAYOUT = [
  ['main-generator', 38], ['junction', 30], ['hydroponics-bay', 13],
  ['hydroponics-bay', 14], ['canteen', 26], ['simple-suite', 24],
  ['workshop', 36], ['scrubber-bank', 20], ['deep-pump', 40],
];

async function newRun(seed = 4242) {
  const run = await createRun({ dataset, seed, chapter: 1, readJson });
  for (const [buildingId, level] of LAYOUT) {
    dispatch(run.state, run.ctx, { type: 'player:placeBuilding', buildingId, level, inherited: true });
  }
  for (const instance of run.state.buildings) {
    const def = dataset.catalog.buildings.byId[instance.buildingId];
    dispatch(run.state, run.ctx, {
      type: 'player:assignStaff', instanceId: instance.instanceId, count: def.staffing ?? 0,
    });
  }
  return run;
}

/**
 * State fingerprint for comparing two runs.
 *
 * Two fields are excluded, and only these two:
 *   meta.createdAt        wall-clock stamp, differs between any two runs
 *   clock.accumulator     sub-tick wall-clock residue. A headless run never
 *                         accrues any; a 60fps run lands on the same tick
 *                         holding a fraction of the next one. That is render
 *                         timing, not simulation state — two runs on the same
 *                         tick with different accumulators are the same world.
 *
 * Everything else is compared, including the command log.
 */
function fingerprint(state) {
  const { meta, clock, ...rest } = state;
  const { createdAt, ...metaRest } = meta;
  const { accumulator, ...clockRest } = clock;
  return hashData({ ...rest, meta: metaRest, clock: clockRest });
}

test('the same seed produces the same run', async () => {
  const a = await newRun(7);
  const b = await newRun(7);
  fastForward(a.engine, 200);
  fastForward(b.engine, 200);
  assert.equal(fingerprint(a.state), fingerprint(b.state));
});

test('different seeds diverge', async () => {
  const a = await newRun(7);
  const b = await newRun(8);
  fastForward(a.engine, 200);
  fastForward(b.engine, 200);
  // Placement is deterministic, so divergence must come from a seeded draw —
  // porter names are the slice's only one, which is enough to prove streams
  // are actually wired to the seed.
  assert.notEqual(
    a.state.population.workers.map((w) => w.name).join(),
    b.state.population.workers.map((w) => w.name).join(),
  );
});

test('fastForward is identical to real-time stepping', async () => {
  const headless = await newRun();
  const realtime = await newRun();

  fastForward(headless.engine, 300);
  // 300 sim seconds delivered in ~60fps frames, as the browser would.
  while (realtime.state.clock.tick < 300) step(realtime.engine, 16.7);

  assert.equal(realtime.state.clock.tick, 300, 'real-time run should land exactly on 300');
  assert.equal(fingerprint(headless.state), fingerprint(realtime.state));
});

test('a run replays from its command log', async () => {
  const live = await newRun(99);

  fastForward(live.engine, 50);
  dispatch(live.state, live.ctx, { type: 'player:placeBuilding', buildingId: 'protein-vats', level: 15 });
  fastForward(live.engine, 50);
  dispatch(live.state, live.ctx, {
    type: 'player:setPriorityLadder',
    ladder: ['life-support', 'medical', 'water', 'industry', 'residential', 'amenity'],
  });
  fastForward(live.engine, 100);

  // The replay gets the log and nothing else — no state, no save file.
  const replayed = await replay(live.state.commandLog, live.state.clock.tick, {
    dataset, seed: 99, chapter: 1, readJson,
  });

  assert.equal(replayed.state.clock.tick, live.state.clock.tick);
  assert.equal(
    replayed.state.buildings.map((b) => `${b.buildingId}@${b.level}:${b.slot}`).join(),
    live.state.buildings.map((b) => `${b.buildingId}@${b.level}:${b.slot}`).join(),
  );
  assert.deepEqual(replayed.state.governance.priorityLadder, live.state.governance.priorityLadder);
  assert.deepEqual(
    replayed.state.population.workers.map((w) => w.name),
    live.state.population.workers.map((w) => w.name),
  );
});

test('save and reload resumes without diverging', async () => {
  const straight = await newRun(1717);
  fastForward(straight.engine, 300);

  const interrupted = await newRun(1717);
  fastForward(interrupted.engine, 150);

  // Save at 150: state plus the RNG cursors, which is the part that would
  // otherwise silently reset and desynchronise every later draw.
  const saved = JSON.parse(JSON.stringify({
    state: interrupted.state,
    cursors: interrupted.state.meta.rngCursors,
  }));

  const resumed = await createRun({
    dataset, seed: 1717, chapter: 1, readJson,
    state: saved.state, cursors: saved.cursors,
  });
  fastForward(resumed.engine, 150);

  assert.equal(resumed.state.clock.tick, 300);
  assert.equal(fingerprint(straight.state), fingerprint(resumed.state));
});

test('rng cursors advance and are recorded in state', async () => {
  const run = await newRun();
  const before = { ...run.state.meta.rngCursors };
  run.ctx.rng.narrative.next();
  run.ctx.rng.narrative.next();
  stepOnce(run.engine);
  assert.equal(run.state.meta.rngCursors.narrative, (before.narrative ?? 0) + 2);
});

test('state stays JSON-serializable after a long run', async () => {
  const run = await newRun();
  fastForward(run.engine, 400);
  assert.doesNotThrow(() => assertSerializable(run.state));
});

test('nothing in src calls Math.random', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js')) {
        const source = readFileSync(full, 'utf8');
        // Strip comments so a docstring warning about Math.random is not a hit.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        if (/Math\.random/.test(code)) offenders.push(full.slice(ROOT.length + 1));
      }
    }
  };
  walk(join(ROOT, 'src'));
  assert.deepEqual(
    offenders,
    [],
    `Math.random breaks reproducibility. Use a named stream from src/core/streams.js:\n${offenders.join('\n')}`,
  );
});

test('every declared effect op and predicate has a handler', () => {
  assert.deepEqual(
    unimplementedOps(), [],
    'ops declared in schema.js with no handler in core/effects.js',
  );
  assert.deepEqual(
    unimplementedPredicates(), [],
    'predicates declared in schema.js with no handler in core/predicates.js',
  );
});

test('a paused clock runs no ticks', async () => {
  const run = await newRun();
  fastForward(run.engine, 20);
  const at = run.state.clock.tick;

  run.state.clock.speed = SPEEDS.PAUSED;
  for (let i = 0; i < 120; i++) step(run.engine, 16.7);

  assert.equal(run.state.clock.tick, at, 'a paused clock must not advance');
});

test('speed multiplies ticks per unit of real time', async () => {
  const normal = await newRun();
  const fast = await newRun();
  fast.state.clock.speed = SPEEDS.FAST;

  for (let i = 0; i < 180; i++) { // ~3s of frames
    step(normal.engine, 16.7);
    step(fast.engine, 16.7);
  }
  assert.equal(fast.state.clock.tick, normal.state.clock.tick * SPEEDS.FAST);
});
