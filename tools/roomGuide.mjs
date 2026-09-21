/**
 * roomGuide.mjs
 * A flat layout guide for a room: back wall, ceiling band, the floor band at
 * rows 88–95, and — for rooms — the slanted side-wall wedges. Used as a
 * low-strength init image so a generation inherits the envelope and only
 * paints the contents.
 *
 * Prompting alone does not hold the envelope. Floors came back anywhere from
 * row 85 to 92, and asking for slanted side walls turned 128-wide rooms into
 * one-point perspective boxes (probe/v9). The guide draws both as geometry the
 * model starts from, rather than as words it interprets.
 *
 *   node tools/roomGuide.mjs <width> [room|open] [layout]
 *
 * width is 64, 128 or 192. "room" (default) draws slanted side walls at both
 * edges; "open" draws none, for the none-master of an open area (spec §2.2).
 * layout adds a blockout of the building's main masses (see LAYOUTS).
 * Writes resources/assets/room-guide-<width>-<kind>[-<layout>].png.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './palettePng.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEIGHT = 96;

/** Envelope geometry, in rows and columns. The floor line is the contract (spec §2.1). */
const CEILING_BOTTOM = 9; // ceiling band = rows 0–9
const FLOOR_TOP = 88;     // floor band = rows 88–95
const WALL_DEPTH = 6;     // how far the side walls reach in at the ceiling and floor

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// Palette v6/03. Flat values only: the guide is geometry, not a colour suggestion.
const C = {
  ceiling: hex('#241c26'),
  ceilingEdge: hex('#140f18'),
  wall: hex('#4f4148'),
  sideWall: hex('#372c34'),
  sideEdge: hex('#140f18'),
  floorTop: hex('#8e7870'),
  floor: hex('#6c5a5c'),
  floorBottom: hex('#372c34'),
};

/**
 * Blockouts: the main masses of a building as flat shapes, drawn inside the
 * envelope. A plain guide wall reads to the model as "an empty wall", and at any
 * strength that holds the envelope the room comes back bare (probe/v11). A
 * blockout gives it a composition to paint over instead.
 *
 * Shapes: ['rect', x0, y0, x1, y1, colour] (inclusive) or
 * ['circle', cx, cy, r, colour]. Later shapes draw over earlier ones. They are
 * clipped to the interior, so they can never move the ceiling, the floor line or
 * the side walls.
 */
const P = {
  dark: '#140f18', ink: '#241c26', plum: '#372c34', slate: '#4f4148', mauve: '#6c5a5c',
  taupe: '#8e7870', sand: '#b69c86', cream: '#dcc6a4',
  tealDeep: '#1f3638', teal: '#33585a', tealLit: '#4f837c', mint: '#86b6a2',
  rust: '#8e3f30', terracotta: '#cf6a40', amber: '#f2b25a',
};

const LAYOUTS = {
  'main-generator': [
    ['rect', 8, 12, 183, 15, P.taupe],              // ceiling pipe run
    ['rect', 100, 16, 107, 40, P.slate],            // exhaust stack
    ['rect', 118, 16, 125, 40, P.slate],            // exhaust stack
    ['rect', 60, 36, 150, 80, P.teal],              // engine block
    ['rect', 60, 36, 150, 40, P.tealLit],           // engine top light
    ['rect', 84, 30, 132, 36, P.tealLit],           // cylinder heads
    ['circle', 50, 60, 22, P.tealDeep],             // flywheel
    ['circle', 50, 60, 6, P.slate],                 // flywheel hub
    ['rect', 36, 80, 156, 87, P.tealDeep],          // plinth
    ['rect', 160, 42, 178, 87, P.rust],             // control cabinet
    ['circle', 165, 50, 2, P.cream],                // gauge
    ['circle', 173, 50, 2, P.cream],                // gauge
    ['rect', 12, 68, 24, 87, P.terracotta],         // drum
    ['rect', 26, 74, 34, 87, P.sand],               // crate
  ],
  house: [
    ['rect', 16, 52, 32, 87, P.ink],                // cast-iron stove
    ['rect', 22, 10, 25, 52, P.plum],               // stove pipe
    ['rect', 46, 28, 76, 31, P.mauve],              // shelf
    ['rect', 48, 22, 52, 28, P.mint],               // jars
    ['rect', 60, 22, 66, 28, P.terracotta],         // books
    ['rect', 44, 68, 72, 71, P.rust],               // table top
    ['rect', 46, 72, 48, 87, P.rust],               // table leg
    ['rect', 68, 72, 70, 87, P.rust],               // table leg
    ['circle', 60, 18, 2, P.amber],                 // lamp
    ['rect', 88, 26, 104, 40, P.sand],              // family picture
    ['rect', 82, 72, 118, 80, P.terracotta],        // bed blanket
    ['rect', 82, 68, 92, 72, P.cream],              // pillow
    ['rect', 82, 80, 118, 87, P.plum],              // bed frame
  ],
  'council-chamber': [
    ['rect', 18, 10, 24, 87, P.mauve],              // pilaster
    ['rect', 103, 10, 109, 87, P.mauve],            // pilaster
    ['circle', 64, 30, 11, P.sand],                 // civic seal
    ['circle', 64, 30, 7, P.rust],
    ['circle', 34, 38, 2, P.amber],                 // sconce
    ['circle', 93, 38, 2, P.amber],                 // sconce
    ['rect', 30, 50, 36, 66, P.rust],               // chair backs
    ['rect', 46, 50, 52, 66, P.rust],
    ['rect', 75, 50, 81, 66, P.rust],
    ['rect', 91, 50, 97, 66, P.rust],
    ['rect', 58, 44, 70, 66, P.ink],                // speaker's chair, raised
    ['rect', 26, 64, 101, 68, P.mauve],             // table top
    ['rect', 28, 68, 99, 87, P.plum],               // table front
  ],
};

export function roomGuide(width, kind = 'room', layout = null) {
  const walls = kind === 'room';
  const shapes = layout ? LAYOUTS[layout] : [];
  if (!shapes) throw new Error(`unknown layout "${layout}" — expected ${Object.keys(LAYOUTS).join(' | ')}`);

  const blockout = (x, y) => {
    let hit = null;
    for (const s of shapes) {
      if (s[0] === 'rect' && x >= s[1] && x <= s[3] && y >= s[2] && y <= s[4]) hit = s[5];
      if (s[0] === 'circle' && (x - s[1]) ** 2 + (y - s[2]) ** 2 <= s[3] ** 2) hit = s[4];
    }
    return hit && hex(hit);
  };

  return encodePng(width, HEIGHT, (x, y) => {
    if (y <= CEILING_BOTTOM) return y === CEILING_BOTTOM ? C.ceilingEdge : C.ceiling;
    if (y >= FLOOR_TOP) return y === FLOOR_TOP ? C.floorTop : y >= HEIGHT - 2 ? C.floorBottom : C.floor;

    if (walls) {
      // Each side wall is a strip WALL_DEPTH wide whose corners bevel into the
      // ceiling and floor bands — a cut into rock, not a camera angle.
      const fromEdge = Math.min(x, width - 1 - x);
      const toCeiling = y - CEILING_BOTTOM;
      const toFloor = FLOOR_TOP - y;
      const reach = Math.min(WALL_DEPTH, toCeiling, toFloor);
      if (fromEdge < reach) return C.sideWall;
      if (fromEdge === reach) return C.sideEdge;
    }
    return blockout(x, y) ?? C.wall;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const width = Number(process.argv[2]);
  const kind = process.argv[3] ?? 'room';
  const layout = process.argv[4] ?? null;
  if (![64, 128, 192].includes(width)) throw new Error('width must be 64, 128 or 192');
  if (!['room', 'open'].includes(kind)) throw new Error('kind must be room or open');
  const name = layout ? `${width}-${kind}-${layout}` : `${width}-${kind}`;
  const out = resolve(ROOT, `resources/assets/room-guide-${name}.png`);
  writeFileSync(out, roomGuide(width, kind, layout));
  console.log(`wrote ${out}`);
}
