/**
 * roundCorners.mjs
 * Knock the corners out of a framed room sprite.
 *
 * A room is drawn as a rounded-rectangle card (see
 * concept/asset-production-spec.md §2.1), but the generator returns a square
 * image: the pixels outside the rounded frame come back filled with whatever
 * colour the model chose. Left alone they show as four hard corner blocks
 * sitting on top of the rock.
 *
 * This makes those pixels transparent, so the rock behind shows through at the
 * corners — which is the one place in a room sprite where transparency is
 * correct (the built envelope is opaque everywhere else).
 *
 * Deterministic and lossless: it only ever writes alpha 0, never a colour. Run
 * it again on its own output and nothing changes.
 *
 *   node tools/roundCorners.mjs <file.png> [radius]
 *
 * Radius defaults to 8px, matching the frame's own corner curve at 1x.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { decode, encode } from './png.mjs';

export function roundCorners(png, radius = 8) {
  const { width, height, pixels } = decode(png);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (insideRoundedRect(x, y, width, height, radius)) continue;
      pixels[(y * width + x) * 4 + 3] = 0;
    }
  }
  return encode(width, height, pixels);
}

/**
 * Pixel-centre test against a rounded rectangle. Corners are quarter-circles of
 * `radius`; everywhere else is inside. No anti-aliasing on purpose — a soft
 * edge would put non-palette colours into the sprite.
 */
function insideRoundedRect(x, y, w, h, r) {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const nx = cx < r ? r - cx : cx > w - r ? cx - (w - r) : 0;
  const ny = cy < r ? r - cy : cy > h - r ? cy - (h - r) : 0;
  return nx * nx + ny * ny <= r * r;
}

const [file, radius] = process.argv.slice(2);
if (file) {
  writeFileSync(file, roundCorners(readFileSync(file), Number(radius) || 8));
  console.log(`rounded: ${file} (r=${Number(radius) || 8})`);
}
