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
  if (![64, 128, 192, 256].includes(width)) throw new Error("width must be 64, 128, 192 or 256");
  if (!['room', 'open'].includes(kind)) throw new Error('kind must be room or open');
  const name = (layout ? `${width}-${kind}-${layout}` : `${width}-${kind}`) + (lit ? '-lit' : '');
  const out = resolve(ROOT, `resources/assets/room-guide-${name}.png`);
  writeFileSync(out, roomGuide(width, kind, layout, lit));
  console.log(`wrote ${out}`);
}
