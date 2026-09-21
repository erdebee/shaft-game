/**
 * figureTemplate.mjs
 * The figure mannequin: one adult drawn to the exact proportions in
 * concept/asset-production-spec.md §4.2, used as the init image for every
 * figure generation.
 *
 * Asking PixelLab for "a 22 px tall person" does not work. Figures baked into
 * room renders came back anywhere from 10 to 28 px tall, with heads from a
 * quarter to a half of their height (probe/v4..v9). Starting every figure from
 * the same mannequin (init strength 150, spec §4.2) pins the height, the head size and
 * the feet line, and leaves the model only the costume to decide.
 *
 *   node tools/figureTemplate.mjs [adult|child] [costume]
 *
 * Writes resources/assets/figure-template-<kind>[-<costume>].png (32 × 32,
 * facing right, soles on the bottom row, centred on column 16).
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './palettePng.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 32;

/**
 * Body blocks, rows counted down from the top of the silhouette (outline
 * included). Each entry: [firstRow, lastRow, firstCol, lastCol, part].
 * Columns are relative to the figure's centre column 16. Facing right, so the
 * face, the front arm and the toes sit on the +x side.
 *
 * Adult, 22 rows: outline 1 · head 5 · neck 1 · torso 7 · legs 5 · boots 2 · sole 1.
 * The head is 6 of 22 rows including its outline (~3.7 heads tall).
 */
const BODIES = {
  adult: {
    height: 22,
    blocks: [
      [1, 2, -2, 2, 'hair'],
      [3, 5, -2, -1, 'hair'],
      [3, 5, 0, 2, 'skin'],
      [6, 6, -1, 0, 'skin'],
      [7, 13, -3, 2, 'shirt'],
      [7, 12, 0, 1, 'arm'],
      [13, 13, 0, 1, 'skin'],
      [14, 18, -2, 1, 'trousers'],
      [19, 20, -2, 3, 'boots'],
    ],
    eye: [4, 1],
  },
  // 14 rows: outline 1 · head 4 · torso 4 · legs 3 · boots 1 · sole 1. Proportionally bigger head.
  child: {
    height: 14,
    blocks: [
      [1, 2, -2, 1, 'hair'],
      [3, 4, -2, -2, 'hair'],
      [3, 4, -1, 1, 'skin'],
      [5, 8, -2, 1, 'shirt'],
      [5, 7, 0, 0, 'arm'],
      [8, 8, 0, 0, 'skin'],
      [9, 11, -2, 1, 'trousers'],
      [12, 12, -2, 2, 'boots'],
    ],
    eye: [3, 0],
  },
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * Costume colours per figure id, from the spec's figure table (§4.2). A template
 * in the role's own colours lets generation run at a lower init strength (more
 * freedom for the costume details) without drifting off the body.
 *
 * Hex values are palette v6/03, which is not in tokens.css yet. Move these to
 * token names when that palette is locked.
 */
const COSTUMES = {
  neutral:    { hair: '#372c34', skin: '#dcc6a4', shirt: '#86b6a2', arm: '#4f837c', trousers: '#4f4148', boots: '#241c26' },
  engineer:   { hair: '#372c34', skin: '#dcc6a4', shirt: '#33585a', arm: '#1f3638', trousers: '#33585a', boots: '#4f4148' },
  miner:      { hair: '#241c26', skin: '#b69c86', shirt: '#6c5a5c', arm: '#4f4148', trousers: '#372c34', boots: '#241c26' },
  porter:     { hair: '#241c26', skin: '#8e7870', shirt: '#dcc6a4', arm: '#b69c86', trousers: '#6c5a5c', boots: '#4f4148' },
  grower:     { hair: '#8e3f30', skin: '#dcc6a4', shirt: '#86b6a2', arm: '#b69c86', trousers: '#6c5a5c', boots: '#4f4148' },
  councillor: { hair: '#dcc6a4', skin: '#b69c86', shirt: '#8e3f30', arm: '#372c34', trousers: '#241c26', boots: '#140f18' },
  resident:   { hair: '#4f4148', skin: '#b69c86', shirt: '#cf6a40', arm: '#8e3f30', trousers: '#4f4148', boots: '#372c34' },
  child:      { hair: '#6c5a5c', skin: '#dcc6a4', shirt: '#86b6a2', arm: '#4f837c', trousers: '#8e7870', boots: '#372c34' },
};

const FIXED = { bg: '#33585a', outline: '#140f18' };

export function figureTemplate(kind = 'adult', costume = 'neutral') {
  const c = COSTUMES[costume];
  if (!c) throw new Error(`unknown costume "${costume}" — expected ${Object.keys(COSTUMES).join(' | ')}`);
  const COLOURS = Object.fromEntries(Object.entries({ ...c, ...FIXED }).map(([k, v]) => [k, hex(v)]));

  const body = BODIES[kind];
  if (!body) throw new Error(`unknown figure kind "${kind}" — expected ${Object.keys(BODIES).join(' | ')}`);

  const CENTRE = 16;
  const top = SIZE - body.height; // soles land on the bottom row
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill('bg'));

  for (const [r0, r1, c0, c1, part] of body.blocks) {
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) grid[top + r][CENTRE + c] = part;
    }
  }
  grid[top + body.eye[0]][CENTRE + body.eye[1]] = 'outline';

  // A one-pixel outline wherever the background touches the body, including
  // the sole row under the boots and the row above the hair.
  const filled = (y, x) => y >= 0 && y < SIZE && x >= 0 && x < SIZE
    && grid[y][x] !== 'bg' && grid[y][x] !== 'edge';
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (grid[y][x] !== 'bg') continue;
      if (filled(y - 1, x) || filled(y + 1, x) || filled(y, x - 1) || filled(y, x + 1)) grid[y][x] = 'edge';
    }
  }

  return encodePng(SIZE, SIZE, (x, y) => {
    const part = grid[y][x];
    return COLOURS[part === 'edge' ? 'outline' : part];
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const kind = process.argv[2] ?? 'adult';
  const costume = process.argv[3] ?? 'neutral';
  const name = costume === 'neutral' ? kind : `${kind}-${costume}`;
  const out = resolve(ROOT, `resources/assets/figure-template-${name}.png`);
  writeFileSync(out, figureTemplate(kind, costume));
  console.log(`wrote ${out}`);
}
