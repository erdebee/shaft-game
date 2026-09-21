/**
 * rockTile.mjs
 * The rock backdrop, generated rather than drawn.
 *
 * Every attempt to generate this with PixelLab came back as a brick wall —
 * regular courses, mortar lines, stacked blocks — no matter how hard "no bricks,
 * no mortar, no courses, not masonry" was pushed (probe seeds 1006, 7004, 8004,
 * 8005). Image models have a strong prior that a dark vertical surface is
 * masonry, and at this size there is nothing to out-argue it with.
 *
 * There is also nothing for a generator to contribute here. The rock is three or
 * four shades of near-black at very low contrast, and its job is to RECEDE
 * (principles §6: nothing in the game is darker, and the inhabited levels are
 * always the brightest thing on screen). That is a texture, not an illustration.
 *
 * Generated, it is also seamless by construction — the noise lattice wraps, so
 * there is no visible tiling grid, which was the other standing complaint about
 * the AI-generated fills.
 *
 *   node tools/rockTile.mjs [band] [seed]
 *
 * band ∈ deep | mid | shallow (default deep). Writes
 * resources/assets/sprites/structure/<band>-rock.png.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSpritePalette, encodePng } from './palettePng.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** One level pitch, so the tile repeats once per floor. */
const WIDTH = 64;
const HEIGHT = 104;

/**
 * Which palette tokens each band's rock is built from, darkest first.
 *
 * The strata get colder and deader with depth: the upper Shaft still has warm
 * earth in the surrounding rock, the bottom is cut into cold stone.
 */
const BANDS = {
  deep:    ['rock', 'rock-cut', 'steel-darkest', 'soot'],
  mid:     ['rock', 'rock-cut', 'steel-darkest', 'steel-dark'],
  shallow: ['rock', 'rock-cut', 'steel-darkest', 'concrete'],
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

/**
 * Value noise on a lattice that WRAPS at `cells`, which is what makes the tile
 * seamless: the right edge interpolates back into the left, and the bottom into
 * the top, by construction rather than by mirroring.
 */
function noiseLayer(cellsX, cellsY, rand) {
  const lattice = new Float64Array(cellsX * cellsY);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();

  return (u, v) => {
    const x = u * cellsX;
    const y = v * cellsY;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);

    const at = (ix, iy) =>
      lattice[(((iy % cellsY) + cellsY) % cellsY) * cellsX + (((ix % cellsX) + cellsX) % cellsX)];

    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bot * fy;
  };
}

const smooth = (t) => t * t * (3 - 2 * t);

export function rockTile(colours, seed = 1) {
  const rand = mulberry32(seed);

  // Three octaves: broad patches of strata, medium mottling, fine grit.
  const broad = noiseLayer(3, 5, rand);
  const mid = noiseLayer(7, 11, rand);
  const fine = noiseLayer(17, 26, rand);

  // A sparse scatter of darker pits and cracks, so the fill is not uniformly
  // busy — real rock has dead flat areas and then a fracture.
  const pit = noiseLayer(11, 17, rand);

  return encodePng(WIDTH, HEIGHT, (x, y) => {
    const u = x / WIDTH;
    const v = y / HEIGHT;

    let n = broad(u, v) * 0.55 + mid(u, v) * 0.3 + fine(u, v) * 0.15;
    if (pit(u, v) > 0.72) n -= 0.28;         // pits and fractures
    n = Math.max(0, Math.min(0.999, n));

    // Bias hard toward the darkest shades: the rock is the floor of the value
    // range, not the middle of it.
    const t = Math.pow(n, 1.9);
    return colours[Math.floor(t * colours.length)].rgb;
  });
}

const band = process.argv[2] ?? 'deep';
const seed = Number(process.argv[3]) || 1;
if (!BANDS[band]) throw new Error(`Unknown band "${band}" — expected deep, mid or shallow`);

// Drawn from the BAND'S OWN sprite palette, not the full token set — the rock
// has to sit in the same 16 colours as the rooms in front of it, or it reads as
// a different game behind them.
const palette = readSpritePalette(band);
const colours = BANDS[band].map((name) => {
  const hit = palette.find((c) => c.name === name);
  if (!hit) throw new Error(`--${name} is not in the ${band} sprite palette (see tokens.css)`);
  return hit;
});

const out = resolve(ROOT, `resources/assets/sprites/structure/${band}-rock.png`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, rockTile(colours, seed));
console.log(`${band}-rock: ${WIDTH}x${HEIGHT}, ${colours.map((c) => c.name).join(' → ')}`);
