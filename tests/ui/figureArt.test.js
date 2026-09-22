/**
 * Figures: every staffed room can put somebody in it, and every figure the
 * manifest lists carries the measurements the renderer stands it on
 * (asset-production-spec §4.2).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { rolesForBuilding } from '../../src/ui/view/figures.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));

const manifest = read('resources/assets/manifest.json');
const jobs = read('resources/data/catalog/population/jobs.json').jobs;
const buildings = readdirSync(new URL('../../resources/data/catalog/buildings', import.meta.url))
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => read(`resources/data/catalog/buildings/${f}`).buildings);

const ctx = { catalog: { jobs: { all: jobs } } };
const roles = new Map(manifest.figures.roles.map((r) => [r.role, r]));

test('every staffed building resolves to roles that have a figure', () => {
  const staffed = buildings.filter((b) => (b.staffing ?? 0) > 0);
  assert.ok(staffed.length > 20, 'the catalogue still has staffed buildings');

  for (const def of staffed) {
    for (const role of rolesForBuilding(def, ctx)) {
      assert.ok(roles.has(role), `${def.id} wants a "${role}" figure, which the manifest does not list`);
    }
  }
});

test('every job in the catalogue has a figure of its own', () => {
  for (const job of jobs) {
    assert.ok(roles.has(job.id), `no figure for the job "${job.id}"`);
  }
});

test('every figure clip is a strip of square frames with a foot row and a centre', () => {
  for (const role of manifest.figures.roles) {
    assert.ok(role.clips.still, `${role.role} has no still`);

    for (const [kind, clip] of Object.entries(role.clips)) {
      const where = `${role.role}/${kind}`;
      assert.ok(existsSync(new URL(`../../resources/assets/${clip.path}`, import.meta.url)), `${where}: missing ${clip.path}`);
      assert.equal(clip.w, clip.h, `${where}: frames are square`);
      assert.ok(clip.feet > 0 && clip.feet <= clip.h, `${where}: foot row inside the frame`);
      assert.ok(clip.cx >= 0 && clip.cx <= clip.w, `${where}: centre column inside the frame`);
      assert.ok(clip.frames >= 1, `${where}: at least one frame`);
      if (clip.frames > 1) assert.ok(clip.frameMs > 0, `${where}: an animated clip needs a frame time`);
      else assert.equal(kind, 'still', `${where}: only the still is a single frame`);
    }
  }
});

test('adults share one scale and children are smaller', () => {
  for (const role of manifest.figures.roles) {
    const height = role.clips.still.height;
    const [lo, hi] = role.role === 'child' ? [22, 32] : [34, 40];
    assert.ok(height >= lo && height <= hi, `${role.role} is ${height} px, outside ${lo}–${hi}`);
  }
});
