/**
 * crew.js
 * Where the people in a room stand, what they are doing, and which way they
 * face — as pure functions of the room, the figure's key and sim time, so
 * figures.js can ask every frame and nothing is stored (view principle 9).
 *
 * Three kinds of people are drawn in a room:
 *
 *   crew      the staff. Each works in a lane of the room and, every so often,
 *             walks to another spot in it (wander below). A room can pin its
 *             first people to POSTS instead: the teacher at the blackboard,
 *             the speaker at the lectern, the medic at the bed.
 *   pupils    children at the school desks, while the school is running.
 *   audience  residents on the auditorium stools, seen from behind, while a
 *             session is on.
 *
 * The room staging (posts, work clip per role, desks and stools) is data in
 * the manifest's `figures.rooms`, because it lines up with pixels in a render
 * and moves when the render does.
 */

import { visualJitter } from './interpolate.js';

/**
 * visualJitter with a final mix. FNV-1a alone barely moves when only the last
 * character of the key changes, and every key here ends in a counter (spot 3,
 * spot 4, seat 5), so without the mix consecutive spots land side by side and
 * a hall fills from one end. Same inputs, same outputs: still decoration only.
 */
function jitter(key) {
  let h = Math.floor(visualJitter(key) * 0xffffff) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2d) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** Clear of the slanted side walls. */
export const WALL_MARGIN = 14;

/**
 * How long a worker works between walks, in sim seconds (one tick is one
 * second at normal speed). Hashed per worker inside this range, so a room of
 * three never sets off together.
 */
const SPELL_MIN = 22;
const SPELL_MAX = 44;

/** Walking pace, px per sim second: about what the walk strip's stride covers. */
export const WALK_SPEED = 16;

/**
 * The stretch of floor worker `index` of `count` keeps to: the room's usable
 * width cut into equal lanes. Keeping each person in a lane means two workers
 * never walk into one body, and a lone worker has the whole room.
 */
export function laneOf(rect, index, count) {
  const usable = Math.max(0, rect.width - WALL_MARGIN * 2);
  const width = usable / Math.max(1, count);
  const from = rect.x + WALL_MARGIN + index * width;
  return { from, to: from + width };
}

/**
 * Where a wandering worker is at sim time `t` (seconds) and what they are
 * doing. Time is cut into spells of one hashed length; spell k is spent
 * working at spot k and ends with the walk to spot k+1. Every spot is a hash
 * of (key, k), so any moment can be answered without knowing the last one.
 *
 *   { x, walking, facing }   facing 1 = east, -1 = west
 */
export function wanderAt(key, lane, t) {
  const spell = SPELL_MIN + jitter(`${key}:spell`) * (SPELL_MAX - SPELL_MIN);
  const shifted = t + jitter(`${key}:offset`) * spell;
  const k = Math.floor(shifted / spell);
  const into = shifted - k * spell;

  const spot = (n) => lane.from + jitter(`${key}:spot:${n}`) * (lane.to - lane.from);
  const here = spot(k);
  const next = spot(k + 1);
  const walkFor = Math.abs(next - here) / WALK_SPEED;
  const walkFrom = spell - walkFor;

  if (into < walkFrom || walkFor === 0) {
    return { x: here, walking: false, facing: jitter(`${key}:face:${k}`) < 0.5 ? -1 : 1 };
  }
  const p = (into - walkFrom) / walkFor;
  return { x: here + (next - here) * p, walking: true, facing: next >= here ? 1 : -1 };
}

/**
 * Which clip a role plays at work in a given room: the room's own choice for
 * that role (the miner shovels at the smelter rather than swinging a pickaxe),
 * else the role's `work`, else its idle.
 */
export function workClip(clips, stage, role) {
  const named = stage?.clips?.[role];
  return (named && clips[named]) ?? clips.work ?? clips.idle ?? clips.still;
}

/**
 * The first `count` of a row of places, in an order hashed from the room: a
 * half-full hall has people scattered along it rather than packed at one end,
 * and as the count grows the people already seated stay where they are.
 */
export function fillOrder(key, places, count) {
  return places
    .map((x, i) => ({ x, i, r: jitter(`${key}:${i}`) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, Math.max(0, Math.min(count, places.length)))
    .sort((a, b) => a.i - b.i);
}

/**
 * How many of the auditorium's stools are taken: its seats times the share of
 * working-age people with no shift to work (population.labour). Full
 * employment leaves the hall to the speaker; idle hands fill it.
 */
export function audienceSize(seats, labour) {
  const pool = labour?.pool ?? 0;
  if (seats <= 0 || pool <= 0) return 0;
  const idle = Math.max(0, pool - (labour.assigned ?? 0)) / pool;
  return Math.min(seats, Math.round(seats * idle));
}

/** Children at the desks: every desk while there are children to fill them. */
export function pupilCount(desks, children) {
  return Math.min(desks, Math.max(0, Math.floor(children ?? 0)));
}
