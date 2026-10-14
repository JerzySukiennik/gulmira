// Procedural skinned villagers and fighters: one shared geometry per body type, region-coloured per character.
import * as THREE from 'three';
import { SectionSurface, plate, tube, orient } from '../suit/geom.js';

const PI = Math.PI;
const gauss = (x, s) => Math.exp(-(x * x) / (2 * s * s));
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ARM_TILT = 0.2;

export const REG = { skin: 0, tunic: 1, trousers: 2, vest: 3, head: 4, hair: 5, shoes: 6, gear: 7, burqa: 8, eyes: 9 };

export const BONE_DEF = [
  ['hips', null, [0, 0.95, 0]],
  ['spine', 'hips', [0, 1.08, 0]],
  ['chest', 'spine', [0, 1.28, 0]],
  ['neck', 'chest', [0, 1.47, 0]],
  ['head', 'neck', [0, 1.54, 0]],
  ['upperarm_R', 'chest', [0.19, 1.42, 0]],
  ['forearm_R', 'upperarm_R', [0.19 + Math.sin(ARM_TILT) * 0.28, 1.42 - Math.cos(ARM_TILT) * 0.28, 0]],
  ['hand_R', 'forearm_R', [0.19 + Math.sin(ARM_TILT) * 0.54, 1.42 - Math.cos(ARM_TILT) * 0.54, 0]],
  ['upperarm_L', 'chest', [-0.19, 1.42, 0]],
  ['forearm_L', 'upperarm_L', [-0.19 - Math.sin(ARM_TILT) * 0.28, 1.42 - Math.cos(ARM_TILT) * 0.28, 0]],
  ['hand_L', 'forearm_L', [-0.19 - Math.sin(ARM_TILT) * 0.54, 1.42 - Math.cos(ARM_TILT) * 0.54, 0]],
  ['thigh_R', 'hips', [0.1, 0.94, 0]],
  ['shin_R', 'thigh_R', [0.1, 0.52, 0]],
  ['foot_R', 'shin_R', [0.1, 0.09, 0]],
  ['thigh_L', 'hips', [-0.1, 0.94, 0]],
  ['shin_L', 'thigh_L', [-0.1, 0.52, 0]],
  ['foot_L', 'shin_L', [-0.1, 0.09, 0]],
];
export const BONE_INDEX = Object.fromEntries(BONE_DEF.map(([n], i) => [n, i]));
const BP = Object.fromEntries(BONE_DEF.map(([n, , p]) => [n, new THREE.Vector3(...p)]));

class Collector {
  constructor() { this.pos = []; this.nor = []; this.reg = []; this.si = []; this.sw = []; this.idx = []; }
  add(geo, region, weightFn, regionFn = null) {
    geo = geo.index ? geo : geo;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const p = geo.attributes.position, n = geo.attributes.normal;
    const base = this.pos.length / 3;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      const r = regionFn ? regionFn(v, region) : region;
      this.reg.push(r);
      const w = weightFn(v);
      const ent = Object.entries(w).filter(([, x]) => x > 0.001).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const tot = ent.reduce((a, [, x]) => a + x, 0) || 1;
      for (let k = 0; k < 4; k++) {
        this.si.push(ent[k] ? BONE_INDEX[ent[k][0]] : 0);
        this.sw.push(ent[k] ? ent[k][1] / tot : 0);
      }
    }
    const ix = geo.index.array;
    for (let i = 0; i < ix.length; i++) this.idx.push(base + ix[i]);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aRegion', new THREE.Float32BufferAttribute(this.reg, 1));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.boundingSphere.radius = 2.5;
    return g;
  }
}

// weights
const torsoW = (v) => {
  const y = v.y, ax = Math.abs(v.x), side = v.x >= 0 ? 'R' : 'L';
  const w = {};
  if (y >= 1.28) { w.chest = 1; const k = sm(0.12, 0.2, ax) * sm(1.3, 1.4, y) * 0.55; if (k > 0) { w['upperarm_' + side] = k; w.chest = 1 - k; } const kn = sm(1.43, 1.49, y) * 0.6; if (kn > 0) { w.neck = kn; w.chest *= 1 - kn; } }
  else if (y >= 1.08) { const t = sm(1.08, 1.28, y); w.spine = 1 - t; w.chest = t; }
  else if (y >= 0.95) { const t = sm(0.95, 1.08, y); w.hips = 1 - t; w.spine = t; }
  else {
    const k = sm(0.95, 0.5, y) * 0.75;
    const sR = sm(-0.05, 0.05, v.x), sL = 1 - sR;
    w.hips = 1 - k; w.thigh_R = k * sR; w.thigh_L = k * sL;
    const kk = sm(0.62, 0.48, y) * 0.3;
    if (kk > 0) { w.shin_R = kk * sR; w.shin_L = kk * sL; }
  }
  return w;
};
const armW = (side) => (v) => {
  const s = BP['upperarm_' + side], e = BP['forearm_' + side], h = BP['hand_' + side];
  const axis = new THREE.Vector3().subVectors(h, s).normalize();
  const t = new THREE.Vector3().subVectors(v, s).dot(axis);
  const L1 = s.distanceTo(e), L2 = e.distanceTo(h);
  const w = {};
  if (t < L1 - 0.04) { w['upperarm_' + side] = 1; if (t < 0.05) { const k = (0.05 - t) / 0.1; w.chest = Math.min(0.5, k); } }
  else if (t < L1 + 0.04) { const k = sm(L1 - 0.04, L1 + 0.04, t); w['upperarm_' + side] = 1 - k; w['forearm_' + side] = k; }
  else if (t < L1 + L2 - 0.03) w['forearm_' + side] = 1;
  else if (t < L1 + L2 + 0.03) { const k = sm(L1 + L2 - 0.03, L1 + L2 + 0.03, t); w['forearm_' + side] = 1 - k; w['hand_' + side] = k; }
  else w['hand_' + side] = 1;
  return w;
};
const legW = (side) => (v) => {
  const y = v.y, w = {};
  if (y > 0.9) { const k = sm(0.9, 0.98, y) * 0.5; w['thigh_' + side] = 1 - k; w.hips = k; }
  else if (y > 0.56) w['thigh_' + side] = 1;
  else if (y > 0.48) { const k = sm(0.56, 0.48, y); w['thigh_' + side] = 1 - k; w['shin_' + side] = k; }
  else if (y > 0.12) w['shin_' + side] = 1;
  else if (y > 0.07) { const k = sm(0.12, 0.07, y); w['shin_' + side] = 1 - k; w['foot_' + side] = k; }
  else w['foot_' + side] = 1;
  return w;
};
const headW = (v) => (v.y < 1.53 ? { head: sm(1.49, 1.53, v.y), neck: 1 - sm(1.49, 1.53, v.y) } : { head: 1 });
const neckW = (v) => { const t = sm(1.46, 1.54, v.y); return { neck: 1 - t * 0.5, head: t * 0.5, chest: v.y < 1.47 ? 0.3 : 0 }; };

function armSurface(side, rows) {
  // build along -Y from the shoulder, then tilt outward about Z
  const s = new SectionSurface(rows);
  return { s, xform: (g) => { g.rotateZ(side === 'R' ? ARM_TILT : -ARM_TILT); g.translate(BP['upperarm_' + side].x, BP['upperarm_' + side].y, 0); return g; } };
}

export function buildHumanGeometry(opts = {}) {
  const { build = 1, beard = 1, headwear = 'turban', vest = true, gear = false, burqa = false, tunicLen = 0.5 } = opts;
  const C = new Collector();
  const W = build;
  // head
  const head = new SectionSurface([
    { y: 1.505, w: 0.036, dF: 0.05, dB: 0.03, e: 2, z: -0.026 },
    { y: 1.53, w: 0.056, dF: 0.084, dB: 0.056, e: 2.2, z: -0.012 },
    { y: 1.57, w: 0.068, dF: 0.094, dB: 0.074, e: 2.3, z: -0.004 },
    { y: 1.61, w: 0.074, dF: 0.099, dB: 0.088, e: 2.3, z: 0 },
    { y: 1.65, w: 0.077, dF: 0.097, dB: 0.097, e: 2.2, z: 0.002 },
    { y: 1.69, w: 0.077, dF: 0.089, dB: 0.1, e: 2.1, z: 0.004 },
    { y: 1.73, w: 0.066, dF: 0.071, dB: 0.088, e: 2, z: 0.006 },
    { y: 1.758, w: 0.042, dF: 0.043, dB: 0.056, e: 2, z: 0.008 },
    { y: 1.774, w: 0.008, dF: 0.008, dB: 0.01, e: 2, z: 0.01 },
  ], {
    bumps: [
      (t, y) => 0.024 * gauss(t, 0.11) * gauss(y - 1.612, 0.022),
      (t, y) => 0.006 * gauss(t, 0.6) * gauss(y - 1.672, 0.012),
      (t, y) => -0.009 * gauss(Math.abs(t) - 0.36, 0.12) * gauss(y - 1.648, 0.014),
      (t, y) => 0.018 * gauss(Math.abs(t) - PI / 2, 0.14) * gauss(y - 1.632, 0.028),
      (t, y) => 0.004 * gauss(Math.abs(t) - 0.62, 0.2) * gauss(y - 1.625, 0.02),
      (t, y) => beard > 0 ? 0.012 * beard * sm(1.6, 1.55, y) * sm(-0.2, 0.4, Math.cos(t)) : 0,
    ],
  });
  const headRegion = (v) => {
    if (beard > 0) {
      const a = Math.atan2(v.x, -(v.z));
      if (v.y < 1.6 && v.y > 1.505 && Math.cos(a) > -0.1 && !(v.y > 1.565 && Math.abs(a) < 0.25 && v.y < 1.585)) return REG.hair;
    }
    const a = Math.atan2(v.x, -(v.z));
    if (Math.abs(Math.abs(a) - 0.36) < 0.1 && Math.abs(v.y - 1.648) < 0.009) return REG.eyes;
    if (Math.abs(a) < 0.55 && Math.abs(v.y - 1.668) < 0.006) return REG.hair;
    if (v.y > 1.69 && headwear === 'none') return REG.hair;
    return REG.skin;
  };
  if (!burqa) C.add(tube(head, 1.505, 1.774, { segA: 44, segB: 26 }), REG.skin, headW, headRegion);
  C.add(tube(new SectionSurface([{ y: 1.44, w: 0.052, dF: 0.054 }, { y: 1.54, w: 0.047, dF: 0.05 }]), 1.44, 1.54, { segA: 18, segB: 4, caps: false }), REG.skin, neckW);
  // torso / tunic
  const hem = tunicLen;
  const torso = new SectionSurface([
    { y: hem, w: 0.25 * W, dF: 0.19 * W, dB: 0.21 * W, e: 2.1 },
    { y: hem + 0.12, w: 0.235 * W, dF: 0.165 * W, dB: 0.185 * W, e: 2.1 },
    { y: 0.8, w: 0.205 * W, dF: 0.14 * W, dB: 0.155 * W, e: 2.2 },
    { y: 0.95, w: 0.19 * W, dF: 0.125 * W, dB: 0.138 * W, e: 2.3 },
    { y: 1.05, w: 0.176 * W, dF: 0.12 * W, dB: 0.12 * W, e: 2.3 },
    { y: 1.18, w: 0.181 * W, dF: 0.126 * W, dB: 0.115 * W, e: 2.3 },
    { y: 1.3, w: 0.19 * W, dF: 0.128 * W, dB: 0.118 * W, e: 2.4 },
    { y: 1.4, w: 0.198 * W, dF: 0.11 * W, dB: 0.108 * W, e: 2.5 },
    { y: 1.45, w: 0.14, dF: 0.075, dB: 0.078, e: 2.2 },
    { y: 1.48, w: 0.062, dF: 0.058, dB: 0.06, e: 2 },
  ], { bumps: [(t, y) => 0.006 * Math.sin(t * 9 + y * 13) * sm(0.95, 0.6, y)] });
  if (!burqa) {
    C.add(tube(torso, hem, 1.48, { segA: 40, segB: 30, caps: false }), REG.tunic, torsoW);
    const inner = new SectionSurface(torso.rows.map(r => ({ ...r, w: r.w * 0.97, dF: r.dF * 0.97, dB: r.dB * 0.97 })));
    const innerG = tube(inner, hem, 0.95, { segA: 40, segB: 10, caps: false });
    const nn = innerG.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, -nn.getX(i), -nn.getY(i), -nn.getZ(i));
    orient(innerG);
    C.add(innerG, REG.tunic, torsoW);
  }
  // arms
  for (const side of ['R', 'L']) {
    const A = armSurface(side, [
      { y: -0.56, w: 0.012, dF: 0.026, dB: 0.026, e: 2.2 },
      { y: -0.5, w: 0.017, dF: 0.043, dB: 0.04, e: 2.6 },
      { y: -0.44, w: 0.02, dF: 0.045, dB: 0.042, e: 2.6 },
      { y: -0.4, w: 0.022, dF: 0.035, dB: 0.033, e: 2.3 },
    ]);
    const hand = A.xform(tube(A.s, -0.565, -0.395, { segA: 18, segB: 8 }));
    // hands are flat in z (palm faces the leg): swap x/z extents by rotating about the arm axis
    C.add(hand, REG.skin, armW(side));
    const S = armSurface(side, [
      { y: -0.4, w: 0.046 * W, dF: 0.046 * W, e: 2.1 },
      { y: -0.28, w: 0.05 * W, dF: 0.05 * W, e: 2.1 },
      { y: -0.14, w: 0.055 * W, dF: 0.056 * W, e: 2.1 },
      { y: 0.0, w: 0.06 * W, dF: 0.062 * W, e: 2.1 },
    ]);
    C.add(S.xform(tube(S.s, -0.4, 0.02, { segA: 20, segB: 16, caps: false })), burqa ? REG.burqa : REG.tunic, armW(side));
    // legs
    const x = BP['thigh_' + side].x;
    const leg = new SectionSurface([
      { y: 0.06, w: 0.05, dF: 0.055, e: 2, x },
      { y: 0.12, w: 0.062, dF: 0.066, e: 2, x },
      { y: 0.3, w: 0.068 * W, dF: 0.07 * W, e: 2, x },
      { y: 0.48, w: 0.074 * W, dF: 0.076 * W, e: 2, x },
      { y: 0.7, w: 0.082 * W, dF: 0.084 * W, e: 2, x },
      { y: 0.92, w: 0.09 * W, dF: 0.095 * W, e: 2, x },
      { y: 1.0, w: 0.085 * W, dF: 0.09 * W, e: 2, x: x * 0.7 },
    ], { bumps: [(t, y) => 0.005 * Math.sin(t * 7 + y * 20) * sm(0.35, 0.1, y)] });
    if (!burqa) C.add(tube(leg, 0.06, 1.0, { segA: 22, segB: 22, caps: false }), REG.trousers, legW(side));
    // foot (shoe/sandal) along -Z
    const foot = new SectionSurface([
      { y: 0, w: 0.035, dF: 0.04, dB: 0.02, e: 2.2 },
      { y: 0.05, w: 0.045, dF: 0.055, dB: 0.022, e: 2.6 },
      { y: 0.14, w: 0.048, dF: 0.035, dB: 0.022, e: 3 },
      { y: 0.22, w: 0.045, dF: 0.022, dB: 0.02, e: 3 },
      { y: 0.27, w: 0.03, dF: 0.014, dB: 0.016, e: 2.4 },
    ]);
    const fg = tube(foot, 0, 0.27, { segA: 18, segB: 10 });
    const p = fg.attributes.position;
    for (let i = 0; i < p.count; i++) { const fx = p.getX(i), fy = p.getY(i), fz = p.getZ(i); p.setXYZ(i, x + fx, 0.022 - fz, 0.06 - fy); }
    fg.computeVertexNormals(); orient(fg, (c, out) => out.set(c.x - x, c.y - 0.04, 0));
    fg.computeVertexNormals();
    C.add(fg, REG.shoes, legW(side));
  }
  if (vest && !burqa) {
    const vs = new SectionSurface(torso.rows.filter(r => r.y >= 0.8).map(r => ({ ...r, w: r.w + 0.012, dF: r.dF + 0.012, dB: r.dB + 0.012 })));
    C.add(plate(vs, { a0: 0.16, a1: 2 * PI - 0.16, b0: 0.98, b1: t => 1.43 - 0.06 * sm(0.4, 0.2, Math.abs(Math.sin(t / 2))) }, { segA: 36, segB: 16, thickness: 0.006, bevel: 0.003, offset: 0 }), REG.vest, torsoW);
  }
  if (gear && !burqa) {
    const gs = new SectionSurface(torso.rows.filter(r => r.y >= 0.9).map(r => ({ ...r, w: r.w + 0.02, dF: r.dF + 0.03, dB: r.dB + 0.02 })));
    for (const [a0, a1] of [[-0.62, -0.24], [-0.18, 0.18], [0.24, 0.62]]) C.add(plate(gs, { a0, a1, b0: 1.1, b1: 1.24 }, { segA: 8, segB: 6, thickness: 0.035, bevel: 0.008, offset: 0.006 }), REG.gear, torsoW);
    C.add(plate(gs, { a0: -PI, a1: PI, b0: 1.0, b1: 1.045 }, { segA: 48, segB: 3, thickness: 0.01, bevel: 0.004, offset: 0.004 }), REG.gear, torsoW);
  }
  // headwear
  if (!burqa && headwear === 'turban') {
    const tb = new SectionSurface([
      { y: 1.655, w: 0.084, dF: 0.1, dB: 0.104, e: 2.1, z: 0.006 },
      { y: 1.69, w: 0.1, dF: 0.11, dB: 0.118, e: 2.2, z: 0.006 },
      { y: 1.74, w: 0.104, dF: 0.11, dB: 0.12, e: 2.2, z: 0.008 },
      { y: 1.785, w: 0.088, dF: 0.092, dB: 0.1, e: 2.1, z: 0.01 },
      { y: 1.81, w: 0.05, dF: 0.052, dB: 0.058, e: 2, z: 0.01 },
      { y: 1.82, w: 0.01, dF: 0.01, dB: 0.012, e: 2, z: 0.01 },
    ], { bumps: [(t, y) => 0.007 * Math.sin(t * 2 + y * 120) + 0.004 * Math.sin(t * 5 - y * 60)] });
    C.add(tube(tb, 1.655, 1.82, { segA: 36, segB: 16 }), REG.head, headW);
  } else if (!burqa && headwear === 'pakol') {
    const pk = new SectionSurface([
      { y: 1.69, w: 0.088, dF: 0.096, dB: 0.104, e: 2, z: 0.006 },
      { y: 1.705, w: 0.1, dF: 0.108, dB: 0.116, e: 2, z: 0.006 },
      { y: 1.735, w: 0.103, dF: 0.11, dB: 0.118, e: 2, z: 0.006 },
      { y: 1.755, w: 0.096, dF: 0.103, dB: 0.11, e: 2, z: 0.006 },
      { y: 1.775, w: 0.09, dF: 0.096, dB: 0.104, e: 2.4, z: 0.006 },
      { y: 1.785, w: 0.02, dF: 0.02, dB: 0.02, e: 2, z: 0.006 },
    ]);
    C.add(tube(pk, 1.69, 1.785, { segA: 36, segB: 10 }), REG.head, headW);
  } else if (!burqa && headwear === 'shemagh') {
    const sh = new SectionSurface([
      { y: 1.4, w: 0.2, dF: 0.12, dB: 0.13, e: 2.2, z: 0.01 },
      { y: 1.47, w: 0.13, dF: 0.1, dB: 0.105, e: 2.1, z: 0.01 },
      { y: 1.53, w: 0.075, dF: 0.1, dB: 0.09, e: 2.1, z: -0.004 },
      { y: 1.6, w: 0.088, dF: 0.108, dB: 0.1, e: 2.2, z: 0 },
      { y: 1.68, w: 0.09, dF: 0.105, dB: 0.11, e: 2.2, z: 0.004 },
      { y: 1.74, w: 0.08, dF: 0.088, dB: 0.1, e: 2.1, z: 0.006 },
      { y: 1.785, w: 0.045, dF: 0.045, dB: 0.06, e: 2, z: 0.008 },
      { y: 1.8, w: 0.01, dF: 0.01, dB: 0.01, e: 2, z: 0.01 },
    ], { bumps: [(t, y) => 0.004 * Math.sin(t * 6 + y * 50)] });
    const faceOpen = (t) => 1.69;
    C.add(plate(sh, { a0: 0.62, a1: 2 * PI - 0.62, b0: 1.4, b1: 1.8 }, { segA: 40, segB: 24, thickness: 0.006, bevel: 0.003, offset: 0.004 }), REG.head, (v) => (v.y < 1.5 ? { chest: 0.6, neck: 0.4 } : headW(v)));
    C.add(plate(sh, { a0: -0.64, a1: 0.64, b0: 1.66, b1: 1.8 }, { segA: 14, segB: 8, thickness: 0.006, bevel: 0.003, offset: 0.004 }), REG.head, headW);
    void faceOpen;
  } else if (!burqa && headwear === 'cap') {
    const cp = new SectionSurface([
      { y: 1.7, w: 0.082, dF: 0.092, dB: 0.1, e: 2, z: 0.006 },
      { y: 1.74, w: 0.08, dF: 0.088, dB: 0.098, e: 2.3, z: 0.006 },
      { y: 1.765, w: 0.074, dF: 0.08, dB: 0.09, e: 2.6, z: 0.006 },
      { y: 1.772, w: 0.01, dF: 0.01, dB: 0.01, e: 2, z: 0.006 },
    ]);
    C.add(tube(cp, 1.7, 1.772, { segA: 32, segB: 6 }), REG.head, headW);
  }
  if (burqa) {
    const bq = new SectionSurface([
      { y: 0.05, w: 0.3, dF: 0.26, dB: 0.3, e: 2 },
      { y: 0.5, w: 0.27, dF: 0.22, dB: 0.25, e: 2 },
      { y: 0.95, w: 0.22, dF: 0.16, dB: 0.18, e: 2.1 },
      { y: 1.25, w: 0.23, dF: 0.15, dB: 0.17, e: 2.1 },
      { y: 1.42, w: 0.21, dF: 0.13, dB: 0.14, e: 2.1 },
      { y: 1.5, w: 0.1, dF: 0.11, dB: 0.1, e: 2 },
      { y: 1.62, w: 0.09, dF: 0.112, dB: 0.1, e: 2.1 },
      { y: 1.72, w: 0.085, dF: 0.095, dB: 0.1, e: 2.1 },
      { y: 1.78, w: 0.05, dF: 0.05, dB: 0.06, e: 2 },
      { y: 1.795, w: 0.01, dF: 0.01, dB: 0.012, e: 2 },
    ], { bumps: [(t, y) => 0.012 * Math.sin(t * 11 + y * 3) * sm(1.3, 0.3, y)] });
    C.add(tube(bq, 0.05, 1.795, { segA: 48, segB: 40, caps: false }), REG.burqa, (v) => (v.y > 1.5 ? headW(v) : torsoW(v)), (v) => {
      const a = Math.atan2(v.x, -v.z);
      if (Math.abs(a) < 0.5 && Math.abs(v.y - 1.645) < 0.025) return REG.eyes;
      return REG.burqa;
    });
  }
  return C.build();
}

export function makeBones() {
  const bones = {}, list = [];
  for (const [name, parent, pos] of BONE_DEF) {
    const b = new THREE.Bone();
    b.name = name;
    const pp = parent ? BP[parent] : new THREE.Vector3();
    b.position.set(pos[0] - pp.x, pos[1] - pp.y, pos[2] - pp.z);
    if (parent) bones[parent].add(b);
    bones[name] = b;
    list.push(b);
  }
  return { bones, list, root: bones.hips };
}

const HUMAN_FRAG_PARS = /* glsl */`
uniform vec3 uPal[10];
uniform float uRough[10];
varying float vRegion;
varying vec3 vBind;
float hHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hNoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hHash(i), hHash(i + vec3(1, 0, 0)), f.x), mix(hHash(i + vec3(0, 1, 0)), hHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hHash(i + vec3(0, 0, 1)), hHash(i + vec3(1, 0, 1)), f.x), mix(hHash(i + vec3(0, 1, 1)), hHash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
`;

export function makeHumanMaterial(atmo, palette) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const pal = palette.map(c => new THREE.Color(c));
  const rough = [0.55, 0.95, 0.95, 0.9, 0.95, 0.85, 0.8, 0.75, 0.95, 0.3];
  atmo.patch(mat, {
    key: 'human',
    extra: (sh) => {
      sh.uniforms.uPal = { value: pal };
      sh.uniforms.uRough = { value: rough };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aRegion;\nvarying float vRegion;\nvarying vec3 vBind;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = aRegion;\nvBind = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + HUMAN_FRAG_PARS)
        .replace('#include <map_fragment>', /* glsl */`
          int ri = int(vRegion + 0.5);
          vec3 hc = uPal[0];
          float hr = uRough[0];
          for (int i = 0; i < 10; i++) if (i == ri) { hc = uPal[i]; hr = uRough[i]; }
          float weave = hNoise(vBind * vec3(9.0, 3.0, 9.0)) * 0.08 + hNoise(vBind * 60.0) * 0.03;
          float dirt = smoothstep(0.45, 0.0, vBind.y) * 0.3 + hNoise(vBind * 4.0) * 0.06;
          if (ri != 0 && ri != 9) hc *= (0.95 + weave) * (1.0 - dirt);
          else if (ri == 0) hc *= 0.97 + hNoise(vBind * 40.0) * 0.06;
          diffuseColor.rgb = hc;
        `)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = hr;')
        .replace('#include <normal_fragment_maps>', /* glsl */`
          if (ri != 0 && ri != 9) {
            vec3 fp = vBind * vec3(22.0, 5.0, 22.0);
            float e = 0.08;
            float n0 = hNoise(fp);
            vec3 g = vec3(hNoise(fp + vec3(e, 0.0, 0.0)) - n0, 0.0, hNoise(fp + vec3(0.0, 0.0, e)) - n0) / e;
            normal = normalize(normal - (viewMatrix * vec4(g * 0.12, 0.0)).xyz);
          }
        `);
    },
  });
  mat.userData.palette = pal;
  return mat;
}

// weapons
export function buildAK(mats) {
  const g = new THREE.Group();
  const metal = mats.gunmetal, wood = mats.wood;
  const box = (w, h, d, x, y, z, m, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; b.castShadow = true; g.add(b); return b; };
  const cyl = (r, l, x, y, z, m) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 10), m); c.rotation.x = PI / 2; c.position.set(x, y, z); c.castShadow = true; g.add(c); return c; };
  // forward = -Z, origin at the pistol grip top
  box(0.036, 0.05, 0.25, 0, 0.018, -0.07, metal);
  box(0.03, 0.02, 0.22, 0, 0.05, -0.08, metal);
  box(0.042, 0.04, 0.17, 0, 0.022, -0.27, wood);
  box(0.03, 0.022, 0.14, 0, 0.052, -0.26, wood);
  cyl(0.009, 0.44, 0, 0.03, -0.48, metal);
  cyl(0.007, 0.26, 0, 0.055, -0.4, metal);
  box(0.006, 0.03, 0.01, 0, 0.055, -0.66, metal);
  box(0.03, 0.08, 0.035, 0, -0.04, 0.0, wood, -0.25);
  for (let i = 0; i < 5; i++) box(0.024, 0.045, 0.034, 0, -0.03 - i * 0.034, -0.12 + i * 0.012, metal, 0.18 + i * 0.07);
  const stock = box(0.036, 0.055, 0.26, 0, -0.01, 0.17, wood, 0.12);
  stock.scale.set(1, 1, 1);
  g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.71);
  g.userData.grip = new THREE.Vector3(0, -0.03, 0);
  g.userData.fore = new THREE.Vector3(0, 0.0, -0.27);
  return g;
}

export function buildRPG(mats) {
  const g = new THREE.Group();
  const tubeG = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 14), mats.gunmetal);
  tubeG.rotation.x = PI / 2; tubeG.position.set(0, 0.05, -0.1); g.add(tubeG);
  const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 14), mats.wood);
  guard.rotation.x = PI / 2; guard.position.set(0, 0.05, -0.08); g.add(guard);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2, 14), mats.olive);
  cone.rotation.x = -PI / 2; cone.position.set(0, 0.05, -0.75); g.add(cone);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 10), mats.olive);
  bulb.position.set(0, 0.05, -0.62); g.add(bulb);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.035), mats.gunmetal);
  grip.position.set(0, -0.02, 0); grip.rotation.x = -0.2; g.add(grip);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData.muzzle = new THREE.Vector3(0, 0.05, -0.85);
  g.userData.grip = new THREE.Vector3(0, -0.03, 0);
  g.userData.fore = new THREE.Vector3(0, 0.0, -0.2);
  g.userData.warhead = [cone, bulb];
  return g;
}

export const PALETTES = {
  skin: ['#8a5a3c', '#9b6a48', '#7a4e33', '#a87a58', '#6e472f'],
  cloth: ['#cfc6b4', '#b9b09c', '#8f8a7d', '#6f6a5f', '#4f4b44', '#7d6f58', '#5d5446', '#a39a87', '#c7c2b8', '#3b3c3a', '#56604f', '#6b5b4a'],
  vest: ['#2d2c2a', '#3a352e', '#4a4036', '#24262a', '#57504a', '#2f3329'],
  head: ['#e8e2d4', '#2c2b29', '#7a6f5d', '#b7ad99', '#4c4a46', '#d9d2c2', '#5f6a7a'],
  hair: ['#1b1714', '#24201c', '#2e2924', '#5a5652'],
  burqa: ['#4f6f9f', '#5a7cab', '#46658f', '#8a8c9a'],
};
