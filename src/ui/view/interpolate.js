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
 * DELIBERATELY RENDERER-AGNOSTIC. Everything here is in shaft units — so if
 * the figure layer ever moves from SVG to canvas, this file does not change.
 * Shaft units are 1:1 with sprite pixels (asset-production-spec §2), so a
 * room sprite drawn at its own size lands exactly on its slot.
 */

import { clamp, lerp } from '../../utils/math.js';

/**
 * Shaft coordinate system, in sprite pixels. A level is a 96-px room band over
 * an 8-px slab; a build slot is 64 px wide.
 */
export const LEVEL_HEIGHT = 104;
export const ROOM_HEIGHT = 96;
export const SLOT_WIDTH = 64;
export const BUILD_SLOTS = 10;

/** Rows from a room's top edge to the floor line figures stand on (spec §2.1). */
export const FLOOR_Y = 88;

/**
 * Rooms sit SEAM px apart, and so does the first room from the stairwell. The
 * seam is drawn as a dithered fade between the neighbours (see roomArt.js).
 */
export const SEAM = 2;

/** The stairwell is the 128-px column on the left; there is no lift column. */
export const STAIR_WIDTH = 128;
export const STAIR_X = STAIR_WIDTH / 2;
export const BUILD_X = STAIR_WIDTH;
export const SHAFT_WIDTH = BUILD_X + BUILD_SLOTS * (SLOT_WIDTH + SEAM);

/** Top edge of a level, in shaft units. Level 1 is the surface. */
export function levelY(level) {
  return (level - 1) * LEVEL_HEIGHT;
}

/** Vertical centre of a level. */
export function levelCentreY(level) {
  return levelY(level) + LEVEL_HEIGHT / 2;
}

/** The floor line of a level — where a figure standing on it has its feet. */
export function levelFloorY(level) {
  return levelY(level) + FLOOR_Y;
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
 * follows the drawn stair, an elevator car runs dead straight up its shaft.
 * Same interpolation, same trip record, different column.
 */
export function tripPosition(trip, tick, alpha) {
  const p = tripProgress(trip, tick, alpha);
  const y = lerp(levelFloorY(trip.fromLevel), levelFloorY(trip.toLevel), p);
  const descending = trip.toLevel > trip.fromLevel;

  if (trip.method === 'stairwell') {
    return { ...stairWalk(y, descending), progress: p, descending, level: levelAt(y) };
  }

  // There is no lift column (spec §1), so a lift trip has no screen column of
  // its own; only its height is used, by the car of the lift building.
  return {
    x: null,
    y,
    progress: p,
    descending,
    level: levelAt(y),
  };
}

/**
 * The stair, as drawn. Measured off the tread highlights of
 * `sprites/structure/stairwell.png`, which is one level tall and tiles, so
 * this table repeats with it.
 *
 * The stair is a switchback: a flight down to a landing on the left, a turn,
 * a second flight back down to the right, and this level's floor. Both flights
 * are drawn at 45° — one pixel across per pixel down — so straight lines
 * between these control points land on the treads, and x is exact rather than
 * approximate. Entries are [row within the level, x of the tread at that row].
 *
 * Replaces a triangle wave centred on the column, which crossed the stairs
 * instead of following them: right shape, wrong phase, wrong amplitude.
 */
const STAIR_PATH = [
  [0, 78.5],   // the upper flight, arriving from the level above
  [42, 37],    // its last step, at the left landing
  [47, 40],    // the turn
  [88, 79],    // the lower flight's last step — this level's floor (FLOOR_Y)
  [98, 84.5],  // across the floor to the head of the next flight down
  [LEVEL_HEIGHT, 78.5], // which is row 0 of the level below
];

/**
 * Somebody on the stair at height `y`: where they stand and which way they
 * face. Facing is the direction of the WALK, not of the journey — a switchback
 * reverses twice a level, so somebody on their way down still walks east down
 * the second flight.
 */
export function stairWalk(y, descending) {
  const step = stairAt(y);
  return {
    x: step.x,
    y: descending ? y : y - CLIMB_RISE,
    facing: (descending ? 1 : -1) * (step.slope < 0 ? -1 : 1),
  };
}

/**
 * How much higher somebody climbing stands than somebody descending at the
 * same height. Going up you are on the step you are climbing ONTO; going down
 * you are on the one you have just left, and the two are a tread apart. Rather
 * than model that, the walk simply lifts a climber by the measured difference.
 */
const CLIMB_RISE = 7;

/**
 * Where the stair is at height `y`, and which way it runs there.
 * @returns {{x: number, slope: number}} x in shaft units; slope is dx per row
 *   downwards, so its sign is the direction a descending walker faces.
 */
export function stairAt(y) {
  const row = ((y % LEVEL_HEIGHT) + LEVEL_HEIGHT) % LEVEL_HEIGHT;
  for (let i = 1; i < STAIR_PATH.length; i++) {
    const [row0, x0] = STAIR_PATH[i - 1];
    const [row1, x1] = STAIR_PATH[i];
    if (row <= row1) {
      return { x: lerp(x0, x1, (row - row0) / (row1 - row0)), slope: (x1 - x0) / (row1 - row0) };
    }
  }
  return { x: STAIR_PATH[0][1], slope: 0 };
}

/** Which level a shaft-unit y falls on. */
export function levelAt(y) {
  return Math.floor(y / LEVEL_HEIGHT) + 1;
}

/**
 * Rectangle of a placed building, in shaft units: its sprite's exact size.
 *
 * Each room is pushed right by one SEAM for itself and one for every room to
 * its left on the same level, so neighbours always sit one seam apart however
 * wide they are. The slots themselves stay 64 px, so an n-slot room is exactly
 * n slots wide. `buildings` is every placed instance (state.buildings).
 */
export function roomRect(instance, buildings) {
  const slot = instance.slot ?? 0;
  let roomsLeft = 0;
  for (const b of buildings) {
    if (b.level === instance.level && (b.slot ?? 0) < slot) roomsLeft++;
  }
  return {
    x: BUILD_X + SEAM * (roomsLeft + 1) + slot * SLOT_WIDTH,
    y: levelY(instance.level),
    width: SLOT_WIDTH * (instance.slots ?? 1),
    height: ROOM_HEIGHT,
  };
}

/**
 * Where ambient worker figures stand inside a building's rectangle.
 * Positions are derived from the index, not randomised, so a worker does not
 * teleport between frames and the same building always looks the same.
 */
export function workerSlot(rect, index, count, floorY = FLOOR_Y, seats = null) {
  const margin = 14; // clear of the slanted side walls
  const usable = rect.width - margin * 2;
  const spacing = count <= 1 ? 0 : usable / (count - 1);
  return {
    // A room that names seats puts its people on them instead of spreading
    // them evenly: the auditorium's stools are drawn in the render at fixed
    // columns, and a speaker two pixels off the lectern reads as a mistake.
    // Everywhere else there is nothing to line up with, so the spread stands.
    x: seats?.length
      ? rect.x + seats[index % seats.length]
      : Math.round(rect.x + margin + (count <= 1 ? usable / 2 : index * spacing)),
    // On the room's own floor line (manifest floorY), not floating in it —
    // figures are anchored at the feet, so this is the y their feet sit at.
    y: rect.y + floorY,
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
