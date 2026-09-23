/**
 * Shaft geometry: rooms land on whole sprite pixels, one seam apart, and the
 * default zoom is a whole number (asset-production-spec §1, §2).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roomRect, stairAt, stairWalk, tripPosition, workerSlot,
  SHAFT_WIDTH, SEAM, BUILD_X, LEVEL_HEIGHT, STAIR_WIDTH, FLOOR_Y, levelFloorY, floorX, STAIRHEAD_X,
} from '../../src/ui/view/interpolate.js';
import { createViewport, fitToElement, zoom, viewBoxOf } from '../../src/ui/view/viewport.js';

const room = (instanceId, level, slot, slots) => ({ instanceId, level, slot, slots });

test('neighbouring rooms sit exactly one seam apart, whatever their width', () => {
  const row = [room('a', 3, 0, 2), room('b', 3, 2, 3), room('c', 3, 5, 1), room('d', 4, 0, 1)];
  const [a, b, c, d] = row.map((r) => roomRect(r, row));

  assert.equal(a.x, BUILD_X + SEAM, 'first room one seam from the stairwell');
  assert.equal(b.x, a.x + a.width + SEAM);
  assert.equal(c.x, b.x + b.width + SEAM);
  assert.equal(d.x, BUILD_X + SEAM, 'other levels do not count');
  assert.equal(d.y, LEVEL_HEIGHT * 3);
});

test('a full level of 1-slot rooms fills the shaft exactly', () => {
  const row = Array.from({ length: 10 }, (_, i) => room(`r${i}`, 1, i, 1));
  const last = roomRect(row[9], row);
  assert.equal(last.x + last.width, SHAFT_WIDTH);
});

test('default zoom is the largest whole scale that fits, and zoom steps stay whole', () => {
  const vp = createViewport({ levelCount: 42 });
  fitToElement(vp, { width: 1600, height: 900 });
  assert.equal(vp.scale, 2);
  assert.equal(vp.viewWidth, 800);

  zoom(vp, 1);
  assert.equal(vp.scale, 3);
  const [x, y] = viewBoxOf(vp).split(' ').map(Number);
  assert.ok(Number.isInteger(x) && Number.isInteger(y), 'viewBox origin on whole pixels');
});

test('a host narrower than the shaft fits its width rather than cropping', () => {
  const vp = createViewport({ levelCount: 42 });
  fitToElement(vp, { width: 500, height: 700 });
  assert.equal(vp.viewWidth, SHAFT_WIDTH);
});

/* ---- The stair (asset-production-spec §2.6 is the foreground; this is the walk) ---- */

test('the stair path repeats with the tile and never leaves the stairwell', () => {
  for (let y = 0; y < LEVEL_HEIGHT * 3; y += 0.5) {
    const here = stairAt(y);
    assert.ok(here.x > 8 && here.x < STAIR_WIDTH - 8, `x ${here.x} at y ${y} is outside the stairwell`);
    assert.ok(
      Math.abs(here.x - stairAt(y + LEVEL_HEIGHT).x) < 1e-9,
      `y ${y} and the level below it are not at the same point of the stair`,
    );
  }
});

test('the stair is continuous: no step sideways between one row and the next', () => {
  for (let y = 0; y < LEVEL_HEIGHT; y += 0.25) {
    const jump = Math.abs(stairAt(y + 0.25).x - stairAt(y).x);
    assert.ok(jump < 1.5, `the path jumps ${jump.toFixed(1)} px at y ${y}`);
  }
});

test('a walker turns round at the landing rather than at the ends of the trip', () => {
  const trip = { method: 'stairwell', fromLevel: 3, toLevel: 4, startTick: 0, arriveTick: 10 };
  const facings = [];
  for (let t = 0; t <= 10; t += 0.25) {
    const pos = tripPosition(trip, t, 0);
    if (facings.at(-1) !== pos.facing) facings.push(pos.facing);
  }
  assert.ok(facings.length >= 3, 'one flight down, a turn, and a flight back: the walk reverses twice');

  // The same rows walked the other way face the other way.
  const y = levelFloorY(3) + 20;
  assert.equal(stairWalk(y, true).facing, -stairWalk(y, false).facing);
});

test('a walker arriving on a level is on that level\'s floor row', () => {
  const trip = { method: 'stairwell', fromLevel: 5, toLevel: 6, startTick: 0, arriveTick: 4 };
  const end = tripPosition(trip, 4, 0);
  assert.equal(end.y, levelFloorY(6));
  assert.equal(end.y % LEVEL_HEIGHT, FLOOR_Y);
});

test('a room that names seats stands its people on them, and everything else spreads', () => {
  const rect = { x: 130, y: 0, width: 384, height: 96 };
  const seats = [355, 40, 74];

  // Seat 0 is the lectern: the speaker is on it exactly, not near it.
  assert.equal(workerSlot(rect, 0, 3, 93, seats).x, rect.x + 355);
  assert.equal(workerSlot(rect, 1, 3, 93, seats).x, rect.x + 40);
  // More people than seats fill the room again rather than falling off the end.
  assert.equal(workerSlot(rect, 4, 5, 93, seats).x, rect.x + 40);
  // The seat table does not move anybody vertically.
  assert.equal(workerSlot(rect, 0, 3, 93, seats).y, rect.y + 93);

  // A room without one is untouched: two people, one at each end of the span.
  const spread = [0, 1].map((i) => workerSlot(rect, i, 2, 93).x);
  assert.deepEqual(spread, [rect.x + 14, rect.x + rect.width - 14]);
});

test('a porter walks the floor to the stairhead, takes the stair, and walks the floor to the room', () => {
  const trip = {
    method: 'stairwell', fromLevel: 3, toLevel: 5, startTick: 0, arriveTick: 6,
    legs: [
      { kind: 'floor', level: 3, from: 2.5, to: 0, fromId: 'a', toId: null, ticks: 1 },
      { kind: 'stair', from: 3, to: 5, ticks: 2 },
      { kind: 'floor', level: 5, from: 0, to: 4, fromId: null, toId: 'b', ticks: 1.5 },
    ],
  };
  const xOf = (id, pos) => (id === 'a' ? 300 : id === 'b' ? 420 : floorX(pos));

  const start = tripPosition(trip, 0, 0, xOf);
  assert.equal(start.onFloor, true);
  assert.equal(start.x, 300);
  assert.equal(start.y, levelFloorY(3));
  assert.equal(start.facing, -1, 'walking back to the stairs');

  // The legs meet: stepping off the floor onto the stair, and off the stair
  // onto the next floor, happens at the stairhead.
  const span = 4.5;
  const offFloor = tripPosition(trip, (1 / span) * 6 - 1e-6, 0, xOf);
  assert.ok(Math.abs(offFloor.x - STAIRHEAD_X) < 0.1);
  const onStair = tripPosition(trip, (1 / span) * 6 + 1e-6, 0, xOf);
  assert.equal(onStair.onFloor, false);
  assert.ok(Math.abs(onStair.x - STAIRHEAD_X) < 0.5, 'the stair starts where the floor walk ended');

  const end = tripPosition(trip, 6, 0, xOf);
  assert.equal(end.x, 420, 'arrives at the room');
  assert.equal(end.y, levelFloorY(5));
  assert.equal(end.facing, 1);
});
