/**
 * make-icons.mjs — build-time PWA icon generation.
 *
 * Writes the manifest icons as real PNGs with no image library: raw RGBA
 * scanlines, zlib-deflated, wrapped in IHDR/IDAT/IEND. The artwork is a
 * torii drawn with rectangles, which is all the fidelity a 192px launcher
 * icon needs.
 *
 *   node tools/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'icons');

const BG = [0x13, 0x13, 0x16];
const RED = [0xe0, 0x52, 0x63];

/* ---------- minimal PNG writer ---------- */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- artwork ---------- */

function drawIcon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const s = (n) => Math.round(n * size);

  // Rounded-square corner radius. Maskable icons are full-bleed — the
  // launcher applies its own mask, so drawing our own corners would
  // double up.
  const radius = maskable ? 0 : s(0.22);
  // Maskable icons must keep their content inside the 80% safe zone.
  const inset = maskable ? 0.12 : 0;

  const inCorner = (x, y) => {
    if (!radius) return true;
    const cx = x < radius ? radius : x >= size - radius ? size - radius - 1 : x;
    const cy = y < radius ? radius : y >= size - radius ? size - radius - 1 : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  };

  // Torii geometry, as fractions of the icon box.
  const k = (v) => v * (1 - inset * 2) + inset;
  const pillarW = s(0.075);
  const pillarTop = s(k(0.30));
  const pillarBottom = s(k(0.80));
  const leftX = s(k(0.29));
  const rightX = s(k(0.71)) - pillarW;

  const kasagiY = s(k(0.245));      // top lintel
  const kasagiH = s(0.055);
  const kasagiL = s(k(0.17));
  const kasagiR = s(k(0.83));

  const shimagiY = kasagiY + kasagiH + s(0.018); // second beam
  const shimagiH = s(0.042);
  const shimagiL = s(k(0.225));
  const shimagiR = s(k(0.775));

  const nukiY = s(k(0.40));         // lower crossbar
  const nukiH = s(0.045);
  const nukiL = s(k(0.235));
  const nukiR = s(k(0.765));

  const box = (x, y, x0, x1, y0, y1) => x >= x0 && x < x1 && y >= y0 && y < y1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      if (!inCorner(x, y)) {
        px[i + 3] = 0; // transparent outside the rounded square
        continue;
      }

      const isRed =
        box(x, y, leftX, leftX + pillarW, pillarTop, pillarBottom) ||
        box(x, y, rightX, rightX + pillarW, pillarTop, pillarBottom) ||
        box(x, y, kasagiL, kasagiR, kasagiY, kasagiY + kasagiH) ||
        box(x, y, shimagiL, shimagiR, shimagiY, shimagiY + shimagiH) ||
        box(x, y, nukiL, nukiR, nukiY, nukiY + nukiH);

      const [r, g, b] = isRed ? RED : BG;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }

  return encodePNG(size, size, px);
}

/* ---------- run ---------- */

mkdirSync(OUT, { recursive: true });

const targets = [
  ['icon-180.png', 180, {}],
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
];

for (const [name, size, opts] of targets) {
  const png = drawIcon(size, opts);
  writeFileSync(resolve(OUT, name), png);
  console.log(`  ${name.padEnd(24)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log('Icons written to icons/');
