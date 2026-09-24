/**
 * conduitTiles.mjs
 * The ducts and pipes the player lays, generated rather than drawn — for the
 * same reason as the rock (tools/rockTile.mjs): a run of duct is a repeating
 * texture, not an illustration, and it has to tile seamlessly along its
 * length, which is exactly what an image model will not guarantee.
 *
 * Every pixel is a colour from the DEEP sprite palette (tokens.css
 * --sprite-core + --sprite-deep): the networks are the Works' plumbing, and
 * rust is only in that band's palette.
 *
 *   duct-v / duct-h / duct-joint    the foul-air ducts: riveted sheet iron,
 *                                   gone to rust, flanged every 32 px
 *   fresh-duct-v / -h / -joint      the fresh-air ducts: the same, newer and
 *                                   galvanised, only spotted with rust
 *   sewer-v / sewer-h / sewer-joint the drains: cast iron, red-oxide collars
 *                                   bolted every 32 px, stained below each
 *   main-v / main-h / main-joint    the water mains: galvanised pipe, steel
 *                                   collars
 *
 * A `-v` tile runs down the page and repeats vertically; its `-h` twin is the
 * same tile turned, so the light still falls from the top-left. A `-joint`
 * covers the corner where a run turns, and the ends.
 *
 *   node tools/conduitTiles.mjs [seed]
 *
 * Writes resources/assets/sprites/structure/<id>.png.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSpritePalette } from './palettePng.mjs';
import { encode } from './png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'resources/assets/sprites/structure');

const palette = new Map(readSpritePalette('deep').map((c) => [c.name, c.rgb]));
const C = (name) => {
  const rgb = palette.get(name);
  if (!rgb) throw new Error(`--${name} is not in the deep sprite palette (see tokens.css)`);
  return rgb;
};

/** Deterministic PRNG. No Math.random anywhere in this project. */
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise that wraps on both axes, so a tile repeats with no seam. */
function noise(cellsX, cellsY, rand) {
  const lattice = Array.from({ length: cellsX * cellsY }, rand);
  const at = (ix, iy) => lattice[(((iy % cellsY) + cellsY) % cellsY) * cellsX + (((ix % cellsX) + cellsX) % cellsX)];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * cellsX;
    const y = v * cellsY;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bot * fy;
  };
}

/** A canvas of palette colours; null is transparent. */
function canvas(w, h) {
  const px = Array.from({ length: h }, () => new Array(w).fill(null));
  return {
    w, h, px,
    set(x, y, c) { if (x >= 0 && y >= 0 && x < w && y < h) px[y][x] = c; },
    get(x, y) { return px[y]?.[x] ?? null; },
  };
}

/** A round-headed rivet or bolt: lit top-left, shadowed bottom-right. */
function rivet(cv, x, y, lit = 'steel-bright', mid = 'steel-pale', dark = 'steel-dark') {
  cv.set(x, y, C(lit));
  cv.set(x + 1, y, C(mid));
  cv.set(x, y + 1, C(mid));
  cv.set(x + 1, y + 1, C(dark));
  cv.set(x + 2, y + 1, C('rock'));
  cv.set(x + 1, y + 2, C('rock'));
}

// --- air duct -------------------------------------------------------------

const DUCT_W = 24;
const DUCT_L = 32;

/**
 * The fresh-air line's duct is newer, galvanised sheet: a shade paler, and
 * only spotted with rust where the foul line is eaten through. `clean` lifts
 * every rust threshold by this much, and paints the panels a tone lighter.
 */
const CLEAN = 0.2;
const PALER = { 'steel-dark': 'steel', steel: 'steel-lit', 'steel-lit': 'steel-pale', 'steel-pale': 'steel-bright' };
const paint = (clean) => (name) => (clean ? PALER[name] ?? name : name);

function ductV(seed, clean = false) {
  const tone = paint(clean);
  const lift = clean ? CLEAN : 0;
  const rand = mulberry32(seed);
  const rust = noise(3, 4, rand);
  const flake = noise(8, 11, rand);
  const pits = noise(12, 16, rand);
  const cv = canvas(DUCT_W, DUCT_L);
  // The face, lit from the left: pale at the bevel, into shadow at the right.
  const face = ['steel-lit', 'steel-lit', 'steel', 'steel', 'steel', 'steel', 'steel', 'steel', 'steel', 'steel', 'steel',
    'steel', 'steel', 'steel', 'steel-dark', 'steel-dark', 'steel-dark', 'steel-dark'];
  for (let y = 0; y < DUCT_L; y++) {
    for (let x = 0; x < DUCT_W; x++) {
      let c;
      if (x === 0 || x === DUCT_W - 1) c = 'rock';
      else if (x === 1) c = 'steel-pale';
      else if (x === 2) c = 'steel-lit';
      else if (x === DUCT_W - 2) c = 'soot';
      else if (x === DUCT_W - 3) c = 'steel-darkest';
      else {
        c = face[x - 3];
        // Rust eats in from the edges and seams and spreads in blooms;
        // fine pitting everywhere.
        const u = x / DUCT_W;
        const v = y / DUCT_L;
        const edge = Math.max(0, 1 - Math.min(x - 3, DUCT_W - 4 - x) / 5) * 0.12;
        const r = rust(u, v) * 0.55 + flake(u, v) * 0.35 + edge;
        const p = pits(u, v);
        c = tone(c);
        if (r > 0.64 + lift) c = 'rust-bright';
        else if (r > 0.5 + lift) c = 'rust';
        else if (r > 0.44 + lift && p > 0.5) c = 'rust';
        if (p > 0.82 + lift / 2) c = c === 'rust-bright' ? 'rust' : 'rust-deep-pit';
        else if (p < 0.1) c = 'steel-darkest';
      }
      cv.set(x, y, C(c === 'rust-deep-pit' ? 'rust' : c));
    }
  }
  // Rust running down from under the flange rivets.
  for (const x of [5, 11, 17]) {
    const run = 3 + Math.floor(rand() * 9);
    for (let y = 5; y < 5 + run; y++) cv.set(x + 1, y, C(y > 5 + run - 3 ? 'rust' : 'rust-bright'));
  }
  // The flange where two lengths meet: a raised band, riveted.
  const band = ['rock', 'steel-pale', 'steel-lit', 'steel', 'soot'];
  band.forEach((c, y) => { for (let x = 1; x < DUCT_W - 1; x++) cv.set(x, y, C(c)); });
  for (const x of [4, 10, 16]) rivet(cv, x, 1);
  // A panel seam half way, with a rivet each side.
  for (let x = 3; x < DUCT_W - 3; x++) {
    cv.set(x, 16, C('steel-darkest'));
    cv.set(x, 17, C(cv.get(x, 17) === C('rust-bright') ? 'rust-bright' : 'steel-lit'));
  }
  rivet(cv, 4, 18);
  rivet(cv, DUCT_W - 7, 18);
  return cv;
}

function ductJoint(seed, clean = false) {
  const tone = paint(clean);
  const lift = clean ? CLEAN : 0;
  const rand = mulberry32(seed + 7);
  const rust = noise(3, 3, rand);
  const pits = noise(10, 10, rand);
  const S = 30;
  const cv = canvas(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let c;
      if (x === 0 || y === 0 || x === S - 1 || y === S - 1) c = 'rock';
      else if (x === 1 || y === 1) c = 'steel-pale';
      else if (x === S - 2 || y === S - 2) c = 'soot';
      else if (x === 2 || y === 2) c = 'steel-lit';
      else if (x === S - 3 || y === S - 3) c = 'steel-darkest';
      else {
        c = x + y < S ? 'steel' : 'steel-dark';
        const edge = Math.max(0, 1 - Math.min(x - 3, y - 3, S - 4 - x, S - 4 - y) / 6) * 0.15;
        const r = rust(x / S, y / S) * 0.6 + pits(x / S, y / S) * 0.4 + edge;
        c = tone(c);
        if (r > 0.62 + lift) c = 'rust-bright';
        else if (r > 0.48 + lift) c = 'rust';
      }
      cv.set(x, y, C(c));
    }
  }
  for (const [x, y] of [[4, 4], [S - 7, 4], [4, S - 7], [S - 7, S - 7], [13, 4], [13, S - 7], [4, 13], [S - 7, 13]]) rivet(cv, x, y);
  return cv;
}

// --- pipes ------------------------------------------------------------------

const PIPE_W = 16;
const PIPE_L = 32;

/**
 * A round pipe down the tile, collared at the top, with a stain running down
 * from the collar. `body` is the cylinder's shading left to right across its
 * 12 px, `collar` the collar's across the full 16.
 */
function pipeV(seed, { body, collar, bolt, stain, grime }) {
  const rand = mulberry32(seed);
  const dirt = noise(4, 8, rand);
  const cv = canvas(PIPE_W, PIPE_L);
  for (let y = 0; y < PIPE_L; y++) {
    for (let x = 2; x < 14; x++) {
      let c = body[x - 2];
      // Grime settles on the shadowed side.
      if (x > 6 && x < 13 && dirt(x / PIPE_W, y / PIPE_L) > 0.74) c = grime;
      cv.set(x, y, C(c));
    }
  }
  // The collar, and its bolts.
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < PIPE_W; x++) {
      const rim = y === 0 || y === 6;
      let c = rim ? 'rock' : collar[x];
      if (!rim && (y === 1)) c = x === 0 || x === PIPE_W - 1 ? 'rock' : collar[Math.max(1, x - 1)];
      if (!rim && y === 5 && x > 0 && x < PIPE_W - 1) c = 'soot';
      cv.set(x, y, C(c));
    }
  }
  for (const x of [2, 7, 12]) rivet(cv, x, 2, bolt[0], bolt[1], bolt[2]);
  // What leaks at the collar runs down the pipe.
  const x = 5 + Math.floor(rand() * 5);
  const run = 4 + Math.floor(rand() * 12);
  for (let y = 7; y < 7 + run; y++) cv.set(x, y, C(y > 7 + run - 4 ? stain[1] : stain[0]));
  return cv;
}

function pipeJoint({ body, collar, bolt }) {
  const S = 20;
  const cv = canvas(S, S);
  const r = S / 2 - 0.5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - r, y - r);
      if (d > r + 0.4) continue;
      let c;
      if (d > r - 1) c = 'rock';
      else if (d > r - 4) c = collar[Math.min(collar.length - 1, Math.max(0, Math.round((x + y) / (2 * S) * (collar.length - 1))))];
      else c = body[Math.min(body.length - 1, Math.max(0, Math.round((x + y) / (2 * S) * (body.length - 1))))];
      cv.set(x, y, C(c));
    }
  }
  for (const [x, y] of [[9, 1], [9, S - 4], [1, 9], [S - 4, 9]]) rivet(cv, x, y, bolt[0], bolt[1], bolt[2]);
  return cv;
}

const SEWER = {
  body: ['rock', 'steel-dark', 'steel-lit', 'steel-pale', 'steel-lit', 'steel', 'steel', 'steel-dark', 'steel-dark', 'steel-darkest', 'soot', 'rock'],
  collar: ['rock', 'rust', 'rust-bright', 'rust-bright', 'rust-bright', 'rust', 'rust', 'rust', 'rust', 'rust', 'rust', 'rust', 'soot', 'soot', 'soot', 'rock'],
  bolt: ['steel-bright', 'ash', 'soot'],
  stain: ['rust', 'rust'],
  grime: 'rust',
};

const MAIN = {
  body: ['rock', 'steel', 'steel-pale', 'steel-bright', 'steel-pale', 'steel-pale', 'steel-lit', 'steel-lit', 'steel', 'steel-dark', 'steel-darkest', 'rock'],
  collar: ['rock', 'steel-lit', 'steel-pale', 'steel-pale', 'steel-lit', 'steel-lit', 'steel', 'steel', 'steel', 'steel', 'steel', 'steel-dark', 'steel-dark', 'steel-darkest', 'steel-darkest', 'rock'],
  bolt: ['steel-bright', 'steel-pale', 'steel-darkest'],
  stain: ['steel-lit', 'steel'],
  grime: 'steel-lit',
};

// --- out ----------------------------------------------------------------------

/** The same tile turned a quarter: its length runs across. */
function turn(cv) {
  const out = canvas(cv.h, cv.w);
  for (let y = 0; y < cv.h; y++) for (let x = 0; x < cv.w; x++) out.set(y, x, cv.get(x, y));
  return out;
}

function write(id, cv) {
  const pixels = Buffer.alloc(cv.w * cv.h * 4);
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      const c = cv.get(x, y);
      const o = (y * cv.w + x) * 4;
      if (!c) continue;
      pixels[o] = c[0]; pixels[o + 1] = c[1]; pixels[o + 2] = c[2]; pixels[o + 3] = 255;
    }
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${id}.png`), encode(cv.w, cv.h, pixels));
  console.log(`${id}: ${cv.w}x${cv.h}`);
}

const seed = Number(process.argv[2]) || 3;
const duct = ductV(seed);
write('duct-v', duct);
write('duct-h', turn(duct));
write('duct-joint', ductJoint(seed));
const freshDuct = ductV(seed + 5, true);
write('fresh-duct-v', freshDuct);
write('fresh-duct-h', turn(freshDuct));
write('fresh-duct-joint', ductJoint(seed + 5, true));
const sewer = pipeV(seed + 11, SEWER);
write('sewer-v', sewer);
write('sewer-h', turn(sewer));
write('sewer-joint', pipeJoint(SEWER));
const main = pipeV(seed + 23, MAIN);
write('main-v', main);
write('main-h', turn(main));
write('main-joint', pipeJoint(MAIN));
