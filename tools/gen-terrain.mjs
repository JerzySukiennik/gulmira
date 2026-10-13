// Gulmira terrain baker: multi-scale design + hydraulic erosion + sun-shadow heights + splat.
// node --max-old-space-size=8000 tools/gen-terrain.mjs  ->  assets/terrain/{height.bin.gz, shadow.bin.gz, splat.png, meta.json}
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'terrain');
const PREVIEW = path.join(ROOT, 'Niepotrzebne', 'terrain-preview');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PREVIEW, { recursive: true });

const N = 4096;
const SIZE = 20480;
const CELL = SIZE / N;
const HALF = SIZE / 2;
const MN = 1024;
const MCELL = SIZE / MN;
const SUN_AZ = 255 * Math.PI / 180;
const SUN_EL = 8 * Math.PI / 180;
const SUN = [Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL)];

const SITES = {
  village: { x: 0, z: 0, r: 430 },
  cache: { x: 2650, z: -2350, r: 190 },
  canyonMouth: { x: 1150, z: -1250 },
  aa: { x: 880, z: 4300, r: 28 },
  start: { x: 1400, y: 700, z: 9300 },
};

// ---------------------------------------------------------------- noise
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1337);
const perm = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const G2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const F2 = 0.5 * (Math.sqrt(3) - 1), G2c = (3 - Math.sqrt(3)) / 6;
function simplex(xin, yin) {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2c;
  const x0 = xin - (i - t), y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2c, y1 = y0 - j1 + G2c;
  const x2 = x0 - 1 + 2 * G2c, y2 = y0 - 1 + 2 * G2c;
  const ii = i & 255, jj = j & 255;
  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) { const g = G2[perm[ii + perm[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) { const g = G2[perm[ii + i1 + perm[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) { const g = G2[perm[ii + 1 + perm[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
  return 70 * n;
}
function fbm(x, y, oct, lac = 2.03, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let o = 0; o < oct; o++) { s += a * simplex(x * f + o * 17.3, y * f - o * 9.1); n += a; a *= gain; f *= lac; }
  return s / n;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- layout
const valleyX0 = z => 520 * Math.sin((z + 1500) / 4200) + 230 * Math.sin(z / 1700 + 0.8);
const valleyX = z => valleyX0(z) - valleyX0(0) - 160;
const floorY = z => 40 - z * 0.0045;
const halfW = z => 1350 + 350 * Math.sin(z / 2900 + 0.4);
const wadiX = z => valleyX(z) - 360 + 110 * Math.sin(z / 640) + 45 * Math.sin(z / 230);
const edgeNorm = (x, z) => Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(z), 4), 0.25) / HALF;

function catmull(pts, seg) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < seg; s++) {
      const t = s / seg, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const CANYON = catmull([[700, -900], [SITES.canyonMouth.x, SITES.canyonMouth.z], [1480, -1420], [1720, -1780], [2080, -1930], [2380, -2190], [SITES.cache.x, SITES.cache.z]], 10);

function distToPolyline(x, z, pts) {
  let best = 1e9, bt = 0, acc = 0, total = 0;
  const lens = [];
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); lens.push(l); total += l; }
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
    let t = ((x - ax) * vx + (z - az) * vz) / l2; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) { best = d; bt = (acc + t * lens[i]) / total; }
    acc += lens[i];
  }
  return [best, bt];
}

function roadSouth() {
  const pts = [];
  for (let z = 10240; z >= 420; z -= 160) pts.push([valleyX(z) + 230 + 60 * Math.sin(z / 900), z]);
  pts.push([40, 330]);
  return pts;
}
const ROADS = [
  roadSouth(),
  catmull([[300, -40], [620, -420], [880, -760], [SITES.canyonMouth.x, SITES.canyonMouth.z], [1480, -1420], [1720, -1780], [2080, -1930], [2380, -2190], [SITES.cache.x - 60, SITES.cache.z + 40]], 8),
  catmull([[-250, -300], [-500, -1200], [-560, -2600], [-420, -4200], [-600, -6200], [-500, -9000]], 8),
];

let VILLAGE_BASE = floorY(0) + 4;
function villageY(x, z) { return VILLAGE_BASE + 0.022 * x - 0.008 * z + 1.6 * fbm(x / 90, z / 90, 3); }
function canyonFloor(t, x, z) { return lerp(floorY(SITES.canyonMouth.z) + 4, floorY(SITES.cache.z) + 34, t) + 0.8 * fbm(x / 60, z / 60, 2); }

// ---------------------------------------------------------------- macro relief (1024², 20 m)
function macro(x, z) {
  const vx = valleyX(z);
  const side = x - vx;
  const d = Math.abs(side);
  const W = halfW(z);
  const west = side < 0;
  const t = smooth(W * 0.5, W * (west ? 3.0 : 2.0), d);
  const e = edgeNorm(x, z);
  const qx = x + 1100 * fbm(x / 5200 + 11, z / 5200, 3), qz = z + 1100 * fbm(x / 5200, z / 5200 - 7, 3);
  const n = fbm(qx / 2800, qz / 2800, 6) * 0.5 + 0.5;
  const uplift = Math.pow(t, 1.4) * (west ? 360 : 1150) * (1 + 1.1 * smooth(0.6, 0.95, e)) + smooth(0.8, 0.99, e) * 650;
  let h = floorY(z) + uplift * (0.3 + 0.7 * Math.pow(n, 1.25));
  const roll = fbm(x / 1300 + 4, z / 1300, 4) * 0.5 + 0.5;
  h += roll * roll * (west ? 50 : 80) * (1 - 0.4 * t);
  return h;
}

// ---------------------------------------------------------------- erosion
function erode(H, n, cell, drops, life, R, seed, opts = {}) {
  const E = opts.E, D = opts.D, F = opts.F;
  for (let i = 0; i < n * n; i++) H[i] /= cell;
  const maxDig = (opts.maxDig ?? 1e9) / cell;
  const H0 = Float32Array.from(H);
  const brushIdx = [], brushW = [];
  let wsum = 0;
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
    const d = Math.hypot(x, y);
    if (d <= R) { brushIdx.push(y * n + x); const w = 1 - d / (R + 0.5); brushW.push(w); wsum += w; }
  }
  const BI = Int32Array.from(brushIdx), BW = Float32Array.from(brushW.map(w => w / wsum));
  const inertia = opts.inertia ?? 0.05, capF = opts.capF ?? 4, minCap = 0.01, erodeS = opts.erodeS ?? 0.3, depositS = opts.depositS ?? 0.3, evap = opts.evap ?? 0.012, grav = 4;
  const r = mulberry32(seed);
  const m = R + 2;
  for (let k = 0; k < drops; k++) {
    let x = m + r() * (n - 2 * m), y = m + r() * (n - 2 * m);
    let dx = 0, dy = 0, speed = 1, water = 1, sed = 0;
    for (let l = 0; l < life; l++) {
      const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy, idx = iy * n + ix;
      const a = H[idx], b = H[idx + 1], c = H[idx + n], d = H[idx + n + 1];
      const gx = (b - a) * (1 - fy) + (d - c) * fy;
      const gy = (c - a) * (1 - fx) + (d - b) * fx;
      const h0 = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
      dx = dx * inertia - gx * (1 - inertia);
      dy = dy * inertia - gy * (1 - inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) break;
      dx /= len; dy /= len;
      x += dx; y += dy;
      if (x < m || y < m || x > n - m - 1 || y > n - m - 1) break;
      const jx = x | 0, jy = y | 0, gx2 = x - jx, gy2 = y - jy, j2 = jy * n + jx;
      const h1 = H[j2] * (1 - gx2) * (1 - gy2) + H[j2 + 1] * gx2 * (1 - gy2) + H[j2 + n] * (1 - gx2) * gy2 + H[j2 + n + 1] * gx2 * gy2;
      const dh = h1 - h0;
      const cap = Math.max(-dh * speed * water * capF, minCap);
      if (sed > cap || dh > 0) {
        const dep = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depositS;
        sed -= dep;
        H[idx] += dep * (1 - fx) * (1 - fy); H[idx + 1] += dep * fx * (1 - fy);
        H[idx + n] += dep * (1 - fx) * fy; H[idx + n + 1] += dep * fx * fy;
        if (D) D[idx] += dep;
      } else {
        const er = Math.min((cap - sed) * erodeS, -dh);
        for (let q = 0; q < BI.length; q++) {
          const t = idx + BI[q];
          const w = Math.min(er * BW[q], H[t] - (H0[t] - maxDig));
          if (w <= 0) continue;
          H[t] -= w; if (E) E[t] += w;
          sed += w;
        }
      }
      if (F) F[idx] += water;
      speed = Math.sqrt(Math.max(0, speed * speed - dh * grav));
      water *= 1 - evap;
      if (water < 0.02) break;
    }
  }
  for (let i = 0; i < n * n; i++) H[i] *= cell;
}

function thermal(H, n, cell, talusSlope, iters) {
  const talus = talusSlope * cell;
  for (let it = 0; it < iters; it++) {
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = j * n + i, h = H[k];
      let lo = k, md = 0;
      let q = k - 1, dd = h - H[q]; if (dd > md) { md = dd; lo = q; }
      q = k + 1; dd = h - H[q]; if (dd > md) { md = dd; lo = q; }
      q = k - n; dd = h - H[q]; if (dd > md) { md = dd; lo = q; }
      q = k + n; dd = h - H[q]; if (dd > md) { md = dd; lo = q; }
      if (md > talus) { const m = (md - talus) * 0.25; H[k] -= m; H[lo] += m; }
    }
  }
}

function boxBlur(src, n, rad) {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    let s = 0; const row = j * n;
    for (let i = -rad; i <= rad; i++) s += src[row + Math.min(n - 1, Math.max(0, i))];
    for (let i = 0; i < n; i++) {
      tmp[row + i] = s / (2 * rad + 1);
      s += src[row + Math.min(n - 1, i + rad + 1)] - src[row + Math.max(0, i - rad)];
    }
  }
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -rad; j <= rad; j++) s += tmp[Math.min(n - 1, Math.max(0, j)) * n + i];
    for (let j = 0; j < n; j++) {
      out[j * n + i] = s / (2 * rad + 1);
      s += tmp[Math.min(n - 1, j + rad + 1) * n + i] - tmp[Math.max(0, j - rad) * n + i];
    }
  }
  return out;
}

function stat(name, A) { let lo = 1e9, hi = -1e9, li = 0; for (let i = 0; i < A.length; i++) { if (A[i] < lo) { lo = A[i]; li = i; } if (A[i] > hi) hi = A[i]; } const n = Math.round(Math.sqrt(A.length)); console.log(name, lo.toFixed(1), hi.toFixed(1), 'min at', li % n, Math.floor(li / n)); }
// ---------------------------------------------------------------- 1. macro + big erosion
console.time('macro');
const HM = new Float32Array(MN * MN);
for (let j = 0; j < MN; j++) for (let i = 0; i < MN; i++) HM[j * MN + i] = macro(-HALF + i * MCELL, -HALF + j * MCELL);
erode(HM, MN, MCELL, 900000, 90, 3, 7, { maxDig: 140, capF: 5, erodeS: 0.35, depositS: 0.2, evap: 0.008, inertia: 0.08 });
thermal(HM, MN, MCELL, 1.1, 6);
console.timeEnd('macro');
stat('macro', HM); if (process.env.STAGE === 'macro') process.exit(0);

// ---------------------------------------------------------------- 2. upsample + detail + features
console.time('detail');
const H = new Float32Array(N * N);
const cubic = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
const KNOB_CELL = 330;
const knobList = [];
for (let gz = Math.floor(-HALF / KNOB_CELL) - 1; gz <= HALF / KNOB_CELL + 1; gz++) for (let gx = Math.floor(-HALF / KNOB_CELL) - 1; gx <= HALF / KNOB_CELL + 1; gx++) {
  const r = mulberry32((gx * 73856093) ^ (gz * 19349663));
  if (r() > 0.58) continue;
  const px = (gx + 0.15 + r() * 0.7) * KNOB_CELL, pz = (gz + 0.15 + r() * 0.7) * KNOB_CELL;
  if (Math.hypot(px, pz) < SITES.village.r + 160) continue;
  const rk = 55 + r() * 125;
  knobList.push({ x: px, z: pz, rk, hk: 10 + r() * 52 * (rk / 180), ex: 0.65 + r() * 0.7, ang: r() * Math.PI });
}
const knobGrid = new Map();
for (const k of knobList) {
  const key = `${Math.floor(k.x / KNOB_CELL)},${Math.floor(k.z / KNOB_CELL)}`;
  if (!knobGrid.has(key)) knobGrid.set(key, []);
  knobGrid.get(key).push(k);
}
function knobs(x, z) {
  const cx = Math.floor(x / KNOB_CELL), cz = Math.floor(z / KNOB_CELL);
  let h = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const list = knobGrid.get(`${cx + dx},${cz + dz}`);
    if (!list) continue;
    for (const k of list) {
      const ux = x - k.x, uz = z - k.z;
      const c = Math.cos(k.ang), s = Math.sin(k.ang);
      const rx = (ux * c + uz * s) * k.ex, rz = (-ux * s + uz * c) / k.ex;
      const d = Math.sqrt(rx * rx + rz * rz) / k.rk;
      if (d < 1) h = Math.max(h, k.hk * Math.pow(1 - d * d, 1.3));
    }
  }
  return h;
}
for (let j = 0; j < N; j++) {
  const z = -HALF + j * CELL;
  const v = j * CELL / MCELL, mj = Math.floor(v), fz = v - mj;
  const W = halfW(z), vx = valleyX(z), wx = wadiX(z);
  for (let i = 0; i < N; i++) {
    const x = -HALF + i * CELL;
    const u = i * CELL / MCELL, mi = Math.floor(u), fx = u - mi;
    const row = (jj) => {
      const r = Math.min(MN - 1, Math.max(0, jj)) * MN;
      const c = (ii) => HM[r + Math.min(MN - 1, Math.max(0, ii))];
      return cubic(c(mi - 1), c(mi), c(mi + 1), c(mi + 2), fx);
    };
    let h = cubic(row(mj - 1), row(mj), row(mj + 1), row(mj + 2), fz);
    const side = x - vx, d = Math.abs(side);
    const t = smooth(W * 0.5, W * (side < 0 ? 3.0 : 2.0), d);
    const rough = 0.25 + 0.75 * t;
    h += fbm(x / 260, z / 260, 5) * (8 + 14 * t * t) * rough;
    const rr = 1 - Math.abs(fbm(x / 900 + 9, z / 900 - 4, 3));
    h += rr * rr * 55 * t * t;
    h += fbm(x / 70, z / 70, 4) * (1.2 + 3 * t);
    h += fbm(x / 18, z / 18, 2) * (0.25 + 0.8 * t);
    const kn = knobs(x, z) * (1 - smooth(0.15, 0.6, t));
    if (kn > 0) h += kn * (1 + 0.22 * fbm(x / 26, z / 26, 3));
    const wd = Math.abs(x - wx);
    const ww = 34 + 14 * Math.sin(z / 900);
    h -= 5 * (1 - smooth(ww * 0.35, ww, wd)) * (1 - smooth(0.2, 0.45, t));
    H[j * N + i] = h;
  }
}
console.timeEnd('detail');
{
  let acc = 0, cnt = 0;
  for (let a = 0; a < 64; a++) {
    const x = Math.cos(a / 64 * Math.PI * 2) * SITES.village.r, z = Math.sin(a / 64 * Math.PI * 2) * SITES.village.r;
    const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL);
    acc += H[j * N + i] - (0.022 * x - 0.008 * z); cnt++;
  }
  VILLAGE_BASE = acc / cnt + 1.5;
  console.log('village base', VILLAGE_BASE.toFixed(1));
}
stat('detail', H);

// ---------------------------------------------------------------- 3. carve sites before fine erosion
function carveSites(Hh, strength) {
  for (let j = 0; j < N; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * CELL, k = j * N + i;
      let h = Hh[k];
      const vr = Math.hypot(x - SITES.village.x, z - SITES.village.z);
      if (vr < SITES.village.r) h = lerp(h, villageY(x, z), (1 - smooth(SITES.village.r * 0.62, SITES.village.r * 0.97, vr)) * strength);
      if (Math.abs(x - 1800) < 1700 && Math.abs(z + 1700) < 1500) {
        const edge = smooth(0, 250, Math.min(1700 - Math.abs(x - 1800), 1500 - Math.abs(z + 1700)));
        const [cdRaw, ct] = distToPolyline(x, z, CANYON);
        const cd = cdRaw + 14 * fbm(x / 70, z / 70, 3);
        const cr = Math.hypot((x - SITES.cache.x) * 0.82, (z - SITES.cache.z) * 1.15) + 45 * fbm(x / 140 + 5, z / 140, 3);
        const halfFloor = 42 + 14 * Math.sin(ct * 19) + 8 * fbm(ct * 9, 3.3, 2);
        const bowl = Math.min(cd - halfFloor, cr - SITES.cache.r);
        const floor = canyonFloor(ct, x, z);
        const rough = 6 * fbm(x / 35, z / 35, 3);
        const profile = (b, k) => b * k + b * b / 420;
        let target = floor + (bowl > 0 ? profile(bowl, 1.05 + 0.35 * fbm(x / 160 + 3, z / 160, 2)) + rough * smooth(0, 25, bowl) : 0);
        const hl = Math.hypot(SUN[0], SUN[2]), sx = SUN[0] / hl, sz = SUN[2] / hl;
        const dx = x - SITES.cache.x, dz = z - SITES.cache.z;
        const along = dx * sx + dz * sz;
        if (along > -100) {
          const lat = Math.abs(dz * sx - dx * sz) + 40 * fbm(x / 200, z / 200 + 7, 3);
          const bw = lat - (170 + Math.max(0, along) * 0.1);
          const wFloor = canyonFloor(1, SITES.cache.x, SITES.cache.z) + Math.max(0, along) * 0.012 + 1.5 * fbm(x / 80, z / 80, 2);
          target = Math.min(target, wFloor + (bw > 0 ? profile(bw, 0.55 + 0.25 * fbm(x / 120, z / 120 + 2, 2)) + rough * smooth(0, 25, bw) : 0));
        }
        if (target < h) h = lerp(h, target, strength * edge);
        if (bowl < 0) h = lerp(h, floor, strength * edge);
      }
      const ar = Math.hypot(x - SITES.aa.x, z - SITES.aa.z);
      const aTop = floorY(SITES.aa.z) + 78;
      if (ar < 280) {
        const knob = aTop - Math.pow(Math.max(0, ar - SITES.aa.r) / 252, 1.5) * 76 + (ar > SITES.aa.r ? 4 * fbm(x / 30, z / 30, 3) : 0);
        h = Math.max(h, lerp(h, knob, strength));
        if (ar < SITES.aa.r) h = lerp(h, aTop, strength);
      }
      Hh[k] = h;
    }
  }
}
console.time('sites1');
carveSites(H, 1);
console.timeEnd('sites1');

// ---------------------------------------------------------------- 4. fine erosion
console.time('erosion');
const E = new Float32Array(N * N), D = new Float32Array(N * N), F = new Float32Array(N * N);
erode(H, N, CELL, 2400000, 56, 2, 99, { maxDig: 14, E, D, F, capF: 3.5, erodeS: 0.25, depositS: 0.22, evap: 0.015, inertia: 0.06 });
thermal(H, N, CELL, 1.5, 3);
console.timeEnd('erosion');
stat('erosion', H);

// ---------------------------------------------------------------- 5. re-impose sites and roads
console.time('sites2');
carveSites(H, 0.85);
const RD = new Float32Array(N * N);
{
  const smoothH = boxBlur(H, N, 5);
  for (const road of ROADS) {
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (const [x, z] of road) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    const i0 = Math.max(0, Math.floor((minx - 40 + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((maxx + 40 + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((minz - 40 + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((maxz + 40 + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const [d] = distToPolyline(x, z, road);
      if (d > 26) continue;
      const k = j * N + i;
      const m = 1 - smooth(5, 22, d);
      H[k] = lerp(H[k], smoothH[k] - 0.15, m);
      RD[k] = Math.max(RD[k], 1 - smooth(2.6, 5.5, d + 1.2 * fbm(x / 9, z / 9, 2)));
    }
  }
}
console.timeEnd('sites2');

// ---------------------------------------------------------------- 6. sun shadow heights (column sweep toward the sun)
console.time('shadow');
let minH = 1e9, maxH = -1e9;
for (let i = 0; i < N * N; i++) { if (H[i] < minH) minH = H[i]; if (H[i] > maxH) maxH = H[i]; }
const S = new Float32Array(H);
{
  const hl = Math.hypot(SUN[0], SUN[2]);
  const ux = SUN[0] / hl, uz = SUN[2] / hl;
  const tanEl = SUN[1] / hl;
  const stepT = 1.5;
  const ox = ux * stepT, oz = uz * stepT;
  const drop = stepT * CELL * tanEl;
  if (Math.abs(ux) < 0.67) throw new Error('sun too far from the x axis for the column sweep');
  const order = ux < 0 ? [...Array(N).keys()] : [...Array(N).keys()].reverse();
  for (const i of order) {
    const sx = i + ox;
    if (sx < 0 || sx > N - 2) continue;
    const ix = Math.floor(sx), fx = sx - ix;
    for (let j = 0; j < N; j++) {
      const sz = j + oz;
      if (sz < 0 || sz > N - 2) continue;
      const iz = Math.floor(sz), fz = sz - iz, k = iz * N + ix;
      const prev = S[k] * (1 - fx) * (1 - fz) + S[k + 1] * fx * (1 - fz) + S[k + N] * (1 - fx) * fz + S[k + N + 1] * fx * fz;
      const v = prev - drop;
      const c = j * N + i;
      if (v > S[c]) S[c] = v;
    }
  }
}
console.timeEnd('shadow');

// ---------------------------------------------------------------- encode
function encodeU16(src, lo, hi) {
  const out = new Uint16Array(N * N);
  const sc = 65535 / (hi - lo);
  for (let j = 0; j < N; j++) {
    let prev = 0;
    for (let i = 0; i < N; i++) {
      const v = Math.max(0, Math.min(65535, Math.round((src[j * N + i] - lo) * sc)));
      out[j * N + i] = (v - prev) & 0xffff;
      prev = v;
    }
  }
  return zlib.gzipSync(Buffer.from(out.buffer), { level: 9 });
}
let sHi = -1e9;
for (let i = 0; i < N * N; i++) sHi = Math.max(sHi, S[i]);
fs.writeFileSync(path.join(OUT, 'height.bin.gz'), encodeU16(H, minH, maxH));
fs.writeFileSync(path.join(OUT, 'shadow.bin.gz'), encodeU16(S, minH, sHi));

// ---------------------------------------------------------------- PNG
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, channels, data) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : channels === 3 ? 2 : 0;
  const raw = Buffer.alloc((w * channels + 1) * h);
  for (let y = 0; y < h; y++) data.copy(raw, y * (w * channels + 1) + 1, y * w * channels, (y + 1) * w * channels);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- splat (2048): R sediment, G erosion, B road, A flow
console.time('splat');
const M = N / 2;
const splat = Buffer.alloc(M * M * 4);
{
  const Db = boxBlur(D, N, 2), Eb = boxBlur(E, N, 2), Fb = boxBlur(F, N, 1);
  const pct = (arr, q) => { const s = []; for (let i = 0; i < arr.length; i += 97) s.push(arr[i]); s.sort((a, b) => a - b); return s[Math.floor(s.length * q)] || 1; };
  const dS = pct(Db, 0.985), eS = pct(Eb, 0.985), fS = Math.log1p(pct(Fb, 0.995));
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const k = (j * 2) * N + i * 2, o = (j * M + i) * 4;
    splat[o] = Math.min(255, 255 * Math.sqrt(Math.max(0, Db[k]) / dS));
    splat[o + 1] = Math.min(255, 255 * Math.sqrt(Math.max(0, Eb[k]) / eS));
    splat[o + 2] = Math.min(255, 255 * Math.max(RD[k], RD[k + 1], RD[k + N], RD[k + N + 1]));
    splat[o + 3] = Math.min(255, 255 * Math.log1p(Fb[k]) / fS);
  }
}
fs.writeFileSync(path.join(OUT, 'splat.png'), png(M, M, 4, splat));
console.timeEnd('splat');

const meta = {
  N, size: SIZE, cell: CELL,
  height: { file: 'height.bin.gz', lo: minH, hi: maxH },
  shadow: { file: 'shadow.bin.gz', lo: minH, hi: sHi },
  splat: 'splat.png',
  sun: SUN,
  sites: { ...SITES, villageY: villageY(0, 0) },
  roads: ROADS.map(r => r.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10])),
  canyon: CANYON.map(([x, z]) => [Math.round(x), Math.round(z)]),
  knobs: knobList.map(k => [Math.round(k.x), Math.round(k.z), Math.round(k.rk), Math.round(k.hk * 10) / 10]),
};
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta));
console.log('height range', minH.toFixed(1), maxH.toFixed(1), 'files written');
