/**
 * cutForeground.mjs
 * Lift the parts of a room that a person can stand BEHIND into their own
 * sprite, so the renderer can draw them over the figure layer.
 *
 * A room render is one flat image, so a figure drawn on top of it stands in
 * front of everything — including the stair rail it is holding and the bars it
 * is locked behind. The fix is a second image per render, transparent except
 * for those parts, drawn after the figures (see shaftView's foreground layer).
 *
 * Nothing is removed from the base render. The foreground is a COPY of pixels
 * that stay where they are, so the room looks identical when nobody is in it
 * and the cut can be re-aimed later without repainting anything. That also
 * means no inpainting: cutting a rail out of the base would leave a hole with
 * nothing behind it, and the wall behind these objects was never drawn.
 *
 *   node tools/cutForeground.mjs [id ...]
 *
 * With no arguments it recuts every entry in CUTS. Each writes
 * <name>-fg.png beside its source, which manifest.json lists with a
 * `foregroundOf` pointing back at the render it belongs to.
 *
 * The shapes below are measured off the "on" render, in sprite pixels with the
 * origin at the render's top-left. Every state variant of a room (off, broken,
 * dim) is pixel-aligned with it, so one set of shapes cuts them all — each
 * from its own image, so the foreground carries that state's own colours.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from './png.mjs';
import { propStencils } from './placeProps.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(ROOT, 'resources/assets');

/** The four room states a cut is applied to, when the file exists. */
const STATES = ['on', 'off', 'broken', 'dim'];

/**
 * A rail is the one teal thing in the stairwell; the wall panels beside the
 * lamp are the same green, which is why they are cut out again by `except`.
 * `grow` then claims the shaded half of the rail's dither, so it crosses a
 * figure as a solid band instead of a dotted line.
 */
const teal = (r, g, b) => g > r + 4 && g >= b - 2;

/** Three student desks, on a pitch the render does not quite keep. */
const desk = (x0) => [
  { rect: [x0, 71, 19, 9] },      // the slab, outline included
  { rect: [x0 + 2, 80, 5, 11] },  // left legs
  { rect: [x0 + 12, 80, 5, 11] }, // right legs
  { rect: [x0 + 7, 84, 5, 1] },   // the two cross rails, between the legs
  { rect: [x0 + 7, 88, 5, 1] },
];

const CUTS = {
  /** The stair rail, the one thing in the shaft people are always behind. */
  stairwell: {
    src: 'sprites/structure/stairwell.png',
    states: false,
    shapes: [{ paint: teal, except: [[100, 55, 28, 31]], grow: 1 }],
  },

  /** The cage: six bars on a 6px pitch, a head rail and a waist rail. */
  'holding-cells': {
    src: 'sprites/buildings/holding-cells-<state>.png',
    shapes: [
      { rect: [22, 20, 38, 3] },
      { rect: [22, 55, 36, 1] },
      ...[24, 30, 36, 42, 48, 54].map((x) => ({ rect: [x, 20, 2, 66] })),
    ],
  },

  /**
   * The Exit's cell: eight 3px bars on an uneven pitch, a head rail and a
   * waist rail, and the notice, which is posted on the bars rather than on the
   * wall behind them.
   */
  'shaft-exit': {
    src: 'sprites/buildings/shaft-exit-<state>.png',
    shapes: [
      { rect: [0, 18, 63, 2] },
      { rect: [0, 33, 63, 2] },
      ...[6, 13, 21, 29, 38, 46, 53, 60].map((x) => ({ rect: [x, 18, 3, 69] })),
      { rect: [25, 31, 12, 13] },
    ],
  },

  /** The long table on the right, which people eat at from both sides. */
  canteen: {
    src: 'sprites/buildings/canteen-<state>.png',
    shapes: [
      { rect: [121, 78, 59, 5] },
      { rect: [127, 83, 4, 9] },
      { rect: [170, 83, 4, 9] },
    ],
  },

  /** The student desks. The teacher stands in front; the class sits behind. */
  school: {
    src: 'sprites/buildings/school-<state>.png',
    shapes: [...desk(29), ...desk(55), ...desk(80)],
  },

  /**
   * The auditorium's furniture: eight stools facing the window and the lectern
   * beside it. Unlike every other cut here these were not generated with the
   * room — they are stamped in by placeProps.mjs — so the shapes come straight
   * from that placement table rather than being measured off the render.
   */
  auditorium: {
    src: 'sprites/buildings/auditorium-<state>.png',
    shapes: propStencils('auditorium'),
  },
};

/**
 * What `grow` is allowed to claim: a cool, unlit pixel. The rails are drawn as
 * a dithered band — teal on the lit side, a blue-grey shadow on the other —
 * so lifting only the teal leaves a dotted line with a figure showing through
 * the gaps. The shadow is always cooler than the red-brown wall and treads
 * around it, which is what keeps the growth on the rail.
 */
const shadow = (r, g, b) => b >= r - 2 && r + g + b < 250;

/**
 * Resolve a cut's shapes into one mask over a decoded image.
 * @returns {Uint8Array} one byte per pixel, 1 where the foreground is.
 */
function maskFor(shapes, image) {
  const { width, height } = image;
  const mask = new Uint8Array(width * height);
  for (const shape of shapes) {
    const one = shape.rect ? rectMask(shape, image)
      : shape.stencil ? stencilMask(shape, image)
        : paintMask(shape, image);
    for (let i = 0; i < mask.length; i++) if (one[i]) mask[i] = 1;
  }
  return mask;
}

/**
 * The opaque pixels of a prop sprite, at the position it was stamped. Used for
 * furniture placeProps.mjs put into a render, where the prop's own alpha is a
 * better silhouette than anything that could be measured off the result.
 */
function stencilMask({ stencil, at: [x0, y0] }, { width, height }) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < stencil.height; y++) {
    for (let x = 0; x < stencil.width; x++) {
      if (stencil.pixels[(y * stencil.width + x) * 4 + 3] === 0) continue;
      const X = x0 + x;
      const Y = y0 + y;
      if (X < 0 || Y < 0 || X >= width || Y >= height) continue;
      mask[Y * width + X] = 1;
    }
  }
  return mask;
}

function rectMask({ rect: [x0, y0, w, h] }, { width, height }) {
  const mask = new Uint8Array(width * height);
  for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x++) mask[y * width + x] = 1;
  }
  return mask;
}

/**
 * Every pixel of a colour, minus the places it also appears where it is not
 * the object, plus the shaded half of its dither, minus whatever is left over
 * as specks. The last step matters: a two-pixel island floating over somebody's
 * chest reads as a smudge on the screen, not as part of the room.
 */
function paintMask(shape, { width, height, pixels }) {
  const mask = new Uint8Array(width * height);
  const inside = ([bx, by, bw, bh], x, y) => x >= bx && x < bx + bw && y >= by && y < by + bh;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (pixels[o + 3] === 0) continue;
      if (!shape.paint(pixels[o], pixels[o + 1], pixels[o + 2])) continue;
      if (shape.within && !inside(shape.within, x, y)) continue;
      if (shape.except?.some((box) => inside(box, x, y))) continue;
      mask[y * width + x] = 1;
    }
  }

  // Grow into the object's own shaded side: pixels touching what was picked
  // that are dark and cool. Restricted that way so it cannot creep out across
  // the wall.
  for (let pass = 0; pass < (shape.grow ?? 0); pass++) {
    const grown = mask.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x]) continue;
        const o = (y * width + x) * 4;
        if (!shadow(pixels[o], pixels[o + 1], pixels[o + 2])) continue;
        const touches = (x > 0 && mask[y * width + x - 1])
          || (x < width - 1 && mask[y * width + x + 1])
          || (y > 0 && mask[(y - 1) * width + x])
          || (y < height - 1 && mask[(y + 1) * width + x]);
        if (touches) grown[y * width + x] = 1;
      }
    }
    mask.set(grown);
  }

  dropIslands(mask, width, height, shape.minIsland ?? 6);
  return mask;
}

/** Clear every 8-connected run of fewer than `min` pixels. */
function dropIslands(mask, width, height, min) {
  const seen = new Uint8Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const island = [start];
    seen[start] = 1;
    for (let k = 0; k < island.length; k++) {
      const i = island[k];
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx;
          const Y = y + dy;
          if (X < 0 || Y < 0 || X >= width || Y >= height) continue;
          const j = Y * width + X;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            island.push(j);
          }
        }
      }
    }
    if (island.length < min) for (const i of island) mask[i] = 0;
  }
}

/** Copy the masked pixels into a new image of the same size; the rest is clear. */
function cut(png, shapes) {
  const image = decode(png);
  const mask = maskFor(shapes, image);
  const out = Buffer.alloc(image.width * image.height * 4, 0);
  let kept = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || image.pixels[i * 4 + 3] === 0) continue;
    image.pixels.copy(out, i * 4, i * 4, i * 4 + 4);
    kept++;
  }
  return { png: encode(image.width, image.height, out), kept };
}

function run(id) {
  const spec = CUTS[id];
  if (!spec) throw new Error(`No foreground cut named "${id}"`);
  const sources = spec.states === false
    ? [spec.src]
    : STATES.map((state) => spec.src.replace('<state>', state));

  for (const rel of sources) {
    const from = resolve(ASSETS, rel);
    if (!existsSync(from)) continue;
    const to = from.replace(/\.png$/, '-fg.png');
    const { png, kept } = cut(readFileSync(from), spec.shapes);
    writeFileSync(to, png);
    console.log(`${rel.replace(/\.png$/, '-fg.png')}  ${kept} px`);
  }
}

const ids = process.argv.slice(2);
for (const id of ids.length ? ids : Object.keys(CUTS)) run(id);
