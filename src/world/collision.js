// Static collision world: yaw-rotated boxes and spheres in a spatial hash, plus terrain.
import * as THREE from 'three';

const CELL = 24;
const _v = new THREE.Vector3(), _l = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();

export class CollisionWorld {
  constructor(terrain) {
    this.terrain = terrain;
    this.grid = new Map();
    this.colliders = new Set();
    this.stamp = 0;
  }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  cellsFor(c) {
    const r = c.bound;
    const i0 = Math.floor((c.center.x - r) / CELL), i1 = Math.floor((c.center.x + r) / CELL);
    const j0 = Math.floor((c.center.z - r) / CELL), j1 = Math.floor((c.center.z + r) / CELL);
    const out = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) out.push(this.key(i, j));
    return out;
  }
  insert(c) {
    c.cells = this.cellsFor(c);
    for (const k of c.cells) { if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(c); }
    this.colliders.add(c);
    return c;
  }
  remove(c) {
    if (!this.colliders.has(c)) return;
    for (const k of c.cells) { const a = this.grid.get(k); if (a) { const i = a.indexOf(c); if (i >= 0) a.splice(i, 1); } }
    this.colliders.delete(c);
  }
  addBox(center, half, yaw = 0, data = {}) {
    const c = { type: 'box', center: center.clone(), half: half.clone(), yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), data, bound: Math.hypot(half.x, half.z) + 0.1 };
    c.top = center.y + half.y; c.bottom = center.y - half.y;
    return this.insert(c);
  }
  addSphere(center, r, data = {}) {
    return this.insert({ type: 'sphere', center: center.clone(), r, data, bound: r, top: center.y + r, bottom: center.y - r });
  }
  query(x, z, r) {
    this.stamp++;
    const out = [];
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.grid.get(this.key(i, j));
      if (!a) continue;
      for (const c of a) if (c._s !== this.stamp) { c._s = this.stamp; out.push(c); }
    }
    return out;
  }
  toLocal(c, p, out) {
    const dx = p.x - c.center.x, dz = p.z - c.center.z;
    return out.set(dx * c.cos - dz * c.sin, p.y - c.center.y, dx * c.sin + dz * c.cos);
  }
  dirToWorld(c, v, out) { return out.set(v.x * c.cos + v.z * c.sin, v.y, -v.x * c.sin + v.z * c.cos); }

  // push a sphere out of all colliders; returns accumulated push and the last hit normal
  resolveSphere(pos, r, result = { push: new THREE.Vector3(), normal: new THREE.Vector3(), hit: null }) {
    result.push.set(0, 0, 0); result.hit = null;
    const list = this.query(pos.x, pos.z, r + 2);
    for (const c of list) {
      if (pos.y - r > c.top || pos.y + r < c.bottom) continue;
      if (c.type === 'sphere') {
        _d.subVectors(pos, c.center);
        const d = _d.length(), m = c.r + r - d;
        if (m > 0 && d > 1e-6) { _d.multiplyScalar(m / d); pos.add(_d); result.push.add(_d); result.normal.copy(_d).normalize(); result.hit = c; }
      } else {
        this.toLocal(c, pos, _l);
        const h = c.half;
        const cx = THREE.MathUtils.clamp(_l.x, -h.x, h.x), cy = THREE.MathUtils.clamp(_l.y, -h.y, h.y), cz = THREE.MathUtils.clamp(_l.z, -h.z, h.z);
        _d.set(_l.x - cx, _l.y - cy, _l.z - cz);
        let d = _d.length();
        if (d < r) {
          if (d < 1e-6) {
            const px = h.x - Math.abs(_l.x), py = h.y - Math.abs(_l.y), pz = h.z - Math.abs(_l.z);
            if (px < py && px < pz) _d.set(Math.sign(_l.x) * (px + r), 0, 0);
            else if (py < pz) _d.set(0, Math.sign(_l.y) * (py + r), 0);
            else _d.set(0, 0, Math.sign(_l.z) * (pz + r));
          } else _d.multiplyScalar((r - d) / d);
          this.dirToWorld(c, _d, _n);
          pos.add(_n); result.push.add(_n); result.normal.copy(_n).normalize(); result.hit = c;
        }
      }
    }
    return result;
  }

  // ground height including box tops (for walking on roofs)
  groundAt(x, z, y = 1e9, r = 0.3) {
    let g = this.terrain.heightAt(x, z);
    const list = this.query(x, z, r + 1);
    _v.set(x, y, z);
    for (const c of list) {
      if (c.type !== 'box' || c.data.noWalk) continue;
      this.toLocal(c, _v, _l);
      if (Math.abs(_l.x) <= c.half.x + r * 0.5 && Math.abs(_l.z) <= c.half.z + r * 0.5 && c.top <= y + 0.6 && c.top > g) g = c.top;
    }
    return g;
  }

  raycast(origin, dir, maxDist, { terrain = true, filter = null } = {}) {
    let best = null;
    const step = CELL;
    const n = Math.ceil(maxDist / step) + 1;
    this.stamp++;
    const stamp = this.stamp;
    for (let k = 0; k <= n; k++) {
      const t = Math.min(maxDist, k * step);
      const px = origin.x + dir.x * t, pz = origin.z + dir.z * t;
      const i0 = Math.floor(px / CELL) - 1, j0 = Math.floor(pz / CELL) - 1;
      for (let i = i0; i <= i0 + 2; i++) for (let j = j0; j <= j0 + 2; j++) {
        const a = this.grid.get(this.key(i, j));
        if (!a) continue;
        for (const c of a) {
          if (c._r === stamp) continue;
          c._r = stamp;
          if (filter && !filter(c)) continue;
          const hit = this.rayCollider(c, origin, dir, maxDist);
          if (hit && (!best || hit.dist < best.dist)) best = hit;
        }
      }
      if (best && best.dist < t - step) break;
    }
    if (terrain) {
      const tr = this.terrain.raycast(origin, dir, best ? best.dist : maxDist);
      if (tr && (!best || tr.t < best.dist)) {
        best = { dist: tr.t, point: tr.clone(), normal: this.terrain.normalAt(tr.x, tr.z), collider: null, terrain: true };
      }
    }
    return best;
  }

  rayCollider(c, o, d, maxDist) {
    if (c.type === 'sphere') {
      _v.subVectors(o, c.center);
      const b = _v.dot(d), cc = _v.lengthSq() - c.r * c.r, disc = b * b - cc;
      if (disc < 0) return null;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > maxDist) return null;
      const p = o.clone().addScaledVector(d, t);
      return { dist: t, point: p, normal: p.clone().sub(c.center).normalize(), collider: c };
    }
    this.toLocal(c, o, _l);
    const ld = _d.set(d.x * c.cos - d.z * c.sin, d.y, d.x * c.sin + d.z * c.cos);
    let tmin = 0, tmax = maxDist, axis = -1, sgn = 1;
    const h = c.half;
    for (let a = 0; a < 3; a++) {
      const oa = a === 0 ? _l.x : a === 1 ? _l.y : _l.z, da = a === 0 ? ld.x : a === 1 ? ld.y : ld.z, ha = a === 0 ? h.x : a === 1 ? h.y : h.z;
      if (Math.abs(da) < 1e-9) { if (oa < -ha || oa > ha) return null; continue; }
      let t1 = (-ha - oa) / da, t2 = (ha - oa) / da, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = a; sgn = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (axis < 0) return null;
    const ln = _n.set(axis === 0 ? sgn : 0, axis === 1 ? sgn : 0, axis === 2 ? sgn : 0);
    const wn = this.dirToWorld(c, ln, new THREE.Vector3());
    return { dist: tmin, point: o.clone().addScaledVector(d, tmin), normal: wn, collider: c };
  }
}
