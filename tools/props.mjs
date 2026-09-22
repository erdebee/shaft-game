/**
 * props.mjs
 * Free-standing furniture sprites, drawn pixel by pixel rather than generated.
 *
 * A room is generated; a prop this small is not. A stool is 15x11 and a lectern
 * 19x22 — at that size the generator has too few pixels to put a silhouette in,
 * and three inpaint attempts came back as a plain table and a featureless bench
 * (probe/v27). Hand-drawing them costs nothing, lands on the room's own palette
 * exactly, and — the point of the exercise — gives a silhouette that still reads
 * once a figure is standing behind it.
 *
 *   node tools/props.mjs
 *
 * Writes one PNG per entry in PROPS to resources/assets/sprites/props/.
 * placeProps.mjs then stamps them into a room render and cutForeground lifts
 * them back out, so the prop ends up in both the room and its foreground.
 *
 * Every prop is drawn standing ON its last row, so stamping it is "put the
 * bottom row on the floor line" and nothing needs a separate anchor.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from './png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'resources/assets/sprites/props');

/**
 * Timber, sampled off the auditorium render itself (the ledge and the window
 * frame), so a prop stamped into that room shares its colours literally rather
 * than approximately. The light in every room comes from the ceiling lamps, so
 * the top face of a prop is the lit one and its underside is the dark one.
 */
const C = {
  '.': null,               // transparent
  K: [0x1d, 0x16, 0x23],   // outline — the room's darkest ink
  S: [0x31, 0x23, 0x31],   // shadow side
  M: [0x5b, 0x41, 0x3e],   // mid timber
  L: [0x7d, 0x58, 0x4e],   // lit timber
  H: [0x97, 0x73, 0x5f],   // top-face highlight
  B: [0xc4, 0xa4, 0x5b],   // dull brass
};

/**
 * A low backless stool, seen straight on.
 *
 * Backless on purpose. The audience sits with its back to us looking at the
 * window, so a chair with a back would cover the person from the waist up and
 * the room would read as a rack of empty chairs. A stool crosses the shins
 * only, which is exactly the amount of overlap that says "sitting".
 */
const STOOL = [
  'KKKKKKKKKKKKKKK',
  'KHHHHHHHHHHHHHK',
  'KLLLLLLLLLLLLLK',
  'KSSSSSSSSSSSSSK',
  '.KLK.......KMK.',
  '.KLK.......KMK.',
  '.KLK.......KMK.',
  '.KLKMMMMMMMKMK.',
  '.KLKSSSSSSSKMK.',
  '.KLK.......KMK.',
  'KKLKK.....KKMKK',
];

/**
 * A lectern: a slanted reading board on a single pedestal, with a brass lip
 * along the bottom edge of the board so the slant reads at this size.
 *
 * The board sits at row 0–6 of a 22-row prop standing on the floor, which puts
 * it at chest height on a 37px figure — the speaker stands behind it and is
 * visible from the chest up, which is the whole reason it is a foreground cut.
 */
const LECTERN = [
  '....KKKKKKKKKKKKKKK',
  '..KKKHHHHHHHHHHHHHK',
  'KKKHHHHHHHHHHHHHLLK',
  'KHHHHHHHHHHHHLLLLMK',
  'KLLLLLLLLLLLLLLLMMK',
  'KBBBBBBBBBBBBBBBBMK',
  'KKKKKKKKKKKKKKKKKKK',
  '.......KLLMK.......',
  '.......KLSMK.......',
  '.......KLSMK.......',
  '.......KLSMK.......',
  '.......KLSMK.......',
  '.......KLSMK.......',
  '.......KLSMK.......',
  '.......KLSMK.......',
  '.......KLSMK.......',
  '.......KLSMK.......',
  '......KKLSMKK......',
  '.....KKLLSMMKK.....',
  '...KKKLLLSMMMKKK...',
  '..KHHHHHHHHHHHHHK..',
  '..KKKKKKKKKKKKKKK..',
];

const PROPS = {
  'auditorium-stool': STOOL,
  'auditorium-lectern': LECTERN,
};

/** Turn an ASCII map into an RGBA buffer. Unknown characters are transparent. */
function paint(rows) {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const pixels = Buffer.alloc(width * height * 4, 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const colour = C[rows[y][x]];
      if (!colour) continue;
      const o = (y * width + x) * 4;
      pixels[o] = colour[0];
      pixels[o + 1] = colour[1];
      pixels[o + 2] = colour[2];
      pixels[o + 3] = 255;
    }
  }
  return { width, height, png: encode(width, height, pixels) };
}

mkdirSync(OUT, { recursive: true });
for (const [name, rows] of Object.entries(PROPS)) {
  const { width, height, png } = paint(rows);
  writeFileSync(resolve(OUT, `${name}.png`), png);
  console.log(`sprites/props/${name}.png  ${width}x${height}`);
}
