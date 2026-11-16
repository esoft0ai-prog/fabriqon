// Rasterises the Fabriqon mark (same geometry as assets/icons/logo.svg) into
// PNG app icons with no dependencies: signed-distance shapes + supersampling
// + a minimal PNG encoder (zlib from Node core).
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');

const NAVY = [22, 35, 63], GOLD = [216, 180, 101], GOLD_DIM = [120, 100, 60], CREAM = [246, 237, 217];

// ---- geometry in the 64-unit logo space ----
const cubic = (p0, p1, p2, p3, n = 24) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n, u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
});
// Thread: M44.5 17.5 c9 3.5 9.5 17 -1 21.5 -8 3.4 -15.5 -2 -13 -8.5 2 -5 9 -4.6 10 0
const thread = [
  ...cubic([44.5, 17.5], [53.5, 21], [54, 34.5], [43.5, 39]),
  ...cubic([43.5, 39], [35.5, 42.4], [28, 37], [30.5, 30.5]),
  ...cubic([30.5, 30.5], [32.5, 25.5], [39.5, 25.9], [40.5, 30.5]),
];
// Dashed arc: M14 46 a22 22 0 0 1 8 -27 (approximate the arc with points)
const arcDots = [];
{
  const cx = 34.2, cy = 37.3, r = 22; // centre of the SVG arc (sweep-flag 1)
  const a0 = Math.atan2(46 - cy, 14 - cx);
  let a1 = Math.atan2(19 - cy, 22 - cx);
  if (a1 < a0) a1 += 2 * Math.PI;
  for (let i = 0; i <= 9; i++) { const a = a0 + (a1 - a0) * (i / 9); arcDots.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
}

const segDist = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
};
const polyDist = (px, py, pts) => {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return d;
};
const roundRect = (px, py, size, r) => {
  const qx = Math.abs(px - size / 2) - (size / 2 - r), qy = Math.abs(py - size / 2) - (size / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

/** Colour at a point in logo space, or null if transparent. */
function shade(x, y, { fullBleed }) {
  if (!fullBleed && roundRect(x, y, 64, 15) > 0) return null;
  let c = NAVY;
  if (arcDots.some(([ax, ay]) => Math.hypot(x - ax, y - ay) < 0.9)) c = GOLD_DIM;
  if (polyDist(x, y, thread) < 1.1) c = CREAM;
  if (segDist(x, y, 17, 49, 45.2, 15.6) < 1.8) c = GOLD;
  if (segDist(x, y, 41.6, 20.2, 45, 16.2) < 0.65) c = NAVY; // needle eye
  if (Math.hypot(x - 17, y - 49) < 1.2) c = CREAM;
  return c;
}

function render(size, { fullBleed = false, scale = 1 } = {}) {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // map pixel -> logo space, applying a centred scale (for maskable safe zone)
          const u = ((i + (sx + 0.5) / SS) / size) * 64;
          const v = ((j + (sy + 0.5) / SS) / size) * 64;
          const lx = 32 + (u - 32) / scale, ly = 32 + (v - 32) / scale;
          let c = shade(lx, ly, { fullBleed: fullBleed || scale !== 1 });
          if (!c && (fullBleed || scale !== 1)) c = NAVY;
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS, k = (j * size + i) * 4;
      const cov = a / n;
      px[k] = cov ? Math.round(r / (a / 255)) : 0;
      px[k + 1] = cov ? Math.round(g / (a / 255)) : 0;
      px[k + 2] = cov ? Math.round(b / (a / 255)) : 0;
      px[k + 3] = Math.round(cov);
    }
  }
  return encodePng(size, size, px);
}

// ---- PNG encoder ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const jobs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-512.png', 512, { scale: 0.78 }], // content inside the 80% safe zone
  ['apple-touch-icon.png', 180, { fullBleed: true }],
  ['favicon-32.png', 32, {}],
];
for (const [name, size, opts] of jobs) {
  writeFileSync(join(out, name), render(size, opts));
  console.log(`wrote assets/icons/${name}`);
}
