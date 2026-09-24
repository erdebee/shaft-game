/**
 * Crew: where the people in a room stand and what they are doing (crew.js),
 * and the room staging in the manifest that it reads (figures.rooms).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  laneOf, wanderAt, workClip, fillOrder, audienceSize, pupilCount, WALL_MARGIN, WALK_SPEED,
} from '../../src/ui/view/crew.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const manifest = read('resources/assets/manifest.json');
const roles = new Map(manifest.figures.roles.map((r) => [r.role, r]));

test('lanes split the usable floor evenly and a lone worker has all of it', () => {
  const rect = { x: 100, y: 0, width: 128, height: 96 };
  assert.deepEqual(laneOf(rect, 0, 1), { from: 100 + WALL_MARGIN, to: 228 - WALL_MARGIN });
  const lanes = [0, 1, 2].map((i) => laneOf(rect, i, 3));
  assert.equal(lanes[0].to, lanes[1].from);
  assert.ok(Math.abs(lanes[2].to - (228 - WALL_MARGIN)) < 1e-9);
});

test('a wandering worker mostly works, sometimes walks, and never leaves the lane', () => {
  const lane = { from: 40, to: 140 };
  let walking = 0;
  let last = null;
  for (let t = 0; t < 2000; t += 0.25) {
    const at = wanderAt('room-7:0', lane, t);
    assert.ok(at.x >= lane.from && at.x <= lane.to, `x ${at.x} at t ${t}`);
    // Continuous: a quarter second never moves anyone further than a walk would.
    if (last) assert.ok(Math.abs(at.x - last.x) <= WALK_SPEED * 0.25 + 1e-9, `jump at t ${t}`);
    if (at.walking) {
      walking++;
      if (last?.walking) assert.equal(Math.sign(at.x - last.x) || at.facing, at.facing, 'faces the way it walks');
    }
    last = at;
  }
  const share = walking / 8000;
  assert.ok(share > 0.02 && share < 0.35, `walks ${Math.round(share * 100)}% of the time`);
});

test('two workers in one room do not walk in step', () => {
  const lane = { from: 0, to: 100 };
  const a = [];
  const b = [];
  for (let t = 0; t < 600; t += 1) {
    a.push(wanderAt('r:0', lane, t).walking);
    b.push(wanderAt('r:1', lane, t).walking);
  }
  assert.notDeepEqual(a, b);
});

test('a room can pick the loop a role works with, and falls back to the role\'s own', () => {
  const clips = { work: 'swing', shovel: 'shovel', idle: 'idle', still: 'still' };
  assert.equal(workClip(clips, { clips: { miner: 'shovel' } }, 'miner'), 'shovel');
  assert.equal(workClip(clips, { clips: { miner: 'nope' } }, 'miner'), 'swing');
  assert.equal(workClip(clips, null, 'miner'), 'swing');
  assert.equal(workClip({ idle: 'idle', still: 'still' }, null, 'resident'), 'idle');
});

test('seats fill scattered, and people already seated stay put as the hall fills', () => {
  const seats = [10, 20, 30, 40, 50, 60, 70, 80];
  const three = fillOrder('hall', seats, 3).map((s) => s.x);
  const five = fillOrder('hall', seats, 5).map((s) => s.x);
  assert.equal(three.length, 3);
  for (const x of three) assert.ok(five.includes(x));
  assert.equal(fillOrder('hall', seats, 99).length, seats.length);
  assert.notDeepEqual(three, [10, 20, 30], 'not packed at one end');
});

test('the audience is the idle share of the labour pool, and pupils fill the desks', () => {
  assert.equal(audienceSize(14, { pool: 100, assigned: 100 }), 0);
  assert.equal(audienceSize(14, { pool: 100, assigned: 50 }), 7);
  assert.equal(audienceSize(14, { pool: 100, assigned: 0 }), 14);
  assert.equal(audienceSize(14, { pool: 0, assigned: 0 }), 0);
  assert.equal(pupilCount(3, 432), 3);
  assert.equal(pupilCount(3, 1), 1);
  assert.equal(pupilCount(3, 0), 0);
});

test('every room staging names clips and roles the manifest has, inside the room', () => {
  const sprites = new Map(manifest.sprites.map((s) => [s.id, s]));
  for (const [room, stage] of Object.entries(manifest.figures.rooms)) {
    if (room.startsWith('_')) continue;
    const width = sprites.get(`${room}-on`) && readPngWidth(sprites.get(`${room}-on`).path);
    assert.ok(width, `${room}: no -on render to stage against`);

    for (const [role, clip] of Object.entries(stage.clips ?? {})) {
      assert.ok(roles.get(role)?.clips[clip], `${room}: ${role} has no "${clip}" clip`);
    }
    for (const post of stage.posts ?? []) {
      assert.ok(post.x > 0 && post.x < width, `${room}: post at ${post.x} is outside the room`);
      if (post.role) assert.ok(roles.get(post.role)?.clips[post.clip ?? 'still'], `${room}: post ${post.role}/${post.clip}`);
    }
    for (const group of [stage.pupils, stage.audience].filter(Boolean)) {
      for (const role of group.roles ?? [group.role]) {
        assert.ok(roles.get(role)?.clips[group.clip], `${room}: ${role} has no "${group.clip}" clip`);
      }
      for (const x of group.at) assert.ok(x > 0 && x < width, `${room}: seat at ${x} is outside the room`);
    }
  }
});

/** A PNG's width, from its IHDR chunk. */
function readPngWidth(path) {
  const buf = readFileSync(new URL(`../../resources/assets/${path}`, import.meta.url));
  return buf.readUInt32BE(16);
}
