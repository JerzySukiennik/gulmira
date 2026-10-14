// Renders inspection images of the baked terrain: full-map hillshade and close-ups.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = path.join(ROOT, 'assets', 'terrain');
const OUT = path.join(ROOT, 'Niepotrzebne', 'terrain-preview');
const meta = JSON.parse(fs.readFileSync(path.join(T, 'meta.json')));
const { N, cell: CELL, size: SIZE } = meta;
const HALF = SIZE / 2;

function decode(file, lo, hi) {
  const u = new Uint16Array(zlib.gunzipSync(fs.readFileSync(path.join(T, file))).buffer.slice(0));
  const out = new Float32Array(N * N);
  const sc = (hi - lo) / 65535;
  for (let j = 0; j < N; j++) { let p = 0; for (let i = 0; i < N; i++) { p = (p + u[j * N + i]) & 0xffff; out[j * N + i] = lo + p * sc; } }
  return out;
}
const H = decode(meta.height.file, meta.height.lo, meta.height.hi);
const S = decode(meta.shadow.file, meta.shadow.lo, meta.shadow.hi);

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
function png(w, h, data) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) data.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const sample = (A, x, z) => {
  const u = Math.min(N - 1.001, Math.max(0, (x + HALF) / CELL)), v = Math.min(N - 1.001, Math.max(0, (z + HALF) / CELL));
  const i = Math.floor(u), j = Math.floor(v), fx = u - i, fz = v - j, k = j * N + i;
  return A[k] * (1 - fx) * (1 - fz) + A[k + 1] * fx * (1 - fz) + A[k + N] * (1 - fx) * fz + A[k + N + 1] * fx * fz;
};

function render(name, cx, cz, span, px, mode) {
  const img = Buffer.alloc(px * px * 3);
  const L = mode === 'top' ? [-0.5, 0.7, -0.5] : meta.sun;
  const ll = Math.hypot(...L);
  const e = Math.max(CELL, span / px);
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
    const x = cx - span / 2 + (i + 0.5) * span / px, z = cz - span / 2 + (j + 0.5) * span / px;
    const h = sample(H, x, z);
    const nx = (sample(H, x - e, z) - sample(H, x + e, z)) / (2 * e), nz = (sample(H, x, z - e) - sample(H, x, z + e)) / (2 * e);
    const nl = Math.hypot(nx, 1, nz);
    let d = Math.max(0, (nx * L[0] + L[1] + nz * L[2]) / (nl * ll));
    if (mode !== 'top') d *= h + 0.6 >= sample(S, x, z) ? 1 : 0.18;
    const shade = mode === 'top' ? 0.15 + 0.85 * d : 0.12 + 1.6 * d;
    const hh = (h - meta.height.lo) / (meta.height.hi - meta.height.lo);
    const o = (j * px + i) * 3;
    img[o] = Math.min(255, shade * (150 + 90 * hh));
    img[o + 1] = Math.min(255, shade * (130 + 70 * hh));
    img[o + 2] = Math.min(255, shade * (105 + 60 * hh));
  }
  fs.writeFileSync(path.join(OUT, name + '.png'), png(px, px, img));
}
const which = process.argv[2] || 'all';
if (which === 'all' || which === 'map') render('map-top', 0, 0, SIZE, 1400, 'top');
if (which === 'all' || which === 'map') render('map-sun', 0, 0, SIZE, 1400, 'sun');
if (which === 'all' || which === 'close') render('village-sun', 400, -600, 4000, 1200, 'sun');
if (which === 'all' || which === 'close') render('village-top', 400, -600, 4000, 1200, 'top');
console.log('ok');
if (which === 'east') render('east-top', 5000, -2500, 7000, 1000, 'top');
