// Armor geometry kit: parametric body surfaces (superellipse sections) and plates cut from them
// with real thickness and rolled edges, so neighbouring plates share one underlying form.
import * as THREE from 'three';

const sgnPow = (t, p) => Math.sign(t) * Math.pow(Math.abs(t), p);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = t => Math.max(0, Math.min(1, t));
const smooth = t => t * t * (3 - 2 * t);

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// A section table: rows of { y, w, dF, dB, e, x, z, wL } sampled with Catmull-Rom along y.
export class SectionSurface {
  constructor(rows, { axis = 'y', bumps = [] } = {}) {
    this.rows = rows.map(r => ({ x: 0, z: 0, e: 2, ...r, dB: r.dB ?? r.dF, wL: r.wL ?? r.w })).sort((a, b) => a.y - b.y);
    this.axis = axis;
    this.bumps = bumps;
    this.y0 = this.rows[0].y;
    this.y1 = this.rows[this.rows.length - 1].y;
  }
  param(y) {
    const r = this.rows;
    if (y <= r[0].y) return { ...r[0], y };
    if (y >= r[r.length - 1].y) return { ...r[r.length - 1], y };
    let i = 0;
    while (i < r.length - 2 && y > r[i + 1].y) i++;
    const a = r[Math.max(0, i - 1)], b = r[i], c = r[i + 1], d = r[Math.min(r.length - 1, i + 2)];
    const t = (y - b.y) / (c.y - b.y);
    const out = { y };
    for (const k of ['w', 'dF', 'dB', 'e', 'x', 'z', 'wL']) {
      const g = o => o[k] ?? (k === 'x' || k === 'z' ? 0 : k === 'wL' ? o.w : k === 'dB' ? o.dF : 2);
      out[k] = catmull(g(a), g(b), g(c), g(d), t);
    }
    return out;
  }
  // theta: 0 = front (-Z), +PI/2 = right (+X), PI = back
  point(theta, y, out = new THREE.Vector3()) {
    const s = this.param(y);
    const sn = Math.sin(theta), cs = Math.cos(theta);
    const p = 2 / s.e;
    const w = sn >= 0 ? s.w : s.wL;
    const d = cs >= 0 ? s.dF : s.dB;
    let x = w * sgnPow(sn, p);
    let z = -d * sgnPow(cs, p);
    let bump = 0;
    for (const b of this.bumps) bump += b(theta, y);
    if (bump !== 0) {
      const len = Math.hypot(x, z) || 1;
      x += x / len * bump; z += z / len * bump;
    }
    return out.set(s.x + x, y, s.z + z);
  }
}

export class SphereSurface {
  constructor({ r = 0.1, rx, ry, rz, cx = 0, cy = 0, cz = 0, bumps = [] }) {
    this.rx = rx ?? r; this.ry = ry ?? r; this.rz = rz ?? r;
    this.c = new THREE.Vector3(cx, cy, cz);
    this.bumps = bumps;
  }
  // a: azimuth (0 = front -Z, +PI/2 = +X), b: elevation (-PI/2..PI/2)
  point(a, b, out = new THREE.Vector3()) {
    let r = 1;
    for (const f of this.bumps) r += f(a, b);
    return out.set(this.c.x + Math.sin(a) * Math.cos(b) * this.rx * r, this.c.y + Math.sin(b) * this.ry * r, this.c.z - Math.cos(a) * Math.cos(b) * this.rz * r);
  }
}

const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _r = new THREE.Vector3();

// Make every triangle's winding agree with a reference direction (stored normals or a callback).
export function orient(g, ref = null) {
  const pos = g.attributes.position.array, nor = g.attributes.normal ? g.attributes.normal.array : null;
  const ix = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), r = new THREE.Vector3(), m = new THREE.Vector3();
  for (let t = 0; t < ix.length; t += 3) {
    const i0 = ix[t], i1 = ix[t + 1], i2 = ix[t + 2];
    a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3); c.fromArray(pos, i2 * 3);
    n.subVectors(b, a).cross(m.subVectors(c, a));
    if (ref) { m.copy(a).add(b).add(c).divideScalar(3); ref(m, r); }
    else { r.fromArray(nor, i0 * 3); m.fromArray(nor, i1 * 3); r.add(m); m.fromArray(nor, i2 * 3); r.add(m); }
    if (n.dot(r) < 0) { ix[t + 1] = i2; ix[t + 2] = i1; }
  }
  g.index.needsUpdate = true;
  return g;
}

// Cut a plate from a surface. region: a0,a1 (first param), b0,b1 (second param) as numbers or
// functions of the other parameter; offset pushes the plate off the base form, thickness gives it body.
export function plate(surface, region, opts = {}) {
  const {
    segA = 32, segB = 24, offset = 0.004, thickness = 0.006, bevel = 0.0035, bevelSeg = 3,
    inner = true, flipWinding = false, uvScale = 1, mask = null, bulge = null,
  } = opts;
  const A0 = region.a0, A1 = region.a1;
  const B0 = typeof region.b0 === 'function' ? region.b0 : () => region.b0;
  const B1 = typeof region.b1 === 'function' ? region.b1 : () => region.b1;
  const nA = segA + 1, nB = segB + 1;
  const P = [], N = [], UV = [];
  const eps = 1e-3;
  const surfPoint = (a, b, out) => {
    surface.point(a, b, out);
    return out;
  };
  const normalAt = (a, b, out) => {
    surfPoint(a + eps, b, _p); surfPoint(a - eps, b, _q);
    const ta = _p.clone().sub(_q);
    surfPoint(a, b + eps, _p); surfPoint(a, b - eps, _q);
    const tb = _p.clone().sub(_q);
    out.crossVectors(tb, ta).normalize();
    if (flipWinding) out.negate();
    return out;
  };
  for (let j = 0; j < nB; j++) {
    for (let i = 0; i < nA; i++) {
      const u = i / segA, v = j / segB;
      const a = lerp(A0, A1, u);
      const b = lerp(B0(a), B1(a), v);
      const p = surfPoint(a, b, new THREE.Vector3());
      const n = normalAt(a, b, new THREE.Vector3());
      let off = offset;
      if (bulge) off += bulge(u, v, a, b);
      p.addScaledVector(n, off);
      P.push(p); N.push(n); UV.push([u * uvScale, v * uvScale]);
    }
  }
  const pos = [], nor = [], uv = [], idx = [];
  const push = (p, n, t) => { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(t[0], t[1]); return pos.length / 3 - 1; };
  const outer = P.map((p, k) => push(p, N[k], UV[k]));
  const quad = (a, b, c, d, flip) => { if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); };
  for (let j = 0; j < segB; j++) for (let i = 0; i < segA; i++) {
    const a = outer[j * nA + i], b = outer[j * nA + i + 1], c = outer[(j + 1) * nA + i], d = outer[(j + 1) * nA + i + 1];
    quad(a, b, c, d, false);
  }
  // perimeter, ordered
  const per = [];
  for (let i = 0; i < segA; i++) per.push(i);
  for (let j = 0; j < segB; j++) per.push(j * nA + segA);
  for (let i = segA; i > 0; i--) per.push(segB * nA + i);
  for (let j = segB; j > 0; j--) per.push(j * nA);
  const center = new THREE.Vector3();
  P.forEach(p => center.add(p)); center.divideScalar(P.length);
  // outward tangent at each perimeter vertex
  const outward = per.map((k, n) => {
    const prev = P[per[(n - 1 + per.length) % per.length]], next = P[per[(n + 1) % per.length]];
    const along = next.clone().sub(prev).normalize();
    const nn = N[k];
    const o = new THREE.Vector3().crossVectors(along, nn).normalize();
    const toC = center.clone().sub(P[k]);
    if (o.dot(toC) > 0) o.negate();
    return o;
  });
  const rings = [];
  for (let s = 0; s <= bevelSeg; s++) {
    const phi = (s / bevelSeg) * Math.PI / 2;
    rings.push({ o: bevel * Math.sin(phi), d: bevel * (1 - Math.cos(phi)), nphi: phi });
  }
  rings.push({ o: bevel, d: Math.max(bevel, thickness), nphi: Math.PI / 2 });
  rings.push({ o: 0, d: thickness, nphi: Math.PI });
  const ringIdx = rings.map(r => per.map((k, n) => {
    const p = P[k].clone().addScaledVector(outward[n], r.o).addScaledVector(N[k], -r.d);
    const nn = N[k].clone().multiplyScalar(Math.cos(Math.min(r.nphi, Math.PI / 2))).addScaledVector(outward[n], Math.sin(Math.min(r.nphi, Math.PI / 2)));
    if (r.nphi > Math.PI / 2) nn.copy(N[k]).negate();
    return push(p, nn.normalize(), [0, 0]);
  }));
  const L = per.length;
  const borderOuter = per.map(k => outer[k]);
  const chain = [borderOuter, ...ringIdx];
  for (let r = 0; r < chain.length - 1; r++) {
    for (let n = 0; n < L; n++) {
      const a = chain[r][n], b = chain[r][(n + 1) % L], c = chain[r + 1][n], d = chain[r + 1][(n + 1) % L];
      idx.push(a, c, b, b, c, d);
    }
  }
  if (inner) {
    const innerIdx = P.map((p, k) => push(p.clone().addScaledVector(N[k], -thickness), N[k].clone().negate(), UV[k]));
    for (let j = 0; j < segB; j++) for (let i = 0; i < segA; i++) {
      const a = innerIdx[j * nA + i], b = innerIdx[j * nA + i + 1], c = innerIdx[(j + 1) * nA + i], d = innerIdx[(j + 1) * nA + i + 1];
      quad(a, b, c, d, true);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return orient(g);
}

// Closed tube along a section surface (for undersuit, joints, fingers).
export function tube(surface, y0, y1, { segA = 32, segB = 16, caps = true, offset = 0 } = {}) {
  const pos = [], idx = [], uv = [];
  for (let j = 0; j <= segB; j++) {
    const y = lerp(y0, y1, j / segB);
    for (let i = 0; i <= segA; i++) {
      const a = (i / segA) * Math.PI * 2;
      const p = surface.point(a, y, new THREE.Vector3());
      pos.push(p.x, p.y, p.z); uv.push(i / segA, j / segB);
    }
  }
  const row = segA + 1;
  for (let j = 0; j < segB; j++) for (let i = 0; i < segA; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  if (caps) {
    for (const [y, flip] of [[y0, true], [y1, false]]) {
      const s = surface.param(y);
      const ci = pos.length / 3;
      pos.push(s.x, y, s.z); uv.push(0.5, 0.5);
      const base = (y === y0 ? 0 : segB) * row;
      for (let i = 0; i < segA; i++) {
        if (flip) idx.push(ci, base + i, base + i + 1); else idx.push(ci, base + i + 1, base + i);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  orient(g, (c, out) => {
    const s = surface.param(c.y);
    out.set(c.x - s.x, 0, c.z - s.z);
    if (caps && Math.abs(c.y - y0) < 1e-6) out.set(0, y0 < y1 ? -1 : 1, 0);
    else if (caps && Math.abs(c.y - y1) < 1e-6) out.set(0, y1 > y0 ? 1 : -1, 0);
  });
  g.computeVertexNormals();
  return g;
}

// Ribbed joint cylinder (gunmetal mechanics between plates).
export function ribbed(radius, length, { ribs = 6, depth = 0.004, segA = 28, segB = 48, rz } = {}) {
  const pos = [], idx = [];
  for (let j = 0; j <= segB; j++) {
    const t = j / segB;
    const y = -t * length;
    const rib = Math.pow(Math.abs(Math.sin(t * ribs * Math.PI)), 0.6);
    const taper = 1 - 0.12 * Math.pow(Math.abs(t - 0.5) * 2, 2);
    const r = radius * taper - depth * (1 - rib);
    for (let i = 0; i <= segA; i++) {
      const a = (i / segA) * Math.PI * 2;
      pos.push(Math.sin(a) * r, y, -Math.cos(a) * r * (rz ?? 1));
    }
  }
  const row = segA + 1;
  for (let j = 0; j < segB; j++) for (let i = 0; i < segA; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orient(g, (c, out) => out.set(c.x, 0, c.z));
  g.computeVertexNormals();
  return g;
}

export { lerp, clamp01, smooth };
