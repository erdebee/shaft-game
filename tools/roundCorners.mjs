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
import { deflateSync, inflateSync } from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

/* ---- PNG, 8-bit RGBA only. Enough for what PixelLab returns. ---- */

function decode(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('Not a PNG');

  let width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG: depth ${bitDepth}, colour type ${colorType}`);
  }

  const src = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * src;
  const out = Buffer.alloc(width * height * 4, 255);
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);

  let o = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[o++];
    raw.copy(line, 0, o, o + stride);
    o += stride;
    unfilter(filter, line, prev, src);
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      out[d] = line[x * src];
      out[d + 1] = line[x * src + 1];
      out[d + 2] = line[x * src + 2];
      out[d + 3] = src === 4 ? line[x * src + 3] : 255;
    }
    line.copy(prev);
  }
  return { width, height, pixels: out };
}

function unfilter(filter, line, prev, bpp) {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    if (filter === 1) line[i] = (line[i] + a) & 255;
    else if (filter === 2) line[i] = (line[i] + b) & 255;
    else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
    else if (filter === 4) {
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
}

function encode(width, height, pixels) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    pixels.copy(raw, o, y * width * 4, (y + 1) * width * 4);
    o += width * 4;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
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

const [file, radius] = process.argv.slice(2);
if (file) {
  writeFileSync(file, roundCorners(readFileSync(file), Number(radius) || 8));
  console.log(`rounded: ${file} (r=${Number(radius) || 8})`);
}
