/**
 * glitchScreen.mjs
 * Corrupt the picture on a broken room's screen.
 *
 * The auditorium's back wall is a screen, not a window (spec §5 bans saying so
 * in a prompt, which is why it is generated as a painted viewing panel). A
 * broken screen should not just be cracked glass over a perfect picture — the
 * picture itself should be coming apart.
 *
 *   node tools/glitchScreen.mjs [room ...]
 *
 * Computed, not generated, for the same reason the dim frames are (§2.5): every
 * colour it writes is a colour already inside the screen rectangle, so the
 * render's palette and dithering survive exactly, and a seed makes it
 * repeatable. Asking a generator for "a distorted image" gets a redrawn room.
 *
 * Idempotent by construction: it always reads the screen out of
 * `<id>-<state>-clean.png`, the render as it came back from the generator, and
 * writes only the screen rectangle into `<id>-<state>.png`. Running it twice
 * cannot glitch an already-glitched picture, and it leaves the rest of that
 * file — including anything placeProps.mjs stamped into it — untouched.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from './png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(ROOT, 'resources/assets');

/**
 * `rect` is the picture INSIDE the frame — measured off the render, and kept
 * clear of the frame's rivets so a torn band cannot slide the frame sideways.
 */
const SCREENS = {
  auditorium: {
    from: 'sprites/buildings/auditorium-broken-clean.png',
    into: 'sprites/buildings/auditorium-broken.png',
    rect: [59, 20, 274, 58],
    seed: 2807,
  },
};

/** Deterministic PRNG. Not the simulation's — this is decoration (§7). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Tear the picture into horizontal bands and damage each one.
 *
 * Five failure modes, in the proportions a dying display actually shows them:
 * most bands are fine, a quarter slip sideways, and the rest drop out, come
 * back in the wrong colours, or repeat a band from somewhere else. Everything
 * wraps inside the rectangle, so no pixel escapes onto the frame.
 *
 * The proportions matter more than the effect. Corrupt much past this and the
 * landscape stops being recognisable, so the panel reads as noise rather than
 * as THIS picture coming apart — which is the only version that tells a player
 * the screen is broken rather than off.
 */
function glitch(src, [x0, y0, w, h], seed) {
  const random = rng(seed);
  const at = (img, x, y) => ((y * img.width + x) * 4);

  // The screen's own colours, darkest first: a dropout band and a colour tear
  // pick from these, so the corruption cannot introduce a new colour.
  const palette = [];
  const seen = new Set();
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const o = at(src, x, y);
      const key = (src.pixels[o] << 16) | (src.pixels[o + 1] << 8) | src.pixels[o + 2];
      if (seen.has(key)) continue;
      seen.add(key);
      palette.push([src.pixels[o], src.pixels[o + 1], src.pixels[o + 2]]);
    }
  }
  palette.sort((p, q) => lum(...p) - lum(...q));
  const rank = new Map(palette.map((c, i) => [(c[0] << 16) | (c[1] << 8) | c[2], i]));

  const out = Buffer.from(src.pixels);
  const put = (x, y, rgb) => {
    const o = at(src, x, y);
    out[o] = rgb[0];
    out[o + 1] = rgb[1];
    out[o + 2] = rgb[2];
    out[o + 3] = 255;
  };
  const read = (x, y) => {
    const o = at(src, x0 + (((x - x0) % w) + w) % w, y);
    return [src.pixels[o], src.pixels[o + 1], src.pixels[o + 2]];
  };

  for (let y = y0; y < y0 + h; ) {
    const band = 1 + Math.floor(random() * 4);
    const roll = random();
    const shift = (2 + Math.floor(random() * 9)) * (random() < 0.5 ? -1 : 1);
    const turn = 1 + Math.floor(random() * 5);
    const from = y0 + Math.floor(random() * h);
    const flat = palette[Math.floor(random() * 3)]; // one of the three darkest

    for (let dy = 0; dy < band && y + dy < y0 + h; dy++) {
      const Y = y + dy;
      for (let x = x0; x < x0 + w; x++) {
        if (roll < 0.56) continue;                         // intact
        if (roll < 0.81) put(x, Y, read(x + shift, Y));    // slipped sideways
        else if (roll < 0.90) put(x, Y, flat);             // dropped out
        else if (roll < 0.96) {                            // wrong colours
          const c = read(x, Y);
          const i = rank.get((c[0] << 16) | (c[1] << 8) | c[2]) ?? 0;
          put(x, Y, palette[(i + turn) % palette.length]);
        } else put(x, Y, read(x + shift, Math.min(y0 + h - 1, from + dy))); // repeat
      }
    }
    y += band;
  }

  // Two blown scanlines: the brightest colour the screen has, full width. They
  // are what makes the panel read as a display rather than as torn paper. Kept
  // well apart, or they merge into one bright bar across the middle.
  const lines = [y0 + 3 + Math.floor(random() * (h / 3)), y0 + h - 4 - Math.floor(random() * (h / 3))];
  for (const Y of lines) {
    const hot = palette[palette.length - 1 - Math.floor(random() * 2)];
    for (let x = x0; x < x0 + w; x++) if (random() < 0.78) put(x, Y, hot);
  }

  return out;
}

function run(room) {
  const spec = SCREENS[room];
  if (!spec) throw new Error(`No screen named "${room}"`);

  const src = decode(readFileSync(resolve(ASSETS, spec.from)));
  const dst = decode(readFileSync(resolve(ASSETS, spec.into)));
  const torn = glitch(src, spec.rect, spec.seed);

  // Only the screen rectangle is copied over, so props and everything else the
  // destination already had survive.
  const [x0, y0, w, h] = spec.rect;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const o = (y * src.width + x) * 4;
      torn.copy(dst.pixels, o, o, o + 4);
    }
  }
  writeFileSync(resolve(ASSETS, spec.into), encode(dst.width, dst.height, dst.pixels));
  console.log(`${spec.into}  screen ${w}x${h} at ${x0},${y0} torn (seed ${spec.seed})`);
}

const rooms = process.argv.slice(2);
for (const room of rooms.length ? rooms : Object.keys(SCREENS)) run(room);
