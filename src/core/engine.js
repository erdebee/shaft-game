/**
 * engine.js
 * The game loop. Drives systems in a fixed order each tick so results are
 * deterministic under a fixed seed — required for headless fast-forward
 * and for reproducing playtest reports.
 *
 * ONE ATOMIC UNIT: stepOnce(). Real-time play and headless fast-forward both
 * go through it, so fastForward(n) is bit-identical to playing n ticks. Only
 * advance() ever reads wall-clock.
 *
 * THREE PHASES per tick, and the ordering matters:
 *   1. Simulate  — systems run in SYSTEM_ORDER. Each reads anything, writes
 *                  only its own domain, and pushes events to the outbox.
 *   2. Resolve   — the outbox is drained through the event bus. Listeners
 *                  react; anything wanting to stop the clock requests a pause.
 *   3. Boundary  — decision window, then honour the pause request.
 *
 * A dilemma raised during the narrative phase therefore pauses AFTER the tick
 * completes, never mid-pipeline. Without that, a hard-pausing dilemma tears a
 * tick in half and any save taken there is inconsistent.
 */

import { advance, alphaOf, isDecisionBoundary, isShiftBoundary, SPEEDS } from './clock.js';
import { emit } from './eventBus.js';
import { collectModifiers } from './effects.js';

const SYSTEM_ORDER = [
  'power',        // decide what is energised before anything consumes
  'resources',    // extraction and conversion
  'water',
  'airQuality',
  'haulage',      // move what was produced
  'buildings',    // condition, wear, output modifiers
  'population',   // consumption, health, deaths, the labour pool
  'society',      // meters, faction satisfaction, strikes and riots
  'governance',   // statute effects, enforcement
  'narrative',    // dilemmas, scheduled events, revelation staging
];

/**
 * @param {object} state
 * @param {object} systems  { [name]: { tick(state, ctx) } }
 * @param {object} ctx      { config, catalog, content, rng, emit, ... }
 */
export function createEngine(state, systems, ctx) {
  return {
    state,
    systems,
    ctx,
    running: false,
    rafId: null,
    lastFrame: 0,
    view: null,
    onFrame: null,
  };
}

/**
 * Build the context systems receive. Never serialized — it holds functions
 * and RNG closures, which is exactly why it is separate from state.
 */
export function createContext({ dataset, streams, cursors, outbox }) {
  return {
    config: dataset.config,
    catalog: dataset.catalog,
    content: dataset.content,
    tables: dataset.tables,
    shaft: dataset.shaft,
    rng: streams,
    cursors,
    modifiers: { meter: {}, risk: {}, buffer: {}, network: {}, scrub: {}, quality: {}, multiply: {}, capabilities: {}, recipes: {}, haulage: {} },
    pauseRequested: false,
    /** Systems emit here; the engine drains it in the Resolve phase. */
    emit(event, payload) {
      outbox.push({ event, payload });
    },
  };
}

/**
 * One simulation tick. Pure with respect to state + seeded RNG.
 * This is the atomic unit — nothing else advances the simulation.
 */
export function stepOnce(engine) {
  const { state, systems, ctx } = engine;
  const outbox = [];

  // Rebind emit to this tick's outbox so events cannot leak between ticks.
  const tickCtx = { ...ctx, emit: (event, payload) => outbox.push({ event, payload }) };

  state.clock.tick += 1;

  // Standing modifiers are recomputed every tick, never accumulated — see
  // effects.js for why applying a building's +6 morale per tick is a bug.
  tickCtx.modifiers = collectModifiers(state, tickCtx);

  // --- 1. Simulate -----------------------------------------------------
  for (const name of SYSTEM_ORDER) {
    systems[name]?.tick(state, tickCtx);
  }

  // --- 2. Resolve ------------------------------------------------------
  tickCtx.pauseRequested = false;
  for (const { event, payload } of outbox) {
    emit(event, { ...payload, tick: state.clock.tick });
  }
  if (state.narrative.activeDilemma?.hardPause) tickCtx.pauseRequested = true;

  // --- 3. Boundary -----------------------------------------------------
  if (isShiftBoundary(state.clock)) emit('shift:boundary', { tick: state.clock.tick });
  if (isDecisionBoundary(state.clock)) emit('decision:window', { tick: state.clock.tick });

  if (tickCtx.pauseRequested && state.clock.speed !== SPEEDS.PAUSED) {
    state.clock.speed = SPEEDS.PAUSED;
    emit('clock:autoPaused', { tick: state.clock.tick, reason: 'dilemma' });
  }

  // Keep cursors current so a save at any tick records the right positions.
  state.meta.rngCursors = { ...engine.ctx.cursors };

  return state.clock.tick;
}

/**
 * Advance by real elapsed ms, running whole ticks only.
 * Returns how many ticks ran, so the caller can tell a stalled frame from a
 * paused one.
 */
export function step(engine, deltaMs) {
  const ticks = advance(engine.state.clock, deltaMs);
  for (let i = 0; i < ticks; i++) stepOnce(engine);
  return ticks;
}

/** Run N ticks with no rendering. Used by balance tooling and the tests. */
export function fastForward(engine, tickCount) {
  for (let i = 0; i < tickCount; i++) stepOnce(engine);
  return engine.state.clock.tick;
}

/**
 * Start the rAF loop. Simulation runs at a fixed tick rate; rendering runs
 * once per frame with a sub-tick alpha, so motion is smooth at 60fps over a
 * 1Hz simulation.
 */
export function start(engine) {
  if (engine.running) return;
  engine.running = true;
  engine.lastFrame = now();

  const frame = () => {
    if (!engine.running) return;

    const t = now();
    const deltaMs = t - engine.lastFrame;
    engine.lastFrame = t;

    step(engine, deltaMs);

    const alpha = alphaOf(engine.state.clock);
    engine.view?.render(engine.state, engine.ctx, engine.state.clock.tick, alpha);
    engine.onFrame?.(engine.state, alpha);

    engine.rafId = requestAnimationFrame(frame);
  };

  engine.rafId = requestAnimationFrame(frame);
}

export function stop(engine) {
  engine.running = false;
  if (engine.rafId !== null) cancelAnimationFrame(engine.rafId);
  engine.rafId = null;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export { SYSTEM_ORDER };
