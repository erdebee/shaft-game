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
 * --lit redraws the guide in four dithered lighting bands (see lightAt).
 * Writes resources/assets/room-guide-<width>-<kind>[-<layout>][-lit].png.
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

/**
 * A row of chairs in side elevation: back, seat and legs, repeated. Written as
 * a function because the auditorium seats fourteen and listing them by hand
 * would bury the rest of its blockout.
 */
const chairRow = (x0, count, step, seatY, colour) => Array.from({ length: count }, (_, i) => {
  const x = x0 + i * step;
  return [
    ['rect', x, seatY - 14, x + 2, seatY, colour],        // back
    ['rect', x, seatY, x + 9, seatY + 2, colour],         // seat
    ['rect', x + 1, seatY + 3, x + 2, seatY + 10, colour], // legs
    ['rect', x + 7, seatY + 3, x + 8, seatY + 10, colour],
  ];
}).flat();

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
  // 3 slots (192 px) since 2026-09-21; the 1-slot version is kept in probe/v13.
  canteen: [
    ['rect', 12, 30, 38, 40, P.plum],               // extractor hood
    ['rect', 10, 56, 40, 87, P.ink],                // kitchen range
    ['circle', 18, 52, 4, P.mauve],                 // pots
    ['circle', 32, 52, 4, P.mauve],
    ['rect', 50, 22, 80, 38, P.tealDeep],           // menu board
    ['rect', 54, 26, 76, 26, P.cream],
    ['rect', 54, 30, 70, 30, P.cream],
    ['rect', 54, 34, 74, 34, P.cream],
    ['rect', 44, 58, 84, 60, P.sand],               // serving counter top
    ['rect', 44, 61, 84, 87, P.mauve],              // serving counter
    ['rect', 110, 10, 110, 16, P.taupe],            // lamp drops
    ['rect', 150, 10, 150, 16, P.taupe],
    ['circle', 110, 18, 2, P.amber],                // hanging lamps
    ['circle', 150, 18, 2, P.amber],
    ['circle', 130, 32, 5, P.cream],                // wall clock
    ['rect', 96, 68, 176, 71, P.rust],              // long table
    ['rect', 100, 72, 102, 87, P.rust],
    ['rect', 170, 72, 172, 87, P.rust],
    ['rect', 94, 78, 178, 80, P.sand],              // benches
  ],
  archive: [
    ['rect', 10, 16, 40, 87, P.plum],               // ledger shelves
    ['rect', 10, 30, 40, 31, P.mauve],
    ['rect', 10, 46, 40, 47, P.mauve],
    ['rect', 10, 62, 40, 63, P.mauve],
    ['rect', 12, 22, 38, 29, P.terracotta],         // ledgers
    ['rect', 12, 38, 38, 45, P.sand],
    ['rect', 12, 54, 38, 61, P.rust],
    ['rect', 42, 20, 44, 87, P.sand],               // library ladder
    ['rect', 48, 50, 70, 87, P.rust],               // card catalogue
    ['rect', 76, 66, 106, 69, P.rust],              // reading desk
    ['rect', 78, 70, 80, 87, P.rust],
    ['rect', 102, 70, 104, 87, P.rust],
    ['circle', 92, 60, 3, P.amber],                 // desk lamp
    ['rect', 108, 16, 120, 87, P.plum],             // second shelf
  ],
  clinic: [
    ['rect', 10, 20, 48, 21, P.taupe],              // curtain rail
    ['rect', 46, 22, 50, 70, P.mint],               // curtain
    ['rect', 12, 70, 44, 78, P.cream],              // bed
    ['rect', 12, 78, 44, 87, P.mauve],
    ['rect', 50, 40, 51, 87, P.taupe],              // drip stand
    ['rect', 48, 40, 53, 48, P.mint],
    ['rect', 58, 26, 82, 50, P.cream],              // medicine cabinet
    ['rect', 68, 30, 72, 44, P.tealLit],
    ['rect', 62, 35, 78, 39, P.tealLit],
    ['rect', 88, 66, 116, 69, P.sand],              // desk
    ['rect', 90, 70, 92, 87, P.sand],
    ['rect', 112, 70, 114, 87, P.sand],
    ['circle', 100, 20, 2, P.amber],                // lamp
  ],
  workshop: [
    ['circle', 42, 18, 2, P.amber],                 // lamp
    ['rect', 14, 24, 70, 50, P.mauve],              // tool pegboard
    ['rect', 18, 28, 22, 44, P.slate],
    ['rect', 28, 30, 40, 34, P.slate],
    ['rect', 48, 28, 52, 46, P.slate],
    ['rect', 14, 62, 70, 66, P.rust],               // workbench
    ['rect', 16, 67, 18, 87, P.rust],
    ['rect', 66, 67, 68, 87, P.rust],
    ['rect', 60, 56, 66, 62, P.slate],              // vice
    ['rect', 20, 76, 40, 87, P.sand],               // parts bins
    ['rect', 78, 58, 114, 80, P.teal],              // lathe
    ['rect', 76, 80, 116, 87, P.plum],
  ],
  'scrubber-bank': [
    ['rect', 8, 12, 119, 18, P.taupe],              // duct
    ['rect', 16, 20, 42, 87, P.teal],               // filter columns
    ['rect', 58, 20, 84, 87, P.teal],
    ['rect', 16, 40, 42, 42, P.tealDeep],
    ['rect', 16, 60, 42, 62, P.tealDeep],
    ['rect', 58, 40, 84, 42, P.tealDeep],
    ['rect', 58, 60, 84, 62, P.tealDeep],
    ['circle', 29, 30, 2, P.cream],                 // gauges
    ['circle', 71, 30, 2, P.cream],
    ['circle', 104, 48, 12, P.mauve],               // fan housing
    ['circle', 104, 48, 3, P.ink],
    ['rect', 92, 72, 118, 87, P.plum],              // carbon sacks
  ],
  'oxygen-garden': [
    ['rect', 10, 24, 118, 50, P.tealDeep],          // moss wall
    ['circle', 24, 32, 3, P.mint],
    ['circle', 58, 40, 3, P.mint],
    ['circle', 92, 30, 3, P.mint],
    ['rect', 14, 18, 114, 19, P.amber],             // grow lamps
    ['rect', 8, 54, 119, 55, P.sand],               // brass pipe
    ['circle', 22, 62, 9, P.mint],                  // ferns
    ['circle', 46, 60, 10, P.tealLit],
    ['circle', 72, 62, 9, P.mint],
    ['circle', 98, 60, 10, P.tealLit],
    ['rect', 10, 70, 118, 87, P.rust],              // planters
  ],
  'reclamation-plant': [
    ['rect', 8, 14, 119, 18, P.taupe],              // pipe run
    ['rect', 10, 34, 62, 37, P.tealLit],            // settling vat rim
    ['rect', 12, 38, 60, 87, P.teal],               // settling vat
    ['rect', 60, 44, 70, 48, P.taupe],              // transfer pipe
    ['rect', 70, 50, 110, 84, P.slate],             // filter press
    ['rect', 74, 54, 76, 80, P.mauve],
    ['rect', 82, 54, 84, 80, P.mauve],
    ['rect', 90, 54, 92, 80, P.mauve],
    ['rect', 98, 54, 100, 80, P.mauve],
    ['circle', 90, 40, 3, P.cream],                 // gauge
    ['rect', 112, 70, 120, 87, P.rust],             // sludge drum
  ],
  // 2 slots: at 64 px the school kept coming back in perspective (probe/v17).
  school: [
    ['rect', 10, 30, 26, 87, P.rust],               // bookshelf
    ['rect', 12, 40, 24, 41, P.plum],
    ['rect', 12, 54, 24, 55, P.plum],
    ['rect', 12, 68, 24, 69, P.plum],
    ['circle', 46, 16, 2, P.amber],                 // lamps
    ['circle', 86, 16, 2, P.amber],
    ['rect', 34, 22, 96, 50, P.tealDeep],           // chalkboard
    ['rect', 38, 28, 70, 28, P.cream],
    ['rect', 38, 33, 84, 33, P.cream],
    ['rect', 38, 38, 62, 38, P.cream],
    ['rect', 34, 51, 96, 52, P.sand],               // chalk ledge
    ['rect', 34, 72, 50, 75, P.sand],               // pupils' desks
    ['rect', 36, 76, 38, 87, P.sand], ['rect', 46, 76, 48, 87, P.sand],
    ['rect', 56, 72, 72, 75, P.sand],
    ['rect', 58, 76, 60, 87, P.sand], ['rect', 68, 76, 70, 87, P.sand],
    ['rect', 78, 72, 94, 75, P.sand],
    ['rect', 80, 76, 82, 87, P.sand], ['rect', 90, 76, 92, 87, P.sand],
    ['rect', 102, 26, 116, 42, P.terracotta],       // pinned drawings
    ['rect', 100, 66, 118, 87, P.rust],             // teacher's desk
    ['circle', 110, 58, 5, P.tealLit],              // globe on the desk
  ],
  'security-post': [
    ['circle', 26, 16, 2, P.amber],                 // lamp
    ['rect', 12, 24, 40, 44, P.sand],               // notice board
    ['rect', 15, 27, 23, 35, P.cream],
    ['rect', 27, 29, 36, 38, P.cream],
    ['rect', 44, 30, 54, 58, P.plum],               // baton rack
    ['rect', 44, 60, 56, 87, P.plum],               // locker
    ['rect', 10, 66, 40, 69, P.slate],              // desk
    ['rect', 12, 70, 14, 87, P.slate],
    ['rect', 36, 70, 38, 87, P.slate],
    ['rect', 30, 58, 38, 66, P.ink],                // telephone
  ],
  'battery-bank': [
    ['rect', 30, 10, 32, 30, P.ink],                // main cable
    ['rect', 12, 20, 26, 26, P.terracotta],         // warning plate
    ['circle', 50, 22, 3, P.cream],                 // gauge
    ['rect', 10, 30, 54, 44, P.teal],               // battery cells
    ['rect', 10, 48, 54, 62, P.teal],
    ['rect', 10, 66, 54, 87, P.teal],
    ['rect', 14, 28, 18, 30, P.cream],              // terminals
    ['rect', 46, 28, 50, 30, P.cream],
    ['rect', 14, 46, 18, 48, P.cream],
    ['rect', 46, 46, 50, 48, P.cream],
  ],
  'superior-suite': [
    ['rect', 10, 60, 40, 87, P.rust],               // sideboard
    ['rect', 14, 54, 20, 60, P.cream],              // dishes
    ['rect', 26, 54, 34, 60, P.mint],
    ['circle', 25, 38, 5, P.cream],                 // wall clock
    ['rect', 80, 28, 108, 44, P.sand],              // family portrait
    ['circle', 95, 18, 3, P.amber],                 // lamp
    ['rect', 66, 56, 70, 87, P.rust],               // chair
    ['rect', 120, 56, 124, 87, P.rust],             // chair
    ['rect', 70, 66, 120, 69, P.rust],              // dining table
    ['rect', 74, 70, 76, 87, P.rust],
    ['rect', 114, 70, 116, 87, P.rust],
    ['rect', 132, 30, 154, 87, P.plum],             // wardrobe
    ['rect', 180, 56, 184, 87, P.rust],             // headboard
    ['rect', 156, 70, 184, 80, P.terracotta],       // bed
    ['rect', 156, 80, 184, 87, P.plum],
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
  // v22: four fresh luxury-suite concepts (piano lounge, art deco, library, salon).
  'luxury-suite-piano': [
    ['rect', 60, 10, 60, 14, P.taupe],              // chandelier chain
    ['circle', 60, 20, 5, P.amber],                 // chandelier
    ['rect', 20, 24, 50, 38, P.sand],               // painting
    ['rect', 14, 50, 62, 64, P.ink],                // grand piano body
    ['rect', 16, 65, 19, 87, P.ink],                // piano legs
    ['rect', 56, 65, 59, 87, P.ink],
    ['rect', 66, 70, 80, 74, P.rust],               // piano bench
    ['rect', 68, 75, 69, 87, P.rust], ['rect', 77, 75, 78, 87, P.rust],
    ['rect', 86, 66, 104, 70, P.sand],              // bar cart
    ['rect', 88, 58, 92, 65, P.mint], ['rect', 96, 58, 100, 65, P.terracotta],
    ['rect', 88, 70, 89, 82, P.sand], ['rect', 102, 70, 103, 82, P.sand],
    ['circle', 89, 84, 3, P.ink], ['circle', 102, 84, 3, P.ink],
    ['rect', 110, 34, 124, 87, P.rust],             // folding screen
    ['rect', 117, 34, 117, 87, P.plum],
    ['rect', 128, 40, 129, 87, P.sand],             // standing lamp
    ['circle', 128, 38, 4, P.amber],
    ['circle', 152, 30, 2, P.amber],                // sconce
    ['rect', 177, 48, 182, 87, P.rust],             // headboard
    ['rect', 134, 68, 177, 80, P.terracotta],       // bed
    ['rect', 168, 64, 177, 68, P.cream],            // pillow
    ['rect', 134, 80, 177, 87, P.plum],             // bed frame
  ],
  'luxury-suite-deco': [
    ['rect', 12, 62, 40, 66, P.rust],               // dressing table
    ['rect', 14, 67, 16, 87, P.rust], ['rect', 36, 67, 38, 87, P.rust],
    ['circle', 26, 44, 11, P.sand],                 // round mirror frame
    ['circle', 26, 44, 8, P.tealLit],               // mirror glass
    ['rect', 18, 56, 22, 61, P.terracotta],         // perfume bottles
    ['rect', 50, 70, 90, 80, P.teal],               // chaise longue
    ['rect', 50, 58, 57, 70, P.teal],
    ['rect', 52, 81, 54, 87, P.ink], ['rect', 86, 81, 88, 87, P.ink],
    ['rect', 96, 34, 97, 87, P.sand],               // floor lamp
    ['circle', 96, 31, 4, P.amber],
    ['circle', 108, 52, 10, P.tealLit],             // potted palm
    ['rect', 104, 72, 112, 87, P.terracotta],
    ['circle', 125, 44, 9, P.sand],                 // deco fan headboard
    ['rect', 120, 44, 130, 87, P.sand],
    ['rect', 130, 68, 182, 80, P.terracotta],       // bed
    ['rect', 130, 64, 140, 68, P.cream],            // pillow
    ['rect', 130, 80, 182, 87, P.plum],
    ['rect', 142, 24, 172, 40, P.rust],             // deco artwork
    ['rect', 146, 28, 168, 36, P.amber],
  ],
  'luxury-suite-library': [
    ['rect', 10, 16, 44, 87, P.plum],               // bookcase
    ['rect', 12, 22, 42, 28, P.terracotta], ['rect', 12, 36, 42, 42, P.mint],
    ['rect', 12, 50, 42, 56, P.sand], ['rect', 12, 64, 42, 70, P.rust],
    ['rect', 46, 20, 48, 87, P.sand],               // library ladder
    ['circle', 62, 68, 7, P.teal],                  // globe
    ['rect', 61, 75, 63, 87, P.sand],
    ['circle', 92, 20, 4, P.amber],                 // chandelier
    ['rect', 92, 10, 92, 15, P.taupe],
    ['rect', 72, 64, 102, 68, P.rust],              // writing desk
    ['rect', 74, 69, 76, 87, P.rust], ['rect', 98, 69, 100, 87, P.rust],
    ['circle', 96, 58, 3, P.amber],                 // desk lamp
    ['rect', 104, 62, 112, 87, P.teal],             // reading chair
    ['rect', 115, 10, 118, 87, P.mauve],            // pilaster
    ['rect', 122, 24, 184, 28, P.rust],             // four-poster canopy
    ['rect', 122, 24, 125, 87, P.rust], ['rect', 181, 24, 184, 87, P.rust],
    ['rect', 126, 66, 180, 80, P.terracotta],       // bed
    ['rect', 126, 62, 136, 66, P.cream],
    ['rect', 126, 80, 180, 87, P.plum],
  ],
  'luxury-suite-bath': [
    ['circle', 40, 20, 4, P.amber],                 // chandelier
    ['rect', 40, 10, 40, 15, P.taupe],
    ['rect', 12, 66, 56, 80, P.cream],              // clawfoot bathtub
    ['rect', 14, 62, 54, 66, P.sand],               // tub rim
    ['rect', 16, 81, 19, 87, P.amber], ['rect', 49, 81, 52, 87, P.amber],
    ['rect', 50, 44, 52, 62, P.amber],              // tap and shower pipe
    ['rect', 60, 50, 72, 53, P.sand],               // towel rail
    ['rect', 62, 54, 70, 72, P.terracotta],         // towel
    ['rect', 78, 30, 94, 87, P.rust],               // wardrobe
    ['rect', 86, 30, 86, 87, P.plum],
    ['rect', 100, 26, 124, 44, P.sand],             // painting
    ['rect', 100, 68, 122, 80, P.teal],             // velvet settee
    ['rect', 100, 60, 104, 68, P.teal],
    ['circle', 132, 34, 2, P.amber],                // sconce
    ['rect', 176, 44, 182, 87, P.rust],             // tall headboard
    ['rect', 136, 68, 176, 80, P.terracotta],       // bed
    ['rect', 166, 64, 176, 68, P.cream],
    ['rect', 136, 80, 176, 87, P.plum],
  ],
  // v19: the remaining sixteen buildings.
  'holding-cells': [
    ['circle', 32, 16, 2, P.amber],                 // caged lamp
    ['rect', 10, 26, 18, 34, P.taupe],              // key rack
    ['rect', 10, 74, 18, 77, P.rust],               // guard's stool
    ['rect', 13, 78, 15, 87, P.rust],
    ['rect', 28, 70, 54, 74, P.rust],               // cell bunk
    ['rect', 44, 80, 50, 87, P.mauve],              // bucket
    ['rect', 24, 20, 56, 22, P.ink],              // cell bars: top rail
    ['rect', 24, 20, 25, 87, P.ink],
    ['rect', 30, 20, 31, 87, P.ink],
    ['rect', 36, 20, 37, 87, P.ink],
    ['rect', 42, 20, 43, 87, P.ink],
    ['rect', 48, 20, 49, 87, P.ink],
    ['rect', 54, 20, 55, 87, P.ink],
  ],
  'duct-fan': [
    ['circle', 12, 16, 2, P.amber],                 // lamp
    ['rect', 22, 10, 42, 24, P.taupe],              // duct up
    ['rect', 20, 24, 44, 26, P.mauve],              // flange
    ['circle', 32, 48, 20, P.taupe],              // fan housing
    ['circle', 32, 48, 16, P.ink],
    ['circle', 32, 48, 4, P.mauve],                 // hub
    ['rect', 20, 70, 44, 72, P.mauve],              // flange
    ['rect', 24, 72, 40, 87, P.taupe],              // duct down
    ['rect', 50, 60, 56, 72, P.rust],               // control box
  ],
  'protein-vats': [
    ['rect', 8, 12, 119, 15, P.taupe],              // pipe run
    ['rect', 23, 16, 25, 20, P.taupe],              // feed drops
    ['rect', 55, 16, 57, 20, P.taupe],
    ['rect', 87, 16, 89, 20, P.taupe],
    ['rect', 10, 20, 38, 24, P.tealLit],            // vat lids
    ['rect', 42, 20, 70, 24, P.tealLit],
    ['rect', 74, 20, 102, 24, P.tealLit],
    ['rect', 12, 24, 36, 87, P.teal],               // vats
    ['rect', 44, 24, 68, 87, P.teal],
    ['rect', 76, 24, 100, 87, P.teal],
    ['circle', 24, 50, 4, P.mint],                  // sight glasses
    ['circle', 56, 50, 4, P.mint],
    ['circle', 88, 50, 4, P.mint],
    ['rect', 106, 40, 118, 70, P.rust],             // control panel
    ['circle', 112, 48, 2, P.cream],
    ['circle', 112, 60, 2, P.cream],
  ],
  'food-processing': [
    ['circle', 44, 16, 2, P.amber],                 // lamp
    ['rect', 10, 26, 54, 28, P.mauve],              // shelf
    ['rect', 12, 20, 50, 25, P.terracotta],         // tins
    ['rect', 10, 34, 32, 40, P.taupe],              // hopper
    ['rect', 12, 40, 30, 70, P.ink],              // grinder
    ['rect', 12, 70, 30, 87, P.plum],
    ['rect', 32, 62, 56, 66, P.sand],               // packing table
    ['rect', 34, 67, 36, 87, P.sand],
    ['rect', 52, 67, 54, 87, P.sand],
    ['rect', 38, 76, 50, 87, P.rust],               // crate of packed rations
  ],
  'seed-vault': [
    ['circle', 32, 13, 2, P.amber],                 // lamp
    ['rect', 10, 18, 54, 34, P.rust],               // seed drawers
    ['rect', 10, 23, 54, 23, P.plum],
    ['rect', 10, 28, 54, 28, P.plum],
    ['rect', 24, 18, 24, 34, P.plum],
    ['rect', 40, 18, 40, 34, P.plum],
    ['circle', 32, 62, 18, P.ink],                // vault door
    ['circle', 32, 62, 14, P.taupe],
    ['circle', 32, 62, 12, P.tealDeep],
    ['circle', 32, 62, 4, P.rust],                  // wheel
    ['rect', 48, 80, 56, 87, P.sand],               // seed crate
  ],
  'modest-suite': [
    ['circle', 64, 16, 2, P.amber],                 // lamp
    ['rect', 18, 10, 20, 60, P.plum],               // stove pipe
    ['rect', 12, 60, 26, 87, P.ink],                // stove
    ['rect', 30, 30, 56, 32, P.mauve],              // shelf
    ['rect', 32, 24, 52, 29, P.terracotta],         // crockery and books
    ['rect', 32, 68, 58, 71, P.rust],               // table
    ['rect', 34, 72, 36, 87, P.rust],
    ['rect', 54, 72, 56, 87, P.rust],
    ['rect', 66, 28, 82, 42, P.sand],               // family picture
    ['rect', 88, 56, 92, 87, P.rust],               // headboard
    ['rect', 92, 70, 118, 80, P.terracotta],        // bed
    ['rect', 92, 66, 100, 70, P.cream],             // pillow
    ['rect', 92, 80, 118, 87, P.plum],              // bed frame
  ],
  'luxury-suite': [
    ['rect', 12, 22, 40, 87, P.plum],               // bookcase
    ['rect', 15, 30, 37, 34, P.terracotta],
    ['rect', 15, 46, 37, 50, P.mint],
    ['rect', 15, 62, 37, 66, P.sand],
    ['rect', 50, 28, 86, 44, P.sand],               // painting
    ['rect', 48, 62, 70, 87, P.teal],               // armchair
    ['rect', 74, 70, 86, 87, P.rust],               // side table
    ['circle', 80, 62, 6, P.sand],                  // gramophone horn
    ['rect', 96, 10, 96, 14, P.taupe],              // chandelier chain
    ['circle', 96, 20, 5, P.amber],                 // chandelier
    ['rect', 100, 10, 104, 87, P.mauve],            // pilaster
    ['rect', 108, 26, 128, 87, P.rust],             // wardrobe
    ['rect', 132, 24, 184, 28, P.rust],             // bed canopy
    ['rect', 134, 50, 138, 87, P.rust],             // headboard
    ['rect', 138, 68, 182, 80, P.terracotta],       // bed
    ['rect', 138, 64, 148, 68, P.cream],            // pillow
    ['rect', 138, 80, 182, 87, P.plum],             // bed frame
  ],
  'common-hall': [
    ['rect', 8, 16, 56, 17, P.terracotta],          // bunting
    ['circle', 32, 22, 2, P.amber],                 // lamp
    ['rect', 10, 24, 28, 42, P.sand],               // notice board
    ['rect', 36, 36, 54, 38, P.mauve],              // shelf
    ['rect', 38, 28, 52, 35, P.rust],               // radio
    ['rect', 10, 66, 54, 69, P.rust],               // table
    ['rect', 12, 70, 14, 87, P.rust],
    ['rect', 50, 70, 52, 87, P.rust],
    ['rect', 16, 62, 20, 65, P.cream],              // mugs
    ['rect', 40, 62, 44, 65, P.cream],
    ['rect', 8, 76, 56, 79, P.sand],                // bench
    ['rect', 20, 80, 22, 87, P.sand],
    ['rect', 42, 80, 44, 87, P.sand],
  ],
  'machine-shop': [
    ['rect', 8, 14, 119, 16, P.taupe],              // line shaft
    ['circle', 30, 15, 4, P.ink],                 // pulleys
    ['circle', 80, 15, 4, P.ink],
    ['rect', 29, 19, 31, 36, P.plum],               // belts
    ['rect', 79, 19, 81, 34, P.plum],
    ['circle', 50, 24, 2, P.amber],                 // lamp
    ['rect', 18, 36, 40, 48, P.tealLit],            // drill press head
    ['rect', 26, 48, 30, 87, P.teal],               // drill press column
    ['rect', 18, 62, 38, 64, P.ink],              // drill table
    ['rect', 60, 34, 100, 87, P.teal],              // milling machine
    ['rect', 60, 34, 100, 38, P.tealLit],
    ['rect', 54, 58, 106, 62, P.ink],             // mill table
    ['circle', 94, 46, 2, P.cream],                 // gauge
    ['rect', 106, 56, 120, 87, P.rust],             // tool chest
    ['rect', 106, 64, 120, 64, P.plum],
    ['rect', 106, 72, 120, 72, P.plum],
  ],
  recycler: [
    ['rect', 8, 12, 119, 15, P.taupe],              // pipe run
    ['circle', 70, 20, 2, P.amber],                 // lamp
    ['rect', 12, 24, 44, 34, P.ink],              // hopper
    ['rect', 18, 34, 38, 70, P.rust],               // shredder body
    ['rect', 20, 70, 36, 74, P.ink],                // shredder teeth
    ['rect', 14, 74, 42, 87, P.plum],               // base
    ['rect', 44, 64, 92, 68, P.mauve],              // conveyor
    ['rect', 52, 60, 58, 63, P.sand],               // scrap on the belt
    ['rect', 70, 60, 76, 63, P.terracotta],
    ['rect', 48, 76, 60, 87, P.teal],               // sorting bins
    ['rect', 64, 76, 76, 87, P.terracotta],
    ['rect', 80, 76, 92, 87, P.sand],
    ['rect', 96, 30, 118, 87, P.ink],             // compactor
    ['rect', 100, 34, 114, 40, P.taupe],            // compactor ram
  ],
  // spansLevels: the car and rails run through the ceiling and floor.
  'freight-elevator': [
    ['rect', 10, 10, 54, 87, P.ink],                // shaft
    ['rect', 12, 10, 14, 87, P.taupe],              // guide rails
    ['rect', 50, 10, 52, 87, P.taupe],
    ['rect', 31, 10, 33, 24, P.ink],              // hoist cable
    ['rect', 16, 24, 48, 87, P.rust],               // car frame
    ['rect', 19, 28, 45, 87, P.plum],               // car interior
    ['rect', 22, 72, 34, 87, P.sand],               // crates in the car
    ['rect', 20, 30, 21, 87, P.taupe],            // scissor gate
    ['rect', 27, 30, 28, 87, P.taupe],
    ['rect', 36, 30, 37, 87, P.taupe],
    ['rect', 43, 30, 44, 87, P.taupe],
    ['circle', 56, 20, 2, P.amber],                 // warning lamp
  ],
  dumbwaiter: [
    ['circle', 32, 16, 4, P.ink],                 // pulley
    ['rect', 29, 20, 29, 38, P.taupe],              // ropes
    ['rect', 35, 20, 35, 38, P.taupe],
    ['rect', 16, 36, 48, 62, P.rust],               // hatch frame
    ['rect', 19, 39, 45, 59, P.ink],                // hatch opening
    ['rect', 22, 48, 42, 59, P.sand],               // tray of parcels
    ['circle', 52, 40, 2, P.amber],                 // call bell
    ['rect', 12, 62, 52, 65, P.sand],               // counter
    ['rect', 14, 66, 50, 87, P.mauve],              // cabinet
  ],
  'salvage-post': [
    ['circle', 32, 16, 2, P.amber],                 // lamp
    ['rect', 10, 22, 40, 40, P.mauve],              // board of salvaged parts
    ['rect', 12, 46, 18, 72, P.taupe],              // stripped panel, leaning
    ['rect', 32, 74, 42, 87, P.sand],               // crate
    ['rect', 44, 50, 48, 87, P.rust],               // gas bottles
    ['rect', 50, 50, 54, 87, P.teal],
    ['circle', 22, 86, 14, P.mauve],                // scrap heap
    ['circle', 30, 82, 8, P.taupe],
  ],
  junction: [
    ['rect', 16, 10, 18, 30, P.ink],                // cable conduits
    ['rect', 28, 10, 30, 30, P.ink],
    ['rect', 40, 10, 42, 30, P.ink],
    ['rect', 10, 30, 48, 70, P.teal],               // breaker cabinet
    ['rect', 29, 30, 29, 70, P.tealDeep],
    ['circle', 20, 40, 3, P.cream],                 // meters
    ['circle', 38, 40, 3, P.cream],
    ['rect', 14, 52, 44, 60, P.tealDeep],           // breaker row
    ['rect', 52, 34, 54, 40, P.rust],               // knife switch handle
    ['rect', 50, 40, 56, 56, P.ink],              // knife switch
    ['rect', 14, 74, 26, 82, P.terracotta],         // warning plate
    ['circle', 42, 80, 7, P.rust],                  // cable drum
  ],
  purifier: [
    ['rect', 14, 10, 18, 30, P.taupe],              // inlet pipe
    ['rect', 18, 26, 50, 30, P.taupe],              // crossover pipe
    ['circle', 48, 28, 3, P.rust],                  // valve wheel
    ['rect', 10, 30, 30, 87, P.teal],               // carbon filter tank
    ['rect', 10, 48, 30, 49, P.tealDeep],
    ['rect', 18, 36, 22, 70, P.mint],               // sight glass
    ['rect', 36, 36, 52, 72, P.ink],              // canister
    ['circle', 44, 44, 3, P.cream],                 // gauge
    ['rect', 34, 76, 54, 87, P.plum],               // carbon sacks
  ],
  cistern: [
    ['rect', 8, 18, 52, 22, P.tealLit],             // tank rim
    ['rect', 10, 22, 50, 87, P.teal],               // tank
    ['rect', 10, 40, 50, 41, P.tealDeep],           // rivet bands
    ['rect', 10, 62, 50, 63, P.tealDeep],
    ['rect', 44, 26, 46, 80, P.mint],               // level gauge
    ['circle', 20, 80, 3, P.rust],                  // outlet valve
    ['rect', 53, 18, 54, 87, P.sand],               // ladder
    ['rect', 55, 24, 56, 25, P.sand],
    ['rect', 55, 40, 56, 41, P.sand],
    ['rect', 55, 56, 56, 57, P.sand],
    ['rect', 55, 72, 56, 73, P.sand],
  ],
  /**
   * Where the Accord is amended and where it is applied to a person. The bench
   * is raised and central, the dock is in front of it and the public bench is
   * off to one side: the room states the hierarchy before anyone speaks.
   */
  judicial: [
    ['rect', 10, 20, 30, 87, P.rust],               // law library
    ['rect', 12, 32, 28, 33, P.plum],
    ['rect', 12, 48, 28, 49, P.plum],
    ['rect', 12, 64, 28, 65, P.plum],
    ['circle', 52, 16, 2, P.amber],                 // lamps
    ['circle', 140, 16, 2, P.amber],
    ['circle', 62, 30, 9, P.sand],                  // scales seal
    ['circle', 62, 30, 5, P.rust],
    ['rect', 88, 18, 128, 46, P.tealDeep],          // the Accord, engraved
    ['rect', 94, 24, 122, 25, P.cream],
    ['rect', 94, 30, 116, 31, P.cream],
    ['rect', 94, 36, 120, 37, P.cream],
    ['rect', 150, 20, 172, 48, P.terracotta],       // hanging banner
    ['rect', 96, 40, 102, 54, P.ink],               // judges' chair backs
    ['rect', 108, 36, 116, 54, P.ink],
    ['rect', 122, 40, 128, 54, P.ink],
    ['rect', 82, 52, 142, 56, P.mauve],             // bench top
    ['rect', 82, 57, 142, 79, P.plum],              // bench front
    ['rect', 78, 80, 146, 87, P.ink],               // dais
    ['rect', 38, 60, 64, 64, P.rust],               // the dock rail
    ['rect', 38, 64, 40, 87, P.rust],
    ['rect', 62, 64, 64, 87, P.rust],
    ['rect', 150, 66, 182, 69, P.sand],             // public bench
    ['rect', 152, 70, 154, 87, P.sand],
    ['rect', 178, 70, 180, 87, P.sand],
  ],

  /**
   * The way out, four slots so it and the auditorium fill level 1 exactly. One
   * slot of cell, where someone leaving spends their last day on a bench; one
   * slot of suit-up bay, full-body suits hanging on a rack above a bench and
   * boots; and two slots of door — the only thing in the Shaft that opens onto
   * the outside, so it is built like a vault and banded in hazard paint.
   */
  'shaft-exit': [
    // The cell: bars across the front, the bench behind them.
    ['circle', 30, 16, 2, P.amber],                 // caged lamp over the cell
    ['rect', 18, 28, 42, 42, P.tealDeep],           // the notice, posted
    ['rect', 21, 32, 38, 33, P.cream],
    ['rect', 21, 37, 33, 38, P.cream],
    ['rect', 10, 68, 50, 72, P.rust],               // the bench
    ['rect', 12, 73, 14, 87, P.rust],
    ['rect', 46, 73, 48, 87, P.rust],
    ['rect', 8, 18, 56, 20, P.ink],                 // cell bars
    ['rect', 8, 18, 9, 87, P.ink],
    ['rect', 16, 18, 17, 87, P.ink],
    ['rect', 24, 18, 25, 87, P.ink],
    ['rect', 32, 18, 33, 87, P.ink],
    ['rect', 40, 18, 41, 87, P.ink],
    ['rect', 48, 18, 49, 87, P.ink],
    ['rect', 55, 18, 56, 87, P.ink],
    ['rect', 60, 12, 65, 87, P.taupe],              // divider: cell | suit bay
    // The suit-up bay: three full-body suits on a rail, helmets on the shelf.
    ['circle', 98, 16, 2, P.amber],                 // lamp
    ['rect', 70, 22, 126, 23, P.ink],               // hanging rail
    ['rect', 70, 24, 126, 26, P.mauve],             // helmet shelf
    ['circle', 78, 20, 4, P.sand],                  // helmets, visors teal
    ['circle', 98, 20, 4, P.sand],
    ['circle', 118, 20, 4, P.sand],
    ['rect', 72, 28, 84, 62, P.terracotta],         // suit: torso and arms
    ['rect', 73, 62, 76, 74, P.terracotta],         // legs
    ['rect', 80, 62, 83, 74, P.terracotta],
    ['rect', 92, 28, 104, 62, P.sand],              // suit
    ['rect', 93, 62, 96, 74, P.sand],
    ['rect', 100, 62, 103, 74, P.sand],
    ['rect', 112, 28, 124, 62, P.terracotta],       // suit
    ['rect', 113, 62, 116, 74, P.terracotta],
    ['rect', 120, 62, 123, 74, P.terracotta],
    ['rect', 74, 34, 82, 36, P.tealLit],            // visor straps / chest plates
    ['rect', 94, 34, 102, 36, P.tealLit],
    ['rect', 114, 34, 122, 36, P.tealLit],
    ['rect', 70, 78, 126, 80, P.rust],              // changing bench
    ['rect', 72, 81, 74, 87, P.rust],
    ['rect', 122, 81, 124, 87, P.rust],
    ['rect', 84, 83, 90, 87, P.ink],                // boots under the bench
    ['rect', 104, 83, 110, 87, P.ink],
    ['rect', 128, 12, 133, 87, P.taupe],            // divider: suit bay | door
    // The door, two slots.
    ['rect', 140, 14, 148, 87, P.plum],             // door jamb, left
    ['rect', 228, 14, 236, 87, P.plum],             // door jamb, right
    ['rect', 142, 26, 234, 32, P.taupe],            // lintel over the door
    ['rect', 150, 34, 226, 87, P.mauve],            // the door leaf, set in its frame
    ['rect', 150, 34, 226, 37, P.amber],            // hazard band, head
    ['rect', 150, 82, 226, 85, P.amber],            // hazard band, sill
    ['circle', 188, 60, 17, P.taupe],               // the wheel
    ['circle', 188, 60, 5, P.plum],
    ['rect', 186, 46, 190, 74, P.plum],             // spokes
    ['rect', 174, 58, 202, 62, P.plum],
    ['rect', 206, 42, 222, 56, P.tealDeep],         // release panel
    ['circle', 211, 48, 2, P.terracotta],
    ['circle', 217, 48, 2, P.mint],
    ['circle', 158, 18, 3, P.rust],                 // warning lamp, above the frame
    ['rect', 168, 14, 212, 22, P.tealDeep],         // stencilled sign over the door
    ['rect', 172, 17, 208, 18, P.cream],
  ],

  /**
   * Six slots: the only room wide enough to hold the Shaft at once. A lectern
   * and a low stage on the left, raked seating through the middle, and at the
   * back a window onto a dead landscape — which is a screen, though the room is
   * built so you forget that. A departure through the exit on this level is
   * watched from these chairs. Six slots and not seven because 384 px is the
   * widest canvas pixflux will draw in one pass (probe/v26: a 448-px hall
   * generated as two halves never agreed about its floor or its chairs).
   */
  auditorium: [
    ['rect', 8, 12, 376, 14, P.taupe],              // ceiling beam run
    ['circle', 30, 19, 2, P.amber],                 // lamps
    ['circle', 120, 17, 2, P.amber],
    ['circle', 264, 17, 2, P.amber],
    ['circle', 354, 19, 2, P.amber],
    // The window is the room: centred and 72% of the wall wide. Kept SHORT so
    // the seating has a band of its own — at full height the generator drops
    // the chairs and the lectern entirely (probe/v26, seed 26072).
    ['rect', 54, 16, 330, 54, P.ink],               // the frame
    ['rect', 59, 20, 325, 50, P.taupe],             // a bleached sky
    ['rect', 59, 38, 325, 50, P.mauve],             // and the dust under it
    ['rect', 59, 38, 325, 39, P.plum],              // the horizon
    ['rect', 190, 22, 193, 44, P.ink],              // dead tree: trunk
    ['rect', 188, 42, 195, 46, P.ink],              // its root flare
    ['rect', 186, 27, 189, 28, P.ink],              // bare branches, forking up
    ['rect', 182, 25, 186, 26, P.ink],
    ['rect', 178, 23, 182, 24, P.ink],
    ['rect', 194, 29, 198, 30, P.ink],
    ['rect', 198, 26, 202, 27, P.ink],
    ['rect', 202, 24, 205, 25, P.ink],
    ['rect', 194, 21, 196, 22, P.ink],
    ['rect', 184, 34, 189, 35, P.ink],
    ['rect', 50, 54, 334, 58, P.mauve],             // the sill under it
    // A lectern on a low dais at one end, standing in front of the window.
    ['rect', 8, 76, 60, 79, P.mauve],
    ['rect', 8, 79, 60, 87, P.plum],
    ['rect', 28, 58, 36, 76, P.rust],               // lectern column
    ['rect', 20, 52, 44, 58, P.sand],               // lectern desk
    ['rect', 14, 18, 17, 76, P.taupe],              // standard
    ['rect', 17, 22, 30, 44, P.terracotta],         // banner
    // One flat row of chairs, all the same size, in the band below the window.
    ...chairRow(72, 11, 27, 78, P.rust),
    ['rect', 66, 86, 376, 87, P.ink],               // the aisle floor line
    ['rect', 348, 66, 372, 70, P.sand],             // a small bench at the far end
    ['rect', 350, 71, 352, 87, P.sand],
    ['rect', 368, 71, 370, 87, P.sand],
  ],
};

/**
 * Lighting for --lit guides. A flat guide carries only ~12 colours, and the
 * model keeps that palette: rooms came back with 8–16 colours, flat and
 * unshaded (probe/v14). Four bands from lamp-lit ceiling to shadowed floor,
 * Bayer-dithered where they meet and tinted warm to cool, give the guide ~35
 * colours and show the model dithered light falloff to follow (probe/v15).
 * Use it at strength 75: at 50 the extra shading reads as depth and rooms
 * turn into perspective interiors.
 */
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const BAND_GAIN = [1.18, 1.05, 0.92, 0.8];
const BAND_TINT = [[8, 2, -6], [3, 0, -2], [-2, 0, 3], [-5, -1, 6]];
const clamp = (v) => Math.max(0, Math.min(255, v));

function lightAt([r, g, b], x, y) {
  const band = Math.min(3, Math.floor((y / HEIGHT) * 3 + BAYER[y % 4][x % 4] / 16));
  const gain = BAND_GAIN[band];
  const tint = BAND_TINT[band];
  return [r, g, b].map((v, i) => clamp(Math.trunc(clamp(Math.trunc(v * gain)) + tint[i])));
}

export function roomGuide(width, kind = 'room', layout = null, lit = false) {
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

  const flat = (x, y) => {
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
  };
  return encodePng(width, HEIGHT, lit ? (x, y) => lightAt(flat(x, y), x, y) : flat);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lit = process.argv.includes('--lit');
  const args = process.argv.slice(2).filter((a) => a !== '--lit');
  const width = Number(args[0]);
  const kind = args[1] ?? 'room';
  const layout = args[2] ?? null;
  // One slot to the full width of a level; the guide itself has no limit, but
  // pixflux stops at 400 px, so anything wider is generated in pieces (§2.4).
  if (!Number.isInteger(width / 64) || width < 64 || width > 640) {
    throw new Error('width must be a whole number of 64-px slots, 64 to 640');
  }
  if (!['room', 'open'].includes(kind)) throw new Error('kind must be room or open');
  const name = (layout ? `${width}-${kind}-${layout}` : `${width}-${kind}`) + (lit ? '-lit' : '');
  const out = resolve(ROOT, `resources/assets/room-guide-${name}.png`);
  writeFileSync(out, roomGuide(width, kind, layout, lit));
  console.log(`wrote ${out}`);
}
