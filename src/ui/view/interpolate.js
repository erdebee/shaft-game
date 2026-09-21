/**
 * interpolate.js
 * Turns discrete simulation facts into continuous positions.
 *
 * The simulation runs at 1 tick per second; the screen wants 60fps. Neither
 * rate is where a porter's position belongs, so nothing stores one: position
 * is a pure function of (trip, tick, alpha), recomputed every frame.
 *
 * That is the whole reason animation never appears in gameState. Pause freezes
 * motion because alpha stops advancing; speed changes rescale motion because
 * alpha advances faster. No pause handling, no tween bookkeeping, no drift
 * between what is drawn and what is true.
 *
 * DELIBERATELY RENDERER-AGNOSTIC. Everything here is in shaft units, not
 * pixels — so if the figure layer ever moves from SVG to canvas, this file
 * does not change.
 */

import { clamp, lerp } from '../../utils/math.js';

/** Shaft coordinate system. One level is 10 units tall; the shaft is 100 wide. */
export const LEVEL_HEIGHT = 10;
export const SHAFT_WIDTH = 100;

/** Fixed columns. The stairwell is on the left, the elevator shaft the right. */
export const STAIR_X = 7;
export const ELEVATOR_X = 93;
export const BUILD_X = 16;
export const BUILD_WIDTH = 68;

/** Top edge of a level, in shaft units. Level 1 is the surface. */
export function levelY(level) {
  return (level - 1) * LEVEL_HEIGHT;
}

/** Vertical centre of a level — where a figure standing on it belongs. */
export function levelCentreY(level) {
  return levelY(level) + LEVEL_HEIGHT / 2;
}

/** Fractional simulation time. The single input that makes motion continuous. */
export function simTime(tick, alpha) {
  return tick + clamp(alpha, 0, 1);
}

/**
 * How far through its journey a trip is, 0..1.
 * Clamped, so a trip awaiting collection sits at its destination rather than
 * overshooting if a frame lands after the arrival tick.
 */
export function tripProgress(trip, tick, alpha) {
  const span = trip.arriveTick - trip.startTick;
  if (span <= 0) return 1;
  return clamp((simTime(tick, alpha) - trip.startTick) / span, 0, 1);
}

/**
 * Position of a trip's carrier in shaft units.
 *
 * The x-coordinate is where the two visuals diverge: a porter on the stairwell
 * switchbacks side to side as they descend, an elevator car runs dead straight
 * up its shaft. Same interpolation, same trip record, different column.
 */
export function tripPosition(trip, tick, alpha) {
  const p = tripProgress(trip, tick, alpha);
  const y = lerp(levelCentreY(trip.fromLevel), levelCentreY(trip.toLevel), p);
  const descending = trip.toLevel > trip.fromLevel;

  if (trip.method === 'stairwell') {
    return {
      x: STAIR_X + switchback(y),
      y,
      progress: p,
      descending,
      level: levelAt(y),
    };
  }

  return {
    x: trip.method === 'dumbwaiter' ? ELEVATOR_X - 6 : ELEVATOR_X,
    y,
    progress: p,
    descending,
    level: levelAt(y),
  };
}

/**
 * Lateral offset for a figure on the stairs. Stairwells switchback once per
 * level, so a porter drifts across the shaft and back as they pass each floor
 * — cheap, and it reads as walking rather than sliding.
 */
function switchback(y) {
  const withinLevel = (y % LEVEL_HEIGHT) / LEVEL_HEIGHT;
  const triangle = withinLevel < 0.5 ? withinLevel * 2 : (1 - withinLevel) * 2;
  return (triangle - 0.5) * 4;
}

/** Which level a shaft-unit y falls on. */
export function levelAt(y) {
  return Math.floor(y / LEVEL_HEIGHT) + 1;
}

/**
 * Slot rectangle for a placed building, in shaft units. Slots divide the
 * buildable width of a level evenly, so a 2-slot building is twice as wide as
 * a 1-slot one on the same level.
 */
export function slotRect(slotIndex, slots, buildSlots, level) {
  const unit = BUILD_WIDTH / buildSlots;
  return {
    x: BUILD_X + slotIndex * unit,
    y: levelY(level) + 1,
    width: unit * slots,
    height: LEVEL_HEIGHT - 2,
  };
}

/**
 * Where ambient worker figures stand inside a building's rectangle.
 * Positions are derived from the index, not randomised, so a worker does not
 * teleport between frames and the same building always looks the same.
 */
export function workerSlot(rect, index, count) {
  const usable = rect.width - 2;
  const spacing = count <= 1 ? 0 : usable / (count - 1);
  return {
    x: rect.x + 1 + (count <= 1 ? usable / 2 : index * spacing),
    // On the building's floor, not floating in it — figures are anchored at
    // the feet, so this is the y their feet sit at.
    y: rect.y + rect.height,
  };
}

/**
 * Stable pseudo-random value in 0..1 from a string key. Used only for visual
 * variation — an ambient animation's phase offset, say.
 *
 * NOT an RNG stream, and deliberately not one: drawing decoration from a
 * simulation stream would let adding a worker sprite shift the economy's
 * sequence, which is precisely what config/rng.js exists to prevent.
 */
export function visualJitter(key) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 8) / 0xffffff;
}
