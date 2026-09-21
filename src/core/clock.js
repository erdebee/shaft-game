/**
 * clock.js
 * Owns simulation time. Real-time advance with pause, speed multipliers,
 * and the decision-window boundaries that gate Board sessions and dilemmas.
 *
 * Time scale: 1 tick = 1 second real at NORMAL, 20 ticks per shift, 3 shifts
 * per day — so one in-game day is 60 seconds at NORMAL and 6 at VERY_FAST.
 *
 * advance() is the ONLY place in the codebase that consumes wall-clock time.
 * Everything downstream counts ticks, which is what lets headless fast-forward
 * produce byte-identical results to a real-time run.
 */

export const SPEEDS = { PAUSED: 0, NORMAL: 1, FAST: 3, VERY_FAST: 10 };

/**
 * Never simulate more than this many ticks from one frame. Without it, a
 * backgrounded tab returns with a 30-second delta and locks the main thread
 * catching up — the classic spiral of death. Dropped time is dropped, not
 * banked, so the sim stays responsive at the cost of running slightly slow
 * after a stall.
 */
export const MAX_TICKS_PER_FRAME = 20;

export function createClock({ tickMs = 1000, startTick = 0 } = {}) {
  return {
    tick: startTick,
    tickMs,
    speed: SPEEDS.NORMAL,
    accumulator: 0,
    ticksPerDecisionWindow: 60,
    ticksPerShift: 20,
    shiftsPerDay: 3,
  };
}

/** Copy the resolved config's timing into the clock at boot. */
export function configureClock(clock, config) {
  clock.tickMs = config.clock.tickMs;
  clock.ticksPerDecisionWindow = config.clock.ticksPerDecisionWindow;
  clock.ticksPerShift = config.clock.ticksPerShift;
  clock.shiftsPerDay = config.clock.shiftsPerDay;
  return clock;
}

/**
 * Advance the clock by real elapsed ms. Returns how many sim ticks elapsed.
 * Does NOT increment clock.tick — the engine does that as it steps, so a tick
 * is only counted once its systems have actually run.
 */
export function advance(clock, deltaMs) {
  if (clock.speed === SPEEDS.PAUSED) return 0;

  clock.accumulator += deltaMs * clock.speed;

  const whole = Math.floor(clock.accumulator / clock.tickMs);
  if (whole <= 0) return 0;

  const ticks = Math.min(whole, MAX_TICKS_PER_FRAME);
  clock.accumulator -= ticks * clock.tickMs;
  // Drop the overflow rather than banking it, or a stall compounds.
  if (whole > ticks) clock.accumulator = 0;

  return ticks;
}

/**
 * Fraction of the way to the next tick, 0..1. The view interpolates with this
 * to animate between discrete sim states. Frozen while paused, because
 * advance() returns early and never touches the accumulator.
 */
export function alphaOf(clock) {
  return Math.min(1, clock.accumulator / clock.tickMs);
}

/** True when this tick closes a decision window (Board session, shift change). */
export function isDecisionBoundary(clock) {
  return clock.tick > 0 && clock.tick % clock.ticksPerDecisionWindow === 0;
}

export function isShiftBoundary(clock) {
  return clock.tick > 0 && clock.tick % clock.ticksPerShift === 0;
}

/** In-world time, for display. Day 1 is the first day, not day 0. */
export function calendar(clock) {
  const ticksPerDay = clock.ticksPerShift * clock.shiftsPerDay;
  return {
    day: Math.floor(clock.tick / ticksPerDay) + 1,
    shift: Math.floor((clock.tick % ticksPerDay) / clock.ticksPerShift) + 1,
    tickInShift: clock.tick % clock.ticksPerShift,
  };
}
