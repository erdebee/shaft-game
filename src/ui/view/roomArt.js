/**
 * roomArt.js
 * The pixel-art side of the shaft: which image draws which building in which
 * state, the seams between rooms, and the light flicker.
 *
 * Everything comes from resources/assets/manifest.json, so a new render is
 * wired in by listing it there — this file names no building.
 *
 *   <id>-on / -off / -broken   one full render per state (spec §2.3)
 *   <id>-on-anim               optional strip of frames played while on
 *   <id>-dim                   optional darker "on" the flicker dips to
 *   <id>-<state>-fg            optional cut of the parts of that render a
 *                              person stands behind, drawn over the figures
 *
 * Presentation only. Nothing here reads or writes simulation state, and the
 * flicker draws from visualJitter rather than an RNG stream, for the same
 * reason interpolate.js gives: decoration must never shift the economy.
 */

import { ROOM_HEIGHT, SEAM, visualJitter } from './interpolate.js';

const ASSET_ROOT = './resources/assets/';

/**
 * Fetch the media manifest and the floor-digit font, and index the room art by
 * building id. Buildings without an `-on` render are simply absent, and the
 * view falls back to the vector sheet for them.
 */
export async function loadRoomArt(manifestPath = `${ASSET_ROOT}manifest.json`) {
  const res = await fetch(manifestPath, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Asset manifest not found: ${manifestPath}`);
  const manifest = await res.json();

  const byId = new Map(manifest.sprites.map((s) => [s.id, s]));
  const href = (entry) => entry && ASSET_ROOT + entry.path;

  const rooms = new Map();
  for (const entry of manifest.sprites) {
    const match = /^(.+)-on$/.exec(entry.id);
    if (!match) continue;
    const id = match[1];
    const anim = byId.get(`${id}-on-anim`);
    rooms.set(id, {
      on: href(entry),
      off: href(byId.get(`${id}-off`)) ?? href(entry),
      broken: href(byId.get(`${id}-broken`)) ?? href(entry),
      dim: href(byId.get(`${id}-dim`)),
      anim: anim ? { href: href(anim), ...anim.animation } : null,
      fg: foreground(byId, id),
      floorY: entry.floorY,
      seats: entry.seats ?? null,
    });
  }

  const stair = byId.get('stairwell');
  const stairFg = byId.get('stairwell-fg');
  const fontEntry = manifest.fonts.find((f) => f.id === 'floor-digits-4x6');
  const font = fontEntry ? await (await fetch(ASSET_ROOT + fontEntry.path)).json() : null;

  // Figures: one entry per role, each clip a strip of square cells with the
  // measurements the renderer needs to stand it on a floor (§4.2).
  const figures = new Map();
  for (const role of manifest.figures?.roles ?? []) {
    const clips = {};
    for (const [kind, clip] of Object.entries(role.clips)) {
      clips[kind] = { ...clip, href: ASSET_ROOT + clip.path };
    }
    figures.set(role.role, clips);
  }

  return {
    rooms,
    figures,
    stairwell: stair
      ? { href: href(stair), fg: href(stairFg), signPlate: stair.signPlate, ...stair.tile }
      : null,
    rock: (band) => href(byId.get(`${band}-rock`)),
    font,
  };
}

/**
 * The foreground cut of each of a room's states, or null if it has none. The
 * cut is a copy of pixels the render still contains, so a room without one
 * simply draws nothing over its figures (tools/cutForeground.mjs).
 */
function foreground(byId, id) {
  const states = {};
  for (const state of ['on', 'off', 'broken', 'dim']) {
    const entry = byId.get(`${id}-${state}-fg`);
    if (entry) states[state] = ASSET_ROOT + entry.path;
  }
  return states.on ? states : null;
}

/** Which render a building shows right now. Broken outranks unpowered. */
export function roomState(instance) {
  if (instance.brokenDown === true) return 'broken';
  if (instance.powered === false) return 'off';
  return 'on';
}

// ---- Seams -----------------------------------------------------------------

const edgeCache = new Map();

/**
 * One column of an image as ROOM_HEIGHT [r, g, b] triples, cached per image and
 * column. Resolves to null if the image cannot be read.
 */
export function imageEdge(src, column) {
  const key = `${src}#${column}`;
  if (!edgeCache.has(key)) {
    edgeCache.set(key, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const x = column < 0 ? img.width + column : column;
        const c = document.createElement('canvas');
        c.width = 1;
        c.height = ROOM_HEIGHT;
        const g = c.getContext('2d');
        g.drawImage(img, x, 0, 1, ROOM_HEIGHT, 0, 0, 1, ROOM_HEIGHT);
        const d = g.getImageData(0, 0, 1, ROOM_HEIGHT).data;
        resolve(Array.from({ length: ROOM_HEIGHT }, (_, k) => [d[k * 4], d[k * 4 + 1], d[k * 4 + 2]]));
      };
      img.onerror = () => resolve(null);
      img.src = src;
    }));
  }
  return edgeCache.get(key);
}

const seamCache = new Map();

/**
 * A SEAM-wide image that dissolves one room into the next: each pixel takes
 * the neighbouring edge colour, darkened towards a shadow core between them,
 * with checkerboard dither on the outer columns. `x` sets the dither phase so
 * the checkerboard stays on the shaft's pixel grid. Returns a data URL.
 */
export function seamImage(left, right, x) {
  const key = `${x & 1}|${left}|${right}`;
  if (seamCache.has(key)) return seamCache.get(key);

  const c = document.createElement('canvas');
  c.width = SEAM;
  c.height = ROOM_HEIGHT;
  const g = c.getContext('2d');
  const out = g.createImageData(SEAM, ROOM_HEIGHT);

  for (let y = 0; y < ROOM_HEIGHT; y++) {
    const L = left[y];
    const R = right[y];
    const core = L.map((v, k) => (v + R[k]) * 0.2);
    for (let col = 0; col < SEAM; col++) {
      const t = (col + 0.5) / SEAM;
      const edge = Math.abs(t - 0.5) * 2; // 0 at the centre, ~1 at the edges
      const lit = (t < 0.5 ? L : R).map((v) => v * 0.62);
      const useLit = edge > 0.6 || (edge > 0.2 && ((x + col + y) & 1) === 0);
      const px = useLit ? lit : core;
      const o = (y * SEAM + col) * 4;
      out.data[o] = px[0];
      out.data[o + 1] = px[1];
      out.data[o + 2] = px[2];
      out.data[o + 3] = 255;
    }
  }

  g.putImageData(out, 0, 0);
  const url = c.toDataURL();
  seamCache.set(key, url);
  return url;
}

// ---- Flicker ---------------------------------------------------------------

/** Quiet time between flickers, and the shape of one flicker (ms). */
const QUIET_MS = [15000, 60000];
const FIRST_MS = [2000, 60000];
const DIPS = [1, 3];
const DIP_MS = [40, 120];
const GAP_MS = [40, 160];

const between = ([lo, hi], u) => lo + u * (hi - lo);

/**
 * Whether a room's lights are dipped at ambient time `t` (ms). Each room runs
 * its own schedule: a quiet spell, then one to three short dips. Deterministic
 * per instance, so a room flickers the same way every time the scene plays.
 */
export function createFlicker(key) {
  let n = 0;
  let next = between(FIRST_MS, visualJitter(`${key}:first`));
  let dips = [];

  return function isDim(t) {
    if (t >= next) {
      const u = (k) => visualJitter(`${key}:${n}:${k}`);
      dips = [];
      let at = t;
      const count = Math.floor(between([DIPS[0], DIPS[1] + 1 - 1e-9], u('n')));
      for (let i = 0; i < count; i++) {
        const len = between(DIP_MS, u(`len${i}`));
        dips.push([at, at + len]);
        at += len + between(GAP_MS, u(`gap${i}`));
      }
      next = at + between(QUIET_MS, u('quiet'));
      n++;
    }
    return dips.some(([a, b]) => t >= a && t < b);
  };
}
