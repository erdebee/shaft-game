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
 * width is 64, 128, 192 or 256 (1–4 slots). "room" (default) draws slanted side walls at both
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
  // Open area (spec §2.2): drawn with the "open" envelope, so it runs to both edges.
  'dig-face': [
    ['circle', 30, 44, 18, P.plum],                 // rock masses in the face
    ['circle', 92, 38, 22, P.plum],
    ['circle', 62, 60, 16, P.ink],
    ['circle', 28, 40, 3, P.sand],                  // ore veins
    ['circle', 88, 30, 3, P.terracotta],
    ['circle', 64, 54, 2, P.sand],
    ['rect', 0, 10, 127, 14, P.rust],               // header beam
    ['rect', 18, 10, 23, 87, P.rust],               // pit prop
    ['rect', 104, 10, 109, 87, P.rust],             // pit prop
    ['circle', 44, 22, 2, P.amber],                 // hanging lamp
    ['rect', 84, 48, 91, 84, P.tealDeep],           // drill rig
    ['rect', 74, 58, 84, 61, P.tealLit],            // drill arm
    ['rect', 46, 72, 70, 83, P.slate],              // ore cart
    ['circle', 51, 85, 2, P.ink],
    ['circle', 65, 85, 2, P.ink],
    ['rect', 0, 86, 127, 87, P.taupe],              // rail
    ['rect', 6, 80, 16, 87, P.mauve],               // rubble
  ],
  smelter: [
    ['rect', 8, 12, 119, 15, P.taupe],              // ceiling pipe
    ['rect', 34, 16, 46, 30, P.slate],              // chimney
    ['rect', 20, 30, 60, 87, P.rust],               // furnace
    ['rect', 32, 58, 48, 76, P.amber],              // furnace mouth
    ['rect', 76, 16, 78, 40, P.plum],               // ladle chain
    ['rect', 70, 40, 84, 52, P.ink],                // ladle
    ['rect', 68, 80, 78, 87, P.slate],              // moulds
    ['rect', 86, 80, 96, 87, P.slate],
    ['rect', 102, 74, 118, 87, P.sand],             // ingot stack
  ],
  'deep-pump': [
    ['rect', 14, 10, 20, 87, P.taupe],              // riser
    ['rect', 104, 10, 110, 87, P.taupe],            // riser
    ['rect', 14, 30, 110, 35, P.taupe],             // manifold
    ['circle', 80, 32, 5, P.rust],                  // valve wheel
    ['circle', 44, 58, 20, P.teal],                 // pump housing
    ['circle', 44, 58, 7, P.tealDeep],
    ['rect', 64, 50, 96, 79, P.tealDeep],           // motor
    ['circle', 100, 50, 3, P.cream],                // gauge
    ['rect', 24, 80, 100, 87, P.plum],              // plinth
  ],
  'hydroponics-bay': [
    ['rect', 8, 10, 10, 87, P.taupe],               // feed pipe
    ['rect', 104, 40, 118, 87, P.teal],             // nutrient tank
    ['rect', 14, 20, 98, 21, P.amber],              // grow lamps
    ['rect', 14, 42, 98, 43, P.amber],
    ['rect', 14, 64, 98, 65, P.amber],
    ['rect', 14, 24, 98, 30, P.mint],               // crops
    ['rect', 14, 46, 98, 52, P.tealLit],
    ['rect', 14, 68, 98, 74, P.mint],
    ['rect', 12, 30, 100, 33, P.slate],             // trays
    ['rect', 12, 52, 100, 55, P.slate],
    ['rect', 12, 74, 100, 77, P.slate],
  ],
  'simple-suite': [
    ['rect', 44, 20, 120, 21, P.taupe],             // laundry line
    ['rect', 50, 22, 56, 30, P.cream],              // laundry
    ['rect', 64, 22, 70, 32, P.mint],
    ['rect', 80, 22, 86, 30, P.terracotta],
    ['rect', 10, 45, 11, 87, P.plum],               // bunk posts
    ['rect', 39, 45, 40, 87, P.plum],
    ['rect', 10, 50, 40, 60, P.terracotta],         // upper bunk
    ['rect', 10, 72, 40, 82, P.terracotta],         // lower bunk
    ['rect', 42, 40, 46, 87, P.rust],               // curtain divider
    ['rect', 54, 10, 56, 64, P.plum],               // stove pipe
    ['rect', 50, 64, 60, 87, P.ink],                // stove
    ['rect', 66, 70, 86, 73, P.rust],               // table
    ['rect', 68, 74, 70, 87, P.rust],
    ['rect', 82, 74, 84, 87, P.rust],
    ['rect', 92, 36, 118, 39, P.mauve],             // shelf
    ['rect', 96, 74, 118, 87, P.sand],              // storage crates
  ],
  canteen: [
    ['circle', 40, 16, 2, P.amber],                 // hanging lamp
    ['rect', 30, 22, 52, 36, P.tealDeep],           // menu board
    ['rect', 33, 26, 48, 26, P.cream],
    ['rect', 33, 30, 44, 30, P.cream],
    ['rect', 12, 48, 24, 58, P.ink],                // soup pot
    ['rect', 8, 58, 32, 60, P.sand],                // counter top
    ['rect', 8, 61, 32, 87, P.mauve],               // counter
    ['rect', 36, 70, 56, 73, P.rust],               // table
    ['rect', 38, 74, 40, 87, P.rust],
    ['rect', 52, 74, 54, 87, P.rust],
  ],
  // Open area (spec §2.2).
  grove: [
    ['rect', 0, 64, 191, 87, P.plum],               // wainscot
    ['rect', 46, 10, 46, 18, P.taupe],              // lamp drops
    ['rect', 94, 10, 94, 18, P.taupe],
    ['rect', 142, 10, 142, 18, P.taupe],
    ['circle', 46, 20, 2, P.amber],                 // grow lamps
    ['circle', 94, 20, 2, P.amber],
    ['circle', 142, 20, 2, P.amber],
    ['circle', 22, 48, 14, P.teal],                 // canopies
    ['circle', 70, 46, 15, P.tealLit],
    ['circle', 118, 48, 14, P.teal],
    ['circle', 166, 46, 15, P.tealLit],
    ['rect', 20, 58, 24, 70, P.plum],               // trunks
    ['rect', 68, 58, 72, 70, P.plum],
    ['rect', 116, 58, 120, 70, P.plum],
    ['rect', 164, 58, 168, 70, P.plum],
    ['rect', 10, 70, 34, 87, P.rust],               // planters
    ['rect', 58, 70, 82, 87, P.rust],
    ['rect', 106, 70, 130, 87, P.rust],
    ['rect', 154, 70, 178, 87, P.rust],
    ['rect', 86, 76, 102, 80, P.sand],              // bench
  ],
  'presidential-suite': [
    ['rect', 14, 24, 44, 87, P.plum],               // bookcase
    ['rect', 17, 30, 41, 34, P.terracotta],
    ['rect', 17, 44, 41, 48, P.mint],
    ['rect', 17, 58, 41, 62, P.sand],
    ['rect', 52, 50, 80, 87, P.mauve],              // fireplace
    ['rect', 60, 70, 72, 84, P.amber],              // fire
    ['rect', 90, 10, 94, 87, P.mauve],              // pilasters
    ['rect', 160, 10, 164, 87, P.mauve],
    ['rect', 128, 10, 128, 14, P.taupe],            // chandelier chain
    ['circle', 128, 20, 6, P.amber],                // chandelier
    ['rect', 102, 28, 150, 46, P.sand],             // painting
    ['rect', 98, 68, 152, 87, P.teal],              // sofa
    ['rect', 176, 26, 240, 30, P.rust],             // bed canopy
    ['rect', 180, 40, 186, 87, P.rust],             // headboard
    ['rect', 186, 64, 236, 80, P.terracotta],       // bed
    ['rect', 186, 60, 196, 64, P.cream],            // pillow
    ['rect', 186, 80, 236, 87, P.plum],             // bed frame
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
  if (![64, 128, 192, 256].includes(width)) throw new Error("width must be 64, 128, 192 or 256");
  if (!['room', 'open'].includes(kind)) throw new Error('kind must be room or open');
  const name = layout ? `${width}-${kind}-${layout}` : `${width}-${kind}`;
  const out = resolve(ROOT, `resources/assets/room-guide-${name}.png`);
  writeFileSync(out, roomGuide(width, kind, layout));
  console.log(`wrote ${out}`);
}
