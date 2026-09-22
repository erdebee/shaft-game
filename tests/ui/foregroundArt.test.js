/**
 * Foreground cuts: the parts of a room render that draw over the figures
 * (asset-production-spec §2.6).
 *
 * The invariant worth testing is that a cut is a COPY, never a repaint. Every
 * pixel it shows has to be the pixel the room render already has in that spot,
 * so an empty room looks the same with the cut as without it. A re-cut that
 * drifts by a pixel, or a foreground built from the wrong state's render,
 * fails here rather than in front of somebody's eyes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '../../tools/png.mjs';

const asset = (path) => new URL(`../../resources/assets/${path}`, import.meta.url);
const manifest = JSON.parse(readFileSync(asset('manifest.json'), 'utf8'));

const byId = new Map(manifest.sprites.map((s) => [s.id, s]));
const cuts = manifest.sprites.filter((s) => s.foregroundOf);

test('the manifest has a foreground for each room that needs one', () => {
  const rooms = new Set(cuts.map((c) => c.foregroundOf.replace(/-(on|off|broken|dim)$/, '')));
  assert.deepEqual([...rooms].sort(), ['auditorium', 'canteen', 'holding-cells', 'school', 'shaft-exit', 'stairwell']);
});

test('every foreground names a render that exists, and is named after it', () => {
  for (const cut of cuts) {
    assert.ok(byId.has(cut.foregroundOf), `${cut.id} points at "${cut.foregroundOf}", which is not listed`);
    assert.equal(cut.id, `${cut.foregroundOf}-fg`, 'a foreground is its render\'s id plus -fg');
  }
});

test('a foreground is a copy of its render: same size, same pixels, fewer of them', () => {
  for (const cut of cuts) {
    const fg = decode(readFileSync(asset(cut.path)));
    const src = decode(readFileSync(asset(byId.get(cut.foregroundOf).path)));

    assert.equal(fg.width, src.width, `${cut.id}: width`);
    assert.equal(fg.height, src.height, `${cut.id}: height`);

    let kept = 0;
    for (let i = 0; i < fg.width * fg.height; i++) {
      const o = i * 4;
      if (fg.pixels[o + 3] === 0) continue;
      kept++;
      const same = fg.pixels[o] === src.pixels[o]
        && fg.pixels[o + 1] === src.pixels[o + 1]
        && fg.pixels[o + 2] === src.pixels[o + 2]
        && src.pixels[o + 3] !== 0;
      assert.ok(same, `${cut.id}: pixel ${i % fg.width},${Math.floor(i / fg.width)} is not what the render has there`);
    }

    // A cut that kept everything would hide the room; one that kept nothing
    // would be a silently broken recipe.
    const total = fg.width * fg.height;
    assert.ok(kept > 100, `${cut.id}: only ${kept} pixels — the cut found nothing`);
    assert.ok(kept < total / 3, `${cut.id}: ${kept} of ${total} pixels — the cut is taking the room with it`);
  }
});

test('the states of one room cut the same shape', () => {
  const shapes = new Map();
  for (const cut of cuts) {
    const room = cut.foregroundOf.replace(/-(on|off|broken|dim)$/, '');
    const { width, height, pixels } = decode(readFileSync(asset(cut.path)));
    const mask = [];
    for (let i = 0; i < width * height; i++) if (pixels[i * 4 + 3] !== 0) mask.push(i);
    const key = mask.join(',');
    if (!shapes.has(room)) shapes.set(room, { id: cut.id, key });
    else assert.equal(key, shapes.get(room).key, `${cut.id} cuts a different shape from ${shapes.get(room).id}`);
  }
});
