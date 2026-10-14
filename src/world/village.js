// Gulmira: procedural mud-brick village. Hand-made looking rounded walls, vigas, openings, compounds,
// streets and a square; emits merged meshes, colliders and gameplay points.
import * as THREE from 'three';
import { makeAdobeMaterial, makeTriMaterial, loadBuildingArrays } from './buildmat.js';
import { pbrSet } from '../core/textures.js';

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash3(x, y, z) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), u), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), u), v),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), u), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), u), v), w);
}

class Bucket {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.mat = []; this.uv = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  push(p, n, c, m = [0, 0, 0, 0], uv = [0, 0]) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.col.push(c.r, c.g, c.b); this.mat.push(m[0], m[1], m[2], m[3]); this.uv.push(uv[0], uv[1]);
    return this.count - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aBMat', new THREE.Float32BufferAttribute(this.mat, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _nm = new THREE.Matrix3();

function axisCoords(half, r, segPerM) {
  const out = [-half];
  if (r > 0.001 && half > r * 1.5) { out.push(-half + r); }
  const inner0 = r > 0.001 && half > r * 1.5 ? -half + r : -half;
  const inner1 = -inner0;
  const n = Math.max(1, Math.ceil((inner1 - inner0) * segPerM));
  for (let i = 1; i < n; i++) out.push(inner0 + (inner1 - inner0) * i / n);
  if (r > 0.001 && half > r * 1.5) { out.push(half - r); }
  out.push(half);
  return out;
}

// rounded, noise-displaced box into a bucket. opts: r, seg, disp, bottom, color(fn or Color), mat(fn)
function addBox(b, w, h, d, matrix, opts = {}) {
  const r = opts.r ?? 0.1, seg = opts.seg ?? 1.4, disp = opts.disp ?? 0.03;
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const ix = Math.max(0, hx - r), iy = Math.max(0, hy - r), iz = Math.max(0, hz - r);
  const xs = axisCoords(hx, r, seg), ys = axisCoords(hy, r, seg), zs = axisCoords(hz, r, seg);
  _nm.getNormalMatrix(matrix);
  const faces = [
    { a: 'z', b: 'y', fix: 'x', s: 1, A: zs, B: ys }, { a: 'z', b: 'y', fix: 'x', s: -1, A: zs, B: ys },
    { a: 'x', b: 'z', fix: 'y', s: 1, A: xs, B: zs }, { a: 'x', b: 'z', fix: 'y', s: -1, A: xs, B: zs },
    { a: 'x', b: 'y', fix: 'z', s: 1, A: xs, B: ys }, { a: 'x', b: 'y', fix: 'z', s: -1, A: xs, B: ys },
  ];
  const halfOf = { x: hx, y: hy, z: hz }, innerOf = { x: ix, y: iy, z: iz };
  for (const f of faces) {
    if (f.fix === 'y' && f.s < 0 && opts.bottom === false) continue;
    const base = b.count;
    const nA = f.A.length, nB = f.B.length;
    for (let j = 0; j < nB; j++) for (let i = 0; i < nA; i++) {
      const c = { x: 0, y: 0, z: 0 };
      c[f.a] = f.A[i]; c[f.b] = f.B[j]; c[f.fix] = halfOf[f.fix] * f.s;
      const inner = { x: Math.max(-innerOf.x, Math.min(innerOf.x, c.x)), y: Math.max(-innerOf.y, Math.min(innerOf.y, c.y)), z: Math.max(-innerOf.z, Math.min(innerOf.z, c.z)) };
      _n.set(c.x - inner.x, c.y - inner.y, c.z - inner.z);
      if (_n.lengthSq() < 1e-10) _n.set(f.fix === 'x' ? f.s : 0, f.fix === 'y' ? f.s : 0, f.fix === 'z' ? f.s : 0);
      _n.normalize();
      _p.set(inner.x, inner.y, inner.z).addScaledVector(_n, r);
      _p.applyMatrix4(matrix);
      const wn = _n.clone().applyMatrix3(_nm).normalize();
      if (disp > 0) {
        const nz = (vnoise(_p.x * 0.9, _p.y * 0.9, _p.z * 0.9) - 0.5) * 2 + (vnoise(_p.x * 3.1, _p.y * 3.1, _p.z * 3.1) - 0.5) * 0.6;
        _p.addScaledVector(wn, nz * disp);
      }
      const col = typeof opts.color === 'function' ? opts.color(_p, wn) : (opts.color || new THREE.Color(1, 1, 1));
      const m = typeof opts.mat === 'function' ? opts.mat(_p, wn) : (opts.mat || [0, 0, 0, 0]);
      const uv = [c[f.a] + hx, c[f.b] + hy];
      b.push(_p, wn, col, m, uv);
    }
    for (let j = 0; j < nB - 1; j++) for (let i = 0; i < nA - 1; i++) {
      const a = base + j * nA + i, bb = a + 1, c = a + nA, d = c + 1;
      b.idx.push(a, bb, c, bb, d, c);
    }
  }
  return b;
}

function fixWinding(g) {
  const pos = g.attributes.position.array, nor = g.attributes.normal.array, ix = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), r = new THREE.Vector3();
  for (let t = 0; t < ix.length; t += 3) {
    a.fromArray(pos, ix[t] * 3); b.fromArray(pos, ix[t + 1] * 3); c.fromArray(pos, ix[t + 2] * 3);
    n.subVectors(b, a).cross(r.subVectors(c, a));
    r.fromArray(nor, ix[t] * 3);
    if (n.dot(r) < 0) { const k = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = k; }
  }
}

function addCylinder(b, r0, r1, len, matrix, color, seg = 8) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  g.applyMatrix4(matrix);
  const base = b.count;
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) b.push(_p.fromBufferAttribute(p, i), _n.fromBufferAttribute(n, i), color, [0, 0, 0, 0], [uv.getX(i), uv.getY(i)]);
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i++) b.idx.push(base + ix[i]);
}

function addDome(b, center, radius, height, color, mat) {
  const g = new THREE.SphereGeometry(radius, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, height / radius, 1);
  g.translate(center.x, center.y, center.z);
  const base = b.count;
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    _p.fromBufferAttribute(p, i); _n.fromBufferAttribute(n, i);
    const nz = (vnoise(_p.x * 1.3, _p.y * 1.3, _p.z * 1.3) - 0.5) * 0.06;
    _p.addScaledVector(_n, nz);
    b.push(_p, _n, color, mat, [0, 0]);
  }
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i++) b.idx.push(base + ix[i]);
}

function addQuad(b, center, right, up, normal, w, h, color) {
  const base = b.count;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    _p.copy(center).addScaledVector(right, sx * w / 2).addScaledVector(up, sy * h / 2);
    b.push(_p, normal, color, [0, 0, 0, 0], [(sx + 1) / 2 * w, (sy + 1) / 2 * h]);
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// split one big indexed geometry into spatial tiles so each tile frustum-culls on its own
function splitTiles(g, size) {
  const pos = g.attributes.position.array, ix = g.index.array;
  const buckets = new Map();
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3;
    const key = Math.floor(pos[a] / size) + ',' + Math.floor(pos[a + 2] / size);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(ix[t], ix[t + 1], ix[t + 2]);
  }
  const attrs = Object.keys(g.attributes);
  const out = [];
  for (const tri of buckets.values()) {
    const remap = new Map();
    const newIdx = [];
    const data = Object.fromEntries(attrs.map(k => [k, []]));
    for (const v of tri) {
      let n = remap.get(v);
      if (n === undefined) {
        n = remap.size; remap.set(v, n);
        for (const k of attrs) { const A = g.attributes[k]; for (let c = 0; c < A.itemSize; c++) data[k].push(A.array[v * A.itemSize + c]); }
      }
      newIdx.push(n);
    }
    const ng = new THREE.BufferGeometry();
    for (const k of attrs) ng.setAttribute(k, new THREE.Float32BufferAttribute(data[k], g.attributes[k].itemSize));
    ng.setIndex(remap.size > 65535 ? new THREE.Uint32BufferAttribute(newIdx, 1) : new THREE.Uint16BufferAttribute(newIdx, 1));
    ng.computeBoundingSphere(); ng.computeBoundingBox();
    out.push(ng);
  }
  return out;
}

// 2D oriented rect overlap (SAT)
function rectsOverlap(a, b) {
  const axes = [[Math.cos(a.yaw), -Math.sin(a.yaw)], [Math.sin(a.yaw), Math.cos(a.yaw)], [Math.cos(b.yaw), -Math.sin(b.yaw)], [Math.sin(b.yaw), Math.cos(b.yaw)]];
  const corners = (r) => {
    const c = Math.cos(r.yaw), s = Math.sin(r.yaw), out = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = sx * r.w / 2, lz = sz * r.d / 2;
      out.push([r.x + lx * c + lz * s, r.z - lx * s + lz * c]);
    }
    return out;
  };
  const ca = corners(a), cb = corners(b);
  for (const [ax, az] of axes) {
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (const [x, z] of ca) { const p = x * ax + z * az; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
    for (const [x, z] of cb) { const p = x * ax + z * az; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}
function distToSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
  let t = ((px - ax) * vx + (pz - az) * vz) / l2; t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(px - ax - vx * t, pz - az - vz * t), dx: vx, dz: vz, t };
}

export class Village {
  constructor({ atmo, terrain, world, meta }) {
    this.atmo = atmo; this.terrain = terrain; this.world = world; this.meta = meta;
    this.group = new THREE.Group();
    this.group.name = 'village';
    this.center = new THREE.Vector3(meta.sites.village.x, 0, meta.sites.village.z);
    this.points = { square: null, hostage: [], cover: [], roofs: [], doors: [], streets: [], gates: [], courtyards: [], market: [] };
    this.props = [];
    this.buildings = [];
  }

  async build() {
    const arrays = await loadBuildingArrays();
    this.adobeMat = makeAdobeMaterial(this.atmo, arrays);
    this.woodMat = makeTriMaterial(this.atmo, pbrSet('weathered_planks'), { tile: 1.2, key: 'wood' });
    this.darkMat = new THREE.MeshStandardMaterial({ color: 0x0b0a09, roughness: 1 });
    this.atmo.patch(this.darkMat, { key: 'dark' });
    this.clothMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    this.atmo.patch(this.clothMat, { key: 'cloth' });
    this.metalMat = makeTriMaterial(this.atmo, pbrSet('rusty_corrugated_iron'), { tile: 1.5, key: 'metal', metal: 0.2 });
    const rng = mulberry32(20080502);
    this.rng = rng;
    const B = { adobe: new Bucket(), wood: new Bucket(), dark: new Bucket(), cloth: new Bucket(), metal: new Bucket() };
    this.B = B;
    const T = this.terrain;
    const V = this.center;
    // streets
    const sq = { x: V.x + 6, z: V.z - 6, r: 23 };
    this.square = sq;
    const streets = [
      { w: 4.5, pts: [[40, 340], [32, 230], [18, 120], [sq.x, sq.z + sq.r - 4]] },
      { w: 4.0, pts: [[sq.x, sq.z - sq.r + 4], [-6, -110], [-22, -220], [-40, -330]] },
      { w: 3.6, pts: [[-330, 40], [-200, 30], [-90, 12], [sq.x - sq.r + 4, sq.z]] },
      { w: 4.2, pts: [[sq.x + sq.r - 4, sq.z - 2], [110, -24], [210, -40], [310, -52]] },
      { w: 2.6, pts: [[-150, 180], [-90, 120], [-40, 60], [sq.x - 18, sq.z + 18]] },
      { w: 2.6, pts: [[170, 160], [110, 110], [60, 60], [sq.x + 18, sq.z + 18]] },
      { w: 2.6, pts: [[-180, -170], [-110, -110], [-50, -50], [sq.x - 18, sq.z - 18]] },
      { w: 2.6, pts: [[190, -200], [120, -130], [60, -60], [sq.x + 18, sq.z - 18]] },
    ];
    this.streets = streets;
    const streetDist = (x, z) => {
      let best = { d: 1e9, dx: 1, dz: 0, w: 3 };
      for (const s of streets) for (let i = 0; i < s.pts.length - 1; i++) {
        const r = distToSeg(x, z, s.pts[i][0], s.pts[i][1], s.pts[i + 1][0], s.pts[i + 1][1]);
        if (r.d - s.w < best.d - best.w) best = { ...r, w: s.w };
      }
      return best;
    };
    for (const s of streets) for (let i = 0; i < s.pts.length - 1; i++) {
      const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 8);
      for (let k = 0; k <= n; k++) this.points.streets.push(new THREE.Vector3(ax + (bx - ax) * k / n, 0, az + (bz - az) * k / n));
    }
    for (const p of this.points.streets) p.y = T.heightAt(p.x, p.z);

    // parcels
    const parcels = [];
    const R = 335;
    let tries = 0;
    while (parcels.length < 520 && tries < 30000) {
      tries++;
      const ang = rng() * Math.PI * 2, rad = Math.pow(rng(), 0.72) * R;
      const x = V.x + Math.cos(ang) * rad, z = V.z + Math.sin(ang) * rad;
      const edge = rad / R;
      const sd = streetDist(x, z);
      if (Math.hypot(x - sq.x, z - sq.z) < sq.r + 9) continue;
      const big = rng() < 0.3 + edge * 0.4;
      const w = big ? 15 + rng() * 11 : 7 + rng() * 6;
      const d = big ? 13 + rng() * 10 : 6 + rng() * 5;
      let yaw = Math.atan2(sd.dx, sd.dz) + (rng() - 0.5) * 0.12;
      if (rng() < 0.5) yaw += Math.PI / 2;
      const P = { x, z, w, d, yaw, big, edge };
      const reach = Math.hypot(w, d) / 2;
      if (sd.d < sd.w + 1.2 + Math.min(w, d) / 2 && sd.d < sd.w + reach) {
        // check true overlap with the street band using corners sampled
        let bad = false;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        for (let u = -1; u <= 1; u += 0.25) for (let v = -1; v <= 1; v += 0.25) {
          const px = x + u * w / 2 * c + v * d / 2 * s, pz = z - u * w / 2 * s + v * d / 2 * c;
          if (streetDist(px, pz).d < sd.w + 1.0) { bad = true; break; }
        }
        if (bad) continue;
      }
      const grown = { ...P, w: w + 1.3 + edge * 2.2, d: d + 1.3 + edge * 2.2 };
      if (parcels.some(q => rectsOverlap(grown, q))) continue;
      // slope check
      const hs = [];
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) hs.push(T.heightAt(x + u * w / 2 * Math.cos(yaw) + v * d / 2 * Math.sin(yaw), z - u * w / 2 * Math.sin(yaw) + v * d / 2 * Math.cos(yaw)));
      if (Math.max(...hs) - Math.min(...hs) > 4.5) continue;
      P.ground = Math.min(...hs); P.groundMax = Math.max(...hs);
      parcels.push(P);
    }
    this.parcels = parcels;
    for (const P of parcels) {
      const toStreet = streetDist(P.x, P.z);
      if (P.big) this.compound(P, toStreet);
      else if (rng() < 0.06) this.ruin(P);
      else this.house(P, { stories: rng() < 0.25 + (1 - P.edge) * 0.35 ? 2 : 1, standalone: true });
    }
    this.squareDressing(sq);
    const clutter = ['Barrel_01', 'Barrel_02', 'barrel_03', 'wooden_crate_01', 'wooden_crate_02', 'old_tyre', 'cement_bag', 'trashbag', 'metal_jerrycan_green', 'plastic_jerrycan', 'wooden_barrels_01', 'propane_tank', 'rusted_wheel_rim_01'];
    for (let i = 0; i < 160; i++) {
      const sp = this.points.streets[Math.floor(rng() * this.points.streets.length)];
      const sd = streetDist(sp.x, sp.z);
      const nx = -sd.dz, nz = sd.dx, nl = Math.hypot(nx, nz) || 1;
      const side = rng() < 0.5 ? -1 : 1;
      const off = sd.w + 0.3 + rng() * 1.2;
      const p = new THREE.Vector3(sp.x + nx / nl * off * side, 0, sp.z + nz / nl * off * side);
      p.y = T.heightAt(p.x, p.z);
      this.props.push({ model: clutter[Math.floor(rng() * clutter.length)], pos: p, yaw: rng() * 6.28 });
    }

    const mk = (bucket, mat, name, shadow = true) => {
      if (!bucket.count) return null;
      const g = bucket.geometry();
      fixWinding(g);
      const tiles = splitTiles(g, 70);
      const meshes = tiles.map(tg => {
        const m = new THREE.Mesh(tg, mat);
        m.name = name; m.castShadow = shadow; m.receiveShadow = true;
        m.matrixAutoUpdate = false; m.updateMatrix();
        this.group.add(m);
        return m;
      });
      return { meshes, geometry: g };
    };
    this.meshes = {
      adobe: mk(B.adobe, this.adobeMat, 'adobe'),
      wood: mk(B.wood, this.woodMat, 'wood'),
      dark: mk(B.dark, this.darkMat, 'openings', false),
      cloth: mk(B.cloth, this.clothMat, 'cloth'),
      metal: mk(B.metal, this.metalMat, 'metal'),
    };
    this.points.square = new THREE.Vector3(sq.x, T.heightAt(sq.x, sq.z), sq.z);
    return this;
  }

  tint(kind) {
    const r = this.rng();
    if (kind === 'white') return new THREE.Color(1.55, 1.5, 1.42);
    const base = [new THREE.Color(1.05, 1.0, 0.95), new THREE.Color(1.12, 1.03, 0.92), new THREE.Color(0.95, 0.93, 0.9), new THREE.Color(1.2, 1.12, 1.0), new THREE.Color(0.88, 0.84, 0.8)];
    return base[Math.floor(r * base.length)].clone().multiplyScalar(0.92 + this.rng() * 0.16);
  }

  wallMat(groundY, style) {
    return (p, n) => {
      const hgt = p.y - groundY;
      return [style.cracked, style.brick, Math.max(0, 1 - hgt / 0.9) * style.mud, Math.max(0, 1 - hgt / 1.6)];
    };
  }

  // single building: footprint w x d at x,z with yaw; returns facade info
  house(P, { stories = 1, standalone = false, inCompound = null } = {}) {
    const rng = this.rng, T = this.terrain, B = this.B;
    const { x, z, w, d, yaw } = P;
    const ground = P.ground ?? T.heightAt(x, z);
    const groundMax = P.groundMax ?? ground;
    const storyH = 2.9 + rng() * 0.4;
    const top = groundMax + stories * storyH + 0.25;
    const base = ground - 0.6;
    const h = top - base;
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, base + h / 2, z);
    const tintC = rng() < 0.12 ? this.tint('white') : this.tint();
    const style = { cracked: rng(), brick: rng() * 0.6, mud: 0.5 + rng() * 0.5 };
    addBox(B.adobe, w, h, d, m, { r: 0.14, seg: 0.5, disp: 0.045, bottom: false, color: tintC, mat: this.wallMat(ground, style) });
    // parapet
    const par = 0.28 + rng() * 0.2;
    const pt = 0.26;
    const parM = (lx, lz, pw, pd) => new THREE.Matrix4().makeRotationY(yaw).setPosition(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), top + par / 2 - 0.02, z - lx * Math.sin(yaw) + lz * Math.cos(yaw));
    const hasPar = rng() < 0.8;
    if (hasPar) {
      addBox(B.adobe, w, par, pt, parM(0, d / 2 - pt / 2), { r: 0.08, seg: 0.8, disp: 0.03, bottom: false, color: tintC, mat: [style.cracked, 0, 0, 0] });
      addBox(B.adobe, w, par, pt, parM(0, -d / 2 + pt / 2), { r: 0.08, seg: 0.8, disp: 0.03, bottom: false, color: tintC, mat: [style.cracked, 0, 0, 0] });
      addBox(B.adobe, pt, par, d - pt * 2, parM(w / 2 - pt / 2, 0), { r: 0.08, seg: 0.8, disp: 0.03, bottom: false, color: tintC, mat: [style.cracked, 0, 0, 0] });
      addBox(B.adobe, pt, par, d - pt * 2, parM(-w / 2 + pt / 2, 0), { r: 0.08, seg: 0.8, disp: 0.03, bottom: false, color: tintC, mat: [style.cracked, 0, 0, 0] });
    }
    const local = (lx, ly, lz) => new THREE.Vector3(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), ly, z - lx * Math.sin(yaw) + lz * Math.cos(yaw));
    const ax = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), az = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // vigas (roof beam ends) along the two long faces
    const woodC = new THREE.Color(0.72 + rng() * 0.2, 0.6 + rng() * 0.15, 0.5);
    const longX = w >= d;
    const span = longX ? w : d;
    const step = 0.65 + rng() * 0.25;
    if (rng() < 0.85) for (const side of [-1, 1]) {
      for (let t = -span / 2 + 0.6; t <= span / 2 - 0.5; t += step) {
        const pos = longX ? local(t, top - 0.32, side * (d / 2 - 0.05)) : local(side * (w / 2 - 0.05), top - 0.32, t);
        const dir = (longX ? az.clone().multiplyScalar(side) : ax.clone().multiplyScalar(side));
        const mm = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(), dir, new THREE.Vector3(0, 1, 0)).setPosition(pos);
        addCylinder(B.wood, 0.085 + rng() * 0.03, 0.08, 0.32 + rng() * 0.22, mm, woodC.clone().multiplyScalar(0.85 + rng() * 0.2), 7);
      }
    }
    // openings on each facade
    const faces = [
      { n: az.clone(), r: ax.clone(), len: w, off: d / 2 },
      { n: az.clone().negate(), r: ax.clone().negate(), len: w, off: d / 2 },
      { n: ax.clone(), r: az.clone().negate(), len: d, off: w / 2 },
      { n: ax.clone().negate(), r: az.clone(), len: d, off: w / 2 },
    ];
    const doorFace = P.doorFace ?? Math.floor(rng() * 4);
    faces.forEach((f, fi) => {
      const center = new THREE.Vector3(x, 0, z).addScaledVector(f.n, f.off);
      if (fi === doorFace) {
        const off = (rng() - 0.5) * Math.max(0, f.len - 3);
        const dp = center.clone().addScaledVector(f.r, off);
        dp.y = T.heightAt(dp.x, dp.z);
        this.door(dp, f.n, f.r, 1.0 + rng() * 0.3, 2.0 + rng() * 0.2);
        this.points.doors.push({ pos: dp.clone().addScaledVector(f.n, 1.2), normal: f.n.clone() });
      }
      for (let s = 0; s < stories; s++) {
        const n = Math.max(0, Math.floor((f.len - 1.5) / (2.6 + rng() * 1.5)));
        for (let k = 0; k < n; k++) {
          if (rng() < 0.3) continue;
          const t = (k + 0.5) / n - 0.5;
          const wp = center.clone().addScaledVector(f.r, t * (f.len - 1.5));
          if (fi === doorFace && Math.abs(t * (f.len - 1.5)) < 1.5 && s === 0) continue;
          wp.y = groundMax + s * storyH + 1.35 + rng() * 0.2;
          const ww = 0.5 + rng() * 0.45, wh = 0.6 + rng() * 0.45;
          this.window(wp, f.n, f.r, ww, wh, rng() < 0.4);
        }
      }
    });
    // mud domes, upper-floor setbacks, ruins
    if (stories === 1 && rng() < 0.16 && w > 4 && d > 4) {
      const n = Math.max(1, Math.min(4, Math.floor(Math.max(w, d) / 4.2)));
      const along = w >= d ? ax : az;
      const span = Math.max(w, d) - 1.2;
      const r = Math.min(Math.min(w, d) * 0.42, span / n * 0.48);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (span - r * 2);
        const c = new THREE.Vector3(x, top - 0.05, z).addScaledVector(along, t);
        addDome(B.adobe, c, r, r * (0.55 + rng() * 0.2), tintC, [style.cracked, 0.2, 0, 0]);
      }
    } else if (stories === 1 && rng() < 0.22 && w > 6 && d > 5) {
      const sw = w * (0.45 + rng() * 0.25), sd = d * (0.5 + rng() * 0.3);
      const ox = (rng() - 0.5) * (w - sw), oz = (rng() - 0.5) * (d - sd);
      const uh = 2.6 + rng() * 0.4;
      const um = new THREE.Matrix4().makeRotationY(yaw).setPosition(local(ox, 0, oz).x, top + uh / 2 - 0.1, local(ox, 0, oz).z);
      addBox(B.adobe, sw, uh, sd, um, { r: 0.12, seg: 0.75, disp: 0.04, bottom: false, color: tintC, mat: [style.cracked, style.brick, 0, 0] });
      const wp = local(ox, top + 1.3, oz + sd / 2 + 0.01);
      this.window(wp, az, ax, 0.6, 0.7, rng() < 0.5);
      this.world.addBox(local(ox, top + uh / 2, oz), new THREE.Vector3(sw / 2, uh / 2, sd / 2), yaw, { kind: 'building' });
    }
    // roof clutter
    const roofY = top;
    if (rng() < 0.25) {
      const fw = local((rng() - 0.5) * (w - 2.5), roofY, (rng() - 0.5) * (d - 2.5));
      for (let k = 0; k < 9; k++) {
        const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.PI / 2, 0, yaw + (rng() - 0.5) * 0.2)).setPosition(fw.x + (rng() - 0.5) * 0.3, roofY + 0.1 + Math.floor(k / 3) * 0.12, fw.z + (k % 3 - 1) * 0.13);
        addCylinder(B.wood, 0.06, 0.06, 1.3 + rng() * 0.4, m, new THREE.Color(0.75, 0.62, 0.5), 6);
      }
    }
    if (rng() < 0.08) {
      const dish = local((rng() - 0.5) * (w - 2), roofY + 0.9, (rng() - 0.5) * (d - 2));
      const dg = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.9, rng() * 6.28, 0)).setPosition(dish);
      addCylinder(B.metal, 0.38, 0.02, 0.12, dg, new THREE.Color(0.9, 0.9, 0.9), 14);
      addCylinder(B.metal, 0.02, 0.02, 0.9, new THREE.Matrix4().setPosition(dish.clone().setY(roofY)), new THREE.Color(0.6, 0.6, 0.6), 5);
    }
    if (rng() < 0.3) {
      const tank = local((rng() - 0.5) * (w - 2), roofY, (rng() - 0.5) * (d - 2));
      addCylinder(B.metal, 0.55, 0.55, 1.1, new THREE.Matrix4().setPosition(tank), new THREE.Color(0.9, 0.9, 0.85), 14);
    }
    if (rng() < 0.15) this.props.push({ model: 'Barrel_01', pos: local((rng() - 0.5) * (w - 2), roofY, (rng() - 0.5) * (d - 2)), yaw: rng() * 6.28 });
    this.points.roofs.push(local(0, roofY, 0));
    // collider
    this.world.addBox(new THREE.Vector3(x, base + h / 2 + (hasPar ? par / 2 : 0), z), new THREE.Vector3(w / 2, h / 2 + (hasPar ? par / 2 : 0), d / 2), yaw, { kind: 'building' });
    this.world.addBox(new THREE.Vector3(x, top + 0.05, z), new THREE.Vector3(w / 2 - pt, 0.05, d / 2 - pt), yaw, { kind: 'roof', noWalk: false });
    this.buildings.push({ x, z, w, d, yaw, top, ground });
    // cover points along walls
    for (const f of faces) {
      for (let t = -0.35; t <= 0.35; t += 0.35) {
        const cp = new THREE.Vector3(x, 0, z).addScaledVector(f.n, f.off + 0.8).addScaledVector(f.r, t * f.len);
        cp.y = T.heightAt(cp.x, cp.z);
        this.points.cover.push({ pos: cp, normal: f.n.clone() });
      }
    }
  }

  ruin(P) {
    const rng = this.rng, T = this.terrain;
    const { x, z, w, d, yaw } = P;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const L = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const corners = [L(-w / 2, -d / 2), L(w / 2, -d / 2), L(w / 2, d / 2), L(-w / 2, d / 2)];
    const tintC = this.tint();
    const style = { cracked: rng(), brick: 0.8, mud: 1 };
    for (let e = 0; e < 4; e++) {
      if (rng() < 0.3) continue;
      const [ax, az] = corners[e], [bx, bz] = corners[(e + 1) % 4];
      const t0 = rng() * 0.3, t1 = 0.7 + rng() * 0.3;
      this.wall(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, 0.6 + rng() * 1.8, 0.5, style, tintC);
    }
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Vector3(x + (rng() - 0.5) * w, 0, z + (rng() - 0.5) * d);
      p.y = T.heightAt(p.x, p.z) - 0.2;
      addBox(this.B.adobe, 0.6 + rng() * 1.2, 0.4 + rng() * 0.5, 0.5 + rng(), new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rng() * 0.6, rng() * 6, rng() * 0.6)).setPosition(p), { r: 0.08, seg: 1, disp: 0.06, bottom: false, color: tintC, mat: [0.5, 0.8, 1, 0.6] });
    }
    this.props.push({ model: 'dead_tree_trunk', pos: new THREE.Vector3(x, T.heightAt(x, z), z), yaw: rng() * 6.28, scale: 0.9 });
  }

  window(p, n, r, w, h, shutters) {
    const B = this.B, rng = this.rng;
    const up = new THREE.Vector3(0, 1, 0);
    const c = p.clone().addScaledVector(n, 0.035);
    addQuad(B.dark, c, r, up, n, w, h, new THREE.Color(1, 1, 1));
    const fw = 0.07, woodC = new THREE.Color(0.65, 0.52, 0.42).multiplyScalar(0.8 + rng() * 0.3);
    const frame = (offR, offU, fwid, fhgt) => {
      const pos = p.clone().addScaledVector(r, offR).addScaledVector(up, offU).addScaledVector(n, 0.04);
      const m = new THREE.Matrix4().makeBasis(r, up, n).setPosition(pos);
      addBox(B.wood, fwid, fhgt, 0.1, m, { r: 0, seg: 0.01, disp: 0, color: woodC });
    };
    frame(0, h / 2 + fw / 2, w + fw * 2 + 0.06, fw * 1.4);
    frame(0, -h / 2 - fw / 2, w + fw * 2 + 0.04, fw);
    frame(-w / 2 - fw / 2, 0, fw, h);
    frame(w / 2 + fw / 2, 0, fw, h);
    if (rng() < 0.5) for (let i = -1; i <= 1; i += 1) frame(i * w / 4, 0, 0.025, h);
    if (shutters) {
      const paint = rng() < 0.4 ? new THREE.Color(0.35, 0.55, 0.62) : rng() < 0.5 ? new THREE.Color(0.38, 0.5, 0.36) : woodC.clone();
      for (const s of [-1, 1]) {
        const ang = s * (0.6 + rng() * 1.2);
        const hinge = p.clone().addScaledVector(r, s * (w / 2 + fw)).addScaledVector(n, 0.06);
        const leaf = new THREE.Vector3().copy(r).multiplyScalar(s).applyAxisAngle(up, s * Math.abs(ang) * 0.9);
        const pos = hinge.clone().addScaledVector(leaf, w / 4);
        const nn = new THREE.Vector3().crossVectors(up, leaf).normalize();
        const m = new THREE.Matrix4().makeBasis(leaf, up, nn).setPosition(pos);
        addBox(B.wood, w / 2, h, 0.04, m, { r: 0, seg: 0.01, disp: 0, color: paint });
      }
    }
  }

  door(p, n, r, w, h) {
    const B = this.B, rng = this.rng;
    const up = new THREE.Vector3(0, 1, 0);
    const c = p.clone().addScaledVector(up, h / 2);
    addQuad(B.dark, c.clone().addScaledVector(n, 0.03), r, up, n, w + 0.05, h, new THREE.Color(1, 1, 1));
    const paint = rng() < 0.35 ? new THREE.Color(0.32, 0.5, 0.6) : rng() < 0.3 ? new THREE.Color(0.42, 0.52, 0.34) : new THREE.Color(0.75, 0.6, 0.46);
    const open = rng();
    if (open < 0.65) {
      const m = new THREE.Matrix4().makeBasis(r, up, n).setPosition(c.clone().addScaledVector(n, 0.06));
      addBox(B.wood, w, h, 0.07, m, { r: 0, seg: 0.01, disp: 0, color: paint });
    }
    const lintel = new THREE.Matrix4().makeBasis(r, up, n).setPosition(c.clone().addScaledVector(up, h / 2 + 0.08).addScaledVector(n, 0.05));
    addBox(B.wood, w + 0.4, 0.14, 0.16, lintel, { r: 0, seg: 0.01, disp: 0, color: new THREE.Color(0.7, 0.58, 0.46) });
  }

  wall(ax, az, bx, bz, height, thick, style, tintC) {
    const T = this.terrain, B = this.B, rng = this.rng;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.4) return;
    const yaw = Math.atan2(bz - az, bx - ax);
    const nseg = Math.max(1, Math.ceil(len / 6));
    for (let i = 0; i < nseg; i++) {
      const t0 = i / nseg, t1 = (i + 1) / nseg;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const gl = Math.min(T.heightAt(x0, z0), T.heightAt(x1, z1), T.heightAt(cx, cz));
      const gh = Math.max(T.heightAt(x0, z0), T.heightAt(x1, z1));
      const hh = height + (rng() - 0.5) * 0.25 + (gh - gl);
      const base = gl - 0.5;
      const L = len / nseg + 0.12;
      const m = new THREE.Matrix4().makeRotationY(-yaw).setPosition(cx, base + (hh + 0.5) / 2, cz);
      addBox(B.adobe, L, hh + 0.5, thick, m, { r: 0.1, seg: 0.5, disp: 0.04, bottom: false, color: tintC, mat: this.wallMat(gl, style) });
      this.world.addBox(new THREE.Vector3(cx, base + (hh + 0.5) / 2, cz), new THREE.Vector3(L / 2, (hh + 0.5) / 2, thick / 2), -yaw, { kind: 'wall' });
    }
  }

  compound(P, toStreet) {
    const rng = this.rng, T = this.terrain;
    const { x, z, w, d, yaw } = P;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const L = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const corners = [L(-w / 2, -d / 2), L(w / 2, -d / 2), L(w / 2, d / 2), L(-w / 2, d / 2)];
    // gate side: the edge whose outward normal points most toward the street
    const ns = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([lx, lz]) => [lx * c + lz * s, -lx * s + lz * c]);
    const streetP = this.points.streets.reduce((best, p) => { const dd = (p.x - x) ** 2 + (p.z - z) ** 2; return dd < best.d ? { d: dd, p } : best; }, { d: 1e18, p: null }).p;
    let gateEdge = 0, bestDot = -2;
    ns.forEach(([nx, nz], i) => { const dot = nx * (streetP.x - x) + nz * (streetP.z - z); if (dot > bestDot) { bestDot = dot; gateEdge = i; } });
    const tintC = this.tint();
    const style = { cracked: rng(), brick: rng() * 0.5, mud: 0.6 + rng() * 0.4 };
    const height = 2.1 + rng() * 0.6;
    for (let e = 0; e < 4; e++) {
      const [ax, az] = corners[e], [bx, bz] = corners[(e + 1) % 4];
      if (e === gateEdge) {
        const gw = 3.0 + rng() * 0.6;
        const len = Math.hypot(bx - ax, bz - az);
        const g0 = (len - gw) / 2 / len, g1 = (len + gw) / 2 / len;
        this.wall(ax, az, ax + (bx - ax) * g0, az + (bz - az) * g0, height, 0.45, style, tintC);
        this.wall(ax + (bx - ax) * g1, az + (bz - az) * g1, bx, bz, height, 0.45, style, tintC);
        const gx = ax + (bx - ax) * 0.5, gz = az + (bz - az) * 0.5;
        const gp = new THREE.Vector3(gx, T.heightAt(gx, gz), gz);
        this.points.gates.push({ pos: gp, normal: new THREE.Vector3(ns[e][0], 0, ns[e][1]) });
        // gate leaves
        const r = new THREE.Vector3(bx - ax, 0, bz - az).normalize();
        const n = new THREE.Vector3(ns[e][0], 0, ns[e][1]);
        const up = new THREE.Vector3(0, 1, 0);
        const paint = rng() < 0.4 ? new THREE.Color(0.3, 0.48, 0.58) : new THREE.Color(0.62, 0.5, 0.4);
        for (const sgn of [-1, 1]) {
          if (rng() < 0.35) continue;
          const open = rng() * 1.3;
          const hinge = gp.clone().addScaledVector(r, sgn * gw / 2);
          const leaf = r.clone().multiplyScalar(-sgn).applyAxisAngle(up, sgn * open);
          const pos = hinge.clone().addScaledVector(leaf, gw / 4).add(new THREE.Vector3(0, 1.05, 0));
          const nn = new THREE.Vector3().crossVectors(up, leaf).normalize();
          addBox(this.B.wood, gw / 2, 2.1, 0.07, new THREE.Matrix4().makeBasis(leaf, up, nn).setPosition(pos), { r: 0, seg: 0.01, disp: 0, color: paint });
        }
        void n;
      } else {
        this.wall(ax, az, bx, bz, height, 0.45, style, tintC);
      }
    }
    // houses inside along the edge opposite to the gate (and maybe one side)
    const back = (gateEdge + 2) % 4;
    const hd = Math.min(6.2, d * 0.42);
    const inner = 0.5;
    const placeHouse = (edge, len, depth) => {
      const [nx, nz] = ns[edge];
      const off = (edge % 2 === 0 ? d : w) / 2 - inner - depth / 2;
      const hx = x + nx * off, hz = z + nz * off;
      const along = edge % 2 === 0;
      const H = { x: hx, z: hz, w: along ? len : depth, d: along ? depth : len, yaw, doorFace: { 0: 0, 1: 3, 2: 1, 3: 2 }[edge] };
      const hs = [];
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) hs.push(T.heightAt(hx + u * H.w / 2 * c + v * H.d / 2 * s, hz - u * H.w / 2 * s + v * H.d / 2 * c));
      H.ground = Math.min(...hs); H.groundMax = Math.max(...hs);
      H.doorFace = edge === 0 ? 1 : edge === 2 ? 0 : edge === 1 ? 3 : 2;
      this.house(H, { stories: rng() < 0.35 ? 2 : 1, inCompound: P });
    };
    const backLen = (back % 2 === 0 ? w : d) - inner * 2 - 0.2;
    placeHouse(back, backLen, hd);
    if (rng() < 0.6) {
      const sideEdge = rng() < 0.5 ? (gateEdge + 1) % 4 : (gateEdge + 3) % 4;
      const sideLen = (sideEdge % 2 === 0 ? w : d) - hd - inner * 2 - 1.2;
      if (sideLen > 4) {
        const [nx, nz] = ns[sideEdge];
        const [bnx, bnz] = ns[back];
        const off = (sideEdge % 2 === 0 ? d : w) / 2 - inner - 2.6;
        const shift = -(hd / 2 + 0.6);
        const hx = x + nx * off + bnx * shift * 0.9, hz = z + nz * off + bnz * shift * 0.9;
        const along = sideEdge % 2 === 0;
        const H = { x: hx, z: hz, w: along ? sideLen : 5.2, d: along ? 5.2 : sideLen, yaw };
        H.ground = T.heightAt(hx, hz) - 0.3; H.groundMax = T.heightAt(hx, hz) + 0.3;
        H.doorFace = sideEdge === 0 ? 1 : sideEdge === 2 ? 0 : sideEdge === 1 ? 3 : 2;
        this.house(H, { stories: 1, inCompound: P });
      }
    }
    const cy = new THREE.Vector3(x, T.heightAt(x, z), z);
    this.points.courtyards.push(cy);
    if (rng() < 0.5) this.props.push({ model: rng() < 0.7 ? 'dead_tree_trunk' : 'searsia_burchellii', pos: cy.clone().add(new THREE.Vector3((rng() - 0.5) * 3, 0, (rng() - 0.5) * 3)), yaw: rng() * 6.28, scale: 0.8 + rng() * 0.5 });
    const clutter = ['wooden_bucket_01', 'ceramic_pot', 'planter_pot_clay', 'Barrel_02', 'cement_bag', 'folding_wooden_stool', 'WoodenTable_01', 'wooden_barrels_01', 'metal_jerrycan', 'old_tyre', 'brass_pot_01', 'cardboard_box_01'];
    const nClutter = 2 + Math.floor(rng() * 5);
    for (let i = 0; i < nClutter; i++) {
      const a = rng() * 6.28, rr = 1.5 + rng() * Math.min(w, d) * 0.25;
      const pp = new THREE.Vector3(x + Math.cos(a) * rr, 0, z + Math.sin(a) * rr);
      pp.y = T.heightAt(pp.x, pp.z);
      this.props.push({ model: clutter[Math.floor(rng() * clutter.length)], pos: pp, yaw: rng() * 6.28 });
    }
  }

  squareDressing(sq) {
    const rng = this.rng, T = this.terrain, B = this.B;
    const c = new THREE.Vector3(sq.x, 0, sq.z);
    // well
    const wy = T.heightAt(sq.x, sq.z);
    addBox(B.adobe, 2.0, 1.4, 2.0, new THREE.Matrix4().setPosition(sq.x + 4, wy + 0.4, sq.z - 3), { r: 0.3, seg: 3, disp: 0.03, bottom: false, color: this.tint(), mat: [0.5, 0.6, 0.6, 0.5] });
    this.world.addBox(new THREE.Vector3(sq.x + 4, wy + 0.4, sq.z - 3), new THREE.Vector3(1, 0.7, 1), 0, { kind: 'well' });
    // market stalls around the square edge
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + 0.3 + (rng() - 0.5) * 0.15;
      if (Math.abs(Math.sin(a)) < 0.25 && rng() < 0.6) continue;
      const rr = sq.r - 3.5;
      const p = new THREE.Vector3(c.x + Math.cos(a) * rr, 0, c.z + Math.sin(a) * rr);
      p.y = T.heightAt(p.x, p.z);
      const yaw = -a + Math.PI / 2;
      this.stall(p, yaw);
      this.points.market.push(p.clone());
    }
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2, rr = 6 + rng() * 6;
      const p = new THREE.Vector3(c.x + Math.cos(a) * rr, 0, c.z + Math.sin(a) * rr);
      p.y = T.heightAt(p.x, p.z);
      this.points.hostage.push(p);
    }
    this.props.push({ model: 'covered_car', pos: new THREE.Vector3(c.x - 14, T.heightAt(c.x - 14, c.z + 8), c.z + 8), yaw: 0.4 });
  }

  stall(p, yaw) {
    const B = this.B, rng = this.rng;
    const w = 2.6 + rng() * 1.2, d = 2.0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const L = (lx, ly, lz) => new THREE.Vector3(p.x + lx * c + lz * s, p.y + ly, p.z - lx * s + lz * c);
    const woodC = new THREE.Color(0.6, 0.5, 0.4);
    for (const [lx, lz, hh] of [[-w / 2, -d / 2, 2.3], [w / 2, -d / 2, 2.3], [-w / 2, d / 2, 1.9], [w / 2, d / 2, 1.9]]) addCylinder(B.wood, 0.05, 0.045, hh, new THREE.Matrix4().setPosition(L(lx, 0, lz)), woodC, 6);
    const awn = [new THREE.Color(0.75, 0.3, 0.2), new THREE.Color(0.25, 0.4, 0.55), new THREE.Color(0.8, 0.7, 0.45), new THREE.Color(0.35, 0.45, 0.3), new THREE.Color(0.9, 0.88, 0.82)][Math.floor(rng() * 5)];
    const top = new THREE.Matrix4().makeRotationY(yaw);
    top.multiply(new THREE.Matrix4().makeRotationX(-0.18));
    top.setPosition(L(0, 2.12, 0));
    addBox(B.cloth, w + 0.5, 0.03, d + 0.6, top, { r: 0.01, seg: 3, disp: 0.06, color: awn });
    addBox(B.wood, w, 0.08, 0.9, new THREE.Matrix4().makeRotationY(yaw).setPosition(L(0, 0.85, -d / 2 + 0.45)), { r: 0, seg: 0.01, disp: 0, color: woodC });
    this.world.addBox(L(0, 0.45, -d / 2 + 0.45), new THREE.Vector3(w / 2, 0.45, 0.45), yaw, { kind: 'stall' });
    const goods = ['wooden_crate_02', 'brass_pot_01', 'ceramic_pot', 'cardboard_box_01', 'wooden_bucket_01'];
    for (let i = 0; i < 2; i++) this.props.push({ model: goods[Math.floor(rng() * goods.length)], pos: L((rng() - 0.5) * w * 0.7, 0.9, -d / 2 + 0.45), yaw: rng() * 6.28, scale: 0.8 });
  }
}
