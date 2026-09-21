/**
 * palettePng.mjs
 * Emits the locked asset palette as a PNG.
 *
 * Pixel art bakes colour into the asset, so tokens.css can no longer recolour a
 * sprite the way it recolours the placeholder SVG sheet. The palette therefore
 * stops being purely a stylesheet concern and becomes a GENERATION-TIME
 * CONTRACT: this PNG is passed to every PixelLab call, which constrains the
 * output to these colours.
 *
 * tokens.css stays the single authority. This script reads it rather than
 * carrying its own copy of the palette, because two sources of truth for colour
 * is exactly how forty assets drift apart.
 *
 * Zero dependencies — a PNG is a signature, three chunks and a CRC, and zlib is
 * in the standard library. Matches the project's no-dependency stance.
 *
 *   node tools/palettePng.mjs
 *
 * Bump PALETTE_VERSION whenever the colours change. Assets generated against an
 * older version are regenerated; mixing versions in one frame is visible
 * immediately and is worse than either version alone.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PALETTE_VERSION = 3;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = resolve(ROOT, 'src/ui/styles/tokens.css');
const outFor = (band) => resolve(ROOT, `resources/assets/palette-v${PALETTE_VERSION}-${band}.png`);

/** The depth bands, matching levels.json. */
export const BANDS = ['deep', 'mid', 'shallow'];

/** Swatch geometry. Big enough to eyeball, small enough to stay a few hundred bytes. */
const SWATCH = 16;
const COLUMNS = 8;

/**
 * The token-name lists declared as --sprite-core and --sprite-<band>.
 *
 * Sprites are forced to a SUBSET of the palette — 16 colours per band — rather
 * than the whole token set, because the full set carries UI-only colours the art
 * must not reach for, and because 16 is the chosen look (see tokens.css).
 */
export function readSpritePalette(band, cssPath = TOKENS) {
  const css = readFileSync(cssPath, 'utf8');
  const names = (prop) => {
    const m = css.match(new RegExp(`--${prop}:\\s*([^;]+);`));
    if (!m) throw new Error(`--${prop} not declared in ${cssPath}`);
    return m[1].split(',').map((n) => n.trim()).filter(Boolean);
  };

  const wanted = [...names('sprite-core'), ...names(`sprite-${band}`)];
  const all = readPalette(cssPath);

  return wanted.map((name) => {
    const hit = all.find((c) => c.name === name);
    // Fail loudly: a typo here would silently drop a colour from every asset
    // generated against this palette.
    if (!hit) throw new Error(`--sprite-${band} references --${name}, which is not a colour token`);
    return hit;
  });
}

/**
 * Every colour-valued custom property in the base :root block, in source order.
 *
 * Only the base block: the [data-chapter="2"] overrides are a grade applied over
 * the same assets, not a second palette to generate against (see
 * concept/visual-design-principles.md §9).
 */
export function readPalette(cssPath = TOKENS) {
  const css = readFileSync(cssPath, 'utf8');
  const base = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!base) throw new Error(`No :root block in ${cssPath}`);

  const colours = [];
  for (const [, name, value] of base[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    colours.push({ name, rgb: toRgb(value) });
  }
  if (colours.length === 0) throw new Error('No colour tokens found');
  return colours;
}

function toRgb(hex) {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** 8-bit truecolour PNG from a pixel-fetching callback. */
export function encodePng(width, height, pixelAt) {
  // One filter byte (0 = None) per scanline, then RGB triples.
  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelAt(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour
  // 10..12 are compression, filter and interlace methods — all 0.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function buildPalettePng(colours) {
  const rows = Math.ceil(colours.length / COLUMNS);
  const width = COLUMNS * SWATCH;
  const height = rows * SWATCH;

  return encodePng(width, height, (x, y) => {
    const index = Math.floor(y / SWATCH) * COLUMNS + Math.floor(x / SWATCH);
    // Trailing cells on the last row repeat the darkest colour rather than
    // introducing a black that is not in the palette.
    return (colours[index] ?? colours[0]).rgb;
  });
}

// Only when run directly — rockTile.mjs imports readPalette/encodePng from here,
// and an import must not write files or print.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const band of BANDS) {
    const colours = readSpritePalette(band);
    const out = outFor(band);
    writeFileSync(out, buildPalettePng(colours));
    console.log(`v${PALETTE_VERSION} ${band}: ${colours.length} colours -> ${out.replace(ROOT + '/', '')}`);
  }
}
