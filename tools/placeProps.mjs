/**
 * placeProps.mjs
 * Stamp free-standing props (tools/props.mjs) into a room's state renders.
 *
 * A prop has to end up in TWO places: in the base render, so an empty room
 * still has its furniture, and in the foreground cut, so a figure stands
 * behind it. cutForeground only ever copies — it never invents a pixel — so
 * the prop must be in the render first. This is that first step; the cut
 * recipe in cutForeground.mjs then lifts the same rectangles back out.
 *
 *   node tools/placeProps.mjs [room ...]
 *
 * Idempotent: it always stamps onto <room>-<state>-clean.png, the render as it
 * came back from the generator, and overwrites <room>-<state>.png. Re-running
 * after moving a prop cannot pile one stamp on top of another.
 *
 * A prop is drawn once, in the lit room's colours. The unpowered and broken
 * renders are separate generations with their own, darker palettes, so a lit
 * prop dropped into them would sit on the wall like a sticker. Each state
 * therefore gets the prop mapped through that state's own light: the render
 * tells us what this room does to every one of its colours (the same
 * measurement probe/v23's dim.py makes), and the prop is put through it.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from './png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(ROOT, 'resources/assets');

const STATES = ['on', 'off', 'broken', 'dim'];

/**
 * Where the furniture goes. `x` is the prop's LEFT edge and every prop stands
 * on `floorY`, the room's own floor line — the same row manifest.json gives
 * the room, so a prop and a figure share one ground plane by construction.
 *
 * The stools are on the seat pitch the room art declares (manifest `seats`),
 * offset by half a stool, so the person the renderer puts in seat n is the
 * person standing behind stool n.
 */
// Fourteen seats on a 23-px pitch, from the left wall to the lectern's elbow.
// The stool is 15 wide, so the row is nearly shoulder to shoulder — a full
// house, not a handful of chairs.
export const SEAT_PITCH = Array.from({ length: 14 }, (_, n) => 33 + n * 23);
const LECTERN_X = 346;

const PLACEMENTS = {
  auditorium: {
    src: 'sprites/buildings/auditorium-<state>.png',
    floorY: 93,
    props: [
      { prop: 'auditorium-lectern', x: LECTERN_X },
      ...SEAT_PITCH.map((centre) => ({ prop: 'auditorium-stool', x: centre - 7 })),
    ],
  },
};

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * How this state's render darkens each colour of the lit one.
 *
 * Built by pairing the two renders pixel for pixel: for every colour in the
 * lit room, the median brightness ratio of what the other render put in those
 * same places. That is a measurement of the room's light, not a guess about
 * it — a lamp glass drops to a fifth, a wall already in shadow barely moves —
 * so a prop put through it is lit the way the room around it is lit.
 *
 * @returns {(rgb: number[]) => number[]} lit colour -> this state's colour.
 */
function lightOf(lit, state) {
  const buckets = new Map();
  for (let i = 0; i < lit.width * lit.height; i++) {
    const o = i * 4;
    const key = (lit.pixels[o] << 16) | (lit.pixels[o + 1] << 8) | lit.pixels[o + 2];
    const before = Math.max(lum(lit.pixels[o], lit.pixels[o + 1], lit.pixels[o + 2]), 1);
    const after = lum(state.pixels[o], state.pixels[o + 1], state.pixels[o + 2]);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(Math.min(1, after / before));
  }

  const ratios = new Map();
  for (const [key, list] of buckets) {
    list.sort((a, b) => a - b);
    ratios.set(key, list[list.length >> 1]);
  }

  // The colours this state actually uses. The dimmed prop is snapped to the
  // nearest of them, so stamping cannot widen a render's palette — the whole
  // point of computing a dim frame rather than generating one (probe/v23).
  const palette = new Set();
  for (let i = 0; i < state.width * state.height; i++) {
    const o = i * 4;
    palette.add((state.pixels[o] << 16) | (state.pixels[o + 1] << 8) | (state.pixels[o + 2]));
  }

  const nearest = (r, g, b, among) => {
    let best = Infinity;
    let pick = null;
    for (const key of among) {
      const dr = r - (key >> 16);
      const dg = g - ((key >> 8) & 0xff);
      const db = b - (key & 0xff);
      const d = dr * dr + dg * dg + db * db;
      if (d < best) {
        best = d;
        pick = key;
      }
    }
    return pick;
  };

  // A prop colour the lit room does not itself contain borrows the ratio of the
  // nearest colour it does, which is why the props are painted from the room's
  // own timber in the first place — there the match is exact.
  return ([r, g, b]) => {
    const key = (r << 16) | (g << 8) | b;
    const ratio = ratios.get(key) ?? ratios.get(nearest(r, g, b, ratios.keys()));
    const dimmed = [r, g, b].map((v) => Math.round(v * ratio));
    const snapped = nearest(dimmed[0], dimmed[1], dimmed[2], palette);
    return [snapped >> 16, (snapped >> 8) & 0xff, snapped & 0xff];
  };
}

/** Draw `prop` onto `image` with its left edge at x and its bottom row on floorY. */
function stamp(image, prop, x, floorY, light) {
  const top = floorY - prop.height + 1;
  for (let py = 0; py < prop.height; py++) {
    for (let px = 0; px < prop.width; px++) {
      const from = (py * prop.width + px) * 4;
      if (prop.pixels[from + 3] === 0) continue;
      const X = x + px;
      const Y = top + py;
      if (X < 0 || Y < 0 || X >= image.width || Y >= image.height) continue;
      const to = (Y * image.width + X) * 4;
      const [r, g, b] = light([prop.pixels[from], prop.pixels[from + 1], prop.pixels[from + 2]]);
      image.pixels[to] = r;
      image.pixels[to + 1] = g;
      image.pixels[to + 2] = b;
      image.pixels[to + 3] = 255;
    }
  }
}

/** Decode every distinct prop a placement uses, once. */
function load(spec) {
  const props = new Map();
  for (const { prop } of spec.props) {
    if (props.has(prop)) continue;
    props.set(prop, decode(readFileSync(resolve(ASSETS, `sprites/props/${prop}.png`))));
  }
  return props;
}

/**
 * Each stamped prop as a cutForeground shape: the prop's own silhouette, at
 * the position it was stamped.
 *
 * A bounding rectangle would not do. The gap between a stool's legs is wall,
 * and lifting that into the foreground would hang a rectangle of wall in front
 * of whoever is sitting there. The stencil is the prop's alpha, so exactly the
 * pixels placeProps wrote are the pixels cutForeground lifts.
 *
 * Exported so the cut is derived from the placement rather than measured off
 * the result: move a stool here and its foreground moves with it, instead of
 * quietly leaving behind a stool that figures walk straight through.
 */
export function propStencils(room) {
  const spec = PLACEMENTS[room];
  if (!spec) throw new Error(`No prop placement named "${room}"`);
  const props = load(spec);
  return spec.props.map(({ prop, x }) => {
    const image = props.get(prop);
    return { stencil: image, at: [x, spec.floorY - image.height + 1] };
  });
}

function run(room) {
  const spec = PLACEMENTS[room];
  if (!spec) throw new Error(`No prop placement named "${room}"`);
  const props = load(spec);

  const cleanOf = (state) => resolve(ASSETS, spec.src.replace('<state>', `${state}-clean`));
  const lit = decode(readFileSync(cleanOf('on')));

  for (const state of STATES) {
    const from = cleanOf(state);
    if (!existsSync(from)) continue;
    const image = decode(readFileSync(from));
    const light = state === 'on' ? (rgb) => rgb : lightOf(lit, image);
    for (const { prop, x } of spec.props) stamp(image, props.get(prop), x, spec.floorY, light);
    const to = resolve(ASSETS, spec.src.replace('<state>', state));
    writeFileSync(to, encode(image.width, image.height, image.pixels));
    console.log(`${spec.src.replace('<state>', state)}  ${spec.props.length} props on row ${spec.floorY}`);
  }
}

// Only when run directly: cutForeground.mjs imports propRects from here.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rooms = process.argv.slice(2);
  for (const room of rooms.length ? rooms : Object.keys(PLACEMENTS)) run(room);
}
