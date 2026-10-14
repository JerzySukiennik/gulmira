// Mark III armor, built procedurally from section surfaces into a rigid-plate rig.
import * as THREE from 'three';
import { SectionSurface, SphereSurface, plate, tube, ribbed, orient, lerp, smooth } from './geom.js';

const PI = Math.PI;
const gauss = (x, s) => Math.exp(-(x * x) / (2 * s * s));
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const BONES = {
  pelvis: [0, 0.98, 0],
  spine: [0, 1.10, 0],
  chest: [0, 1.30, 0],
  neck: [0, 1.575, 0.008],
  head: [0, 1.638, 0.004],
  shoulder_R: [0.228, 1.49, 0], elbow_R: [0.228, 1.19, 0], wrist_R: [0.228, 0.915, 0],
  shoulder_L: [-0.228, 1.49, 0], elbow_L: [-0.228, 1.19, 0], wrist_L: [-0.228, 0.915, 0],
  hip_R: [0.102, 0.95, 0], knee_R: [0.102, 0.5, 0], ankle_R: [0.102, 0.075, 0],
  hip_L: [-0.102, 0.95, 0], knee_L: [-0.102, 0.5, 0], ankle_L: [-0.102, 0.075, 0],
};
const PARENT = {
  pelvis: null, spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck',
  shoulder_R: 'chest', elbow_R: 'shoulder_R', wrist_R: 'elbow_R',
  shoulder_L: 'chest', elbow_L: 'shoulder_L', wrist_L: 'elbow_L',
  hip_R: 'pelvis', knee_R: 'hip_R', ankle_R: 'knee_R',
  hip_L: 'pelvis', knee_L: 'hip_L', ankle_L: 'knee_L',
};

export function makeMaterials() {
  const red = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#9c100d'), metalness: 0.45, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.05 });
  const redDeep = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#6e0b09'), metalness: 0.45, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.07 });
  const gold = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#c79a50'), metalness: 1, roughness: 0.27, clearcoat: 0.5, clearcoatRoughness: 0.1 });
  const dark = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#2b2c30'), metalness: 0.85, roughness: 0.42 });
  const under = new THREE.MeshStandardMaterial({ color: new THREE.Color('#141416'), metalness: 0.6, roughness: 0.6 });
  const chrome = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#c9ccd2'), metalness: 1, roughness: 0.16 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color('#cfeeff'), emissiveIntensity: 9, roughness: 0.3 });
  const eye = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color('#e4f6ff'), emissiveIntensity: 14 });
  const socket = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0a0a0c'), metalness: 0.4, roughness: 0.5 });
  const rubber = new THREE.MeshStandardMaterial({ color: new THREE.Color('#121212'), metalness: 0.2, roughness: 0.75 });
  return { red, redDeep, gold, dark, under, chrome, glow, eye, socket, rubber };
}

function mirrorGeo(g) {
  const m = g.clone();
  m.scale(-1, 1, 1);
  orient(m);
  return m;
}

export function buildMk3(mats = makeMaterials()) {
  const root = new THREE.Group();
  root.name = 'mk3';
  const bones = {};
  for (const name of Object.keys(BONES)) {
    const b = new THREE.Group();
    b.name = name;
    bones[name] = b;
  }
  for (const [name, parent] of Object.entries(PARENT)) {
    const p = BONES[name];
    const pp = parent ? BONES[parent] : [0, 0, 0];
    bones[name].position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    (parent ? bones[parent] : root).add(bones[name]);
  }
  const parts = [];
  const add = (bone, geo, mat, name, opts = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = opts.shadow !== false;
    m.receiveShadow = true;
    bones[bone].add(m);
    parts.push(m);
    return m;
  };
  const absToBone = (geo, bone) => { const p = BONES[bone]; geo.translate(-p[0], -p[1], -p[2]); return geo; };

  // ------------------------------------------------------------------ torso
  const torsoRows = [
    { y: 0.86, w: 0.158, dF: 0.1, dB: 0.12, e: 2.3 },
    { y: 0.93, w: 0.184, dF: 0.11, dB: 0.13, e: 2.4 },
    { y: 1.0, w: 0.19, dF: 0.116, dB: 0.128, e: 2.5 },
    { y: 1.07, w: 0.178, dF: 0.115, dB: 0.116, e: 2.4 },
    { y: 1.14, w: 0.168, dF: 0.118, dB: 0.108, e: 2.3 },
    { y: 1.21, w: 0.18, dF: 0.13, dB: 0.112, e: 2.4 },
    { y: 1.28, w: 0.202, dF: 0.143, dB: 0.12, e: 2.6 },
    { y: 1.35, w: 0.226, dF: 0.157, dB: 0.128, e: 2.8 },
    { y: 1.42, w: 0.24, dF: 0.167, dB: 0.134, e: 3.0 },
    { y: 1.48, w: 0.243, dF: 0.163, dB: 0.136, e: 3.1 },
    { y: 1.535, w: 0.228, dF: 0.142, dB: 0.132, e: 2.9 },
    { y: 1.575, w: 0.18, dF: 0.106, dB: 0.112, e: 2.5 },
    { y: 1.605, w: 0.1, dF: 0.074, dB: 0.078, e: 2.1 },
  ];
  const torso = new SectionSurface(torsoRows, {
    bumps: [
      (t, y) => 0.013 * gauss(Math.abs(t) - 0.5, 0.3) * gauss(y - 1.44, 0.05) * (Math.cos(t) > 0 ? 1 : 0),
      (t, y) => -0.004 * gauss(t, 0.07) * gauss(y - 1.36, 0.12),
      (t, y) => 0.006 * gauss(t, 0.6) * gauss(y - 1.18, 0.07),
      (t, y) => 0.01 * gauss(Math.abs(t) - PI * 0.82, 0.35) * gauss(y - 1.42, 0.08),
    ],
  });
  const underTorso = new SectionSurface(torsoRows.map(r => ({ ...r, w: r.w - 0.012, dF: r.dF - 0.012, dB: r.dB - 0.012 })));
  add('chest', absToBone(tube(underTorso, 1.29, 1.6, { segA: 48, segB: 18 }), 'chest'), mats.under, 'underChest', { shadow: false });
  add('spine', absToBone(tube(underTorso, 1.05, 1.3, { segA: 48, segB: 12 }), 'spine'), mats.under, 'underSpine', { shadow: false });
  add('pelvis', absToBone(tube(underTorso, 0.87, 1.06, { segA: 48, segB: 10 }), 'pelvis'), mats.under, 'underPelvis', { shadow: false });

  const chestBottom = t => 1.315 + 0.05 * sm(0, 1.25, Math.abs(t)) - 0.012 * gauss(t, 0.18);
  const chestTop = t => 1.583 - 0.022 * sm(0.25, 1.1, Math.abs(t)) - 0.014 * gauss(t, 0.16);
  const P = (bone, region, opts, mat, name) => add(bone, absToBone(plate(torso, region, { segA: 40, segB: 28, ...opts }), bone), mat, name);
  P('chest', { a0: 0.014, a1: 1.3, b0: chestBottom, b1: chestTop }, { thickness: 0.008 }, mats.red, 'chestR');
  P('chest', { a0: -1.3, a1: -0.014, b0: chestBottom, b1: chestTop }, { thickness: 0.008 }, mats.red, 'chestL');
  P('chest', { a0: -0.95, a1: 0.95, b0: t => chestTop(t) + 0.008, b1: 1.612 }, { thickness: 0.006, offset: 0.002 }, mats.redDeep, 'collar');
  P('chest', { a0: 1.79, a1: PI - 0.012, b0: 1.27, b1: t => 1.585 - 0.02 * sm(0.4, 1.3, Math.abs(t - PI)) }, { thickness: 0.008 }, mats.red, 'backR');
  P('chest', { a0: PI + 0.012, a1: 2 * PI - 1.79, b0: 1.27, b1: t => 1.585 - 0.02 * sm(0.4, 1.3, Math.abs(t - PI)) }, { thickness: 0.008 }, mats.red, 'backL');
  const flapT = t => (Math.abs(t - PI) - 0.09) / 0.53;
  P('chest', { a0: PI + 0.075, a1: PI + 0.64, b0: t => 1.322 + 0.05 * flapT(t), b1: t => 1.566 - 0.025 * flapT(t) ** 2 }, { thickness: 0.003, offset: 0.0065, bevel: 0.001, segA: 18, segB: 16 }, mats.dark, 'flapRecessL');
  P('chest', { a0: PI - 0.64, a1: PI - 0.075, b0: t => 1.322 + 0.05 * flapT(t), b1: t => 1.566 - 0.025 * flapT(t) ** 2 }, { thickness: 0.003, offset: 0.0065, bevel: 0.001, segA: 18, segB: 16 }, mats.dark, 'flapRecessR');
  P('chest', { a0: PI + 0.09, a1: PI + 0.62, b0: t => 1.335 + 0.05 * flapT(t), b1: t => 1.555 - 0.025 * flapT(t) ** 2 }, { thickness: 0.009, offset: 0.022, bevel: 0.004, segA: 18, segB: 16 }, mats.red, 'backFlapL');
  P('chest', { a0: PI - 0.62, a1: PI - 0.09, b0: t => 1.335 + 0.05 * flapT(t), b1: t => 1.555 - 0.025 * flapT(t) ** 2 }, { thickness: 0.009, offset: 0.022, bevel: 0.004, segA: 18, segB: 16 }, mats.red, 'backFlapR');
  {
    const ys = [1.29, 1.34, 1.39, 1.44, 1.49, 1.535, 1.58];
    for (let i = 0; i < ys.length - 1; i++) {
      const wA = 0.07 - 0.012 * (i / (ys.length - 2));
      P('chest', { a0: PI - wA, a1: PI + wA, b0: ys[i] + 0.004, b1: ys[i + 1] - 0.004 }, { thickness: 0.01, offset: 0.016, bevel: 0.0035, segA: 8, segB: 6 }, mats.red, 'spineSeg' + i);
    }
  }
  for (const s of [1, -1]) {
    const a0 = s > 0 ? 1.32 : -1.77, a1 = s > 0 ? 1.77 : -1.32;
    const ys = [1.215, 1.29, 1.36, 1.44];
    for (let i = 0; i < ys.length - 1; i++) P('chest', { a0, a1, b0: ys[i] + 0.004, b1: ys[i + 1] - 0.004 }, { thickness: 0.006, segA: 16, segB: 10 }, i % 2 ? mats.redDeep : mats.red, 'rib' + s + i);
  }
  const abs = [1.05, 1.112, 1.172, 1.232];
  for (let i = 0; i < abs.length; i++) {
    const y0 = t => abs[i] + 0.004 + 0.012 * t * t;
    const y1 = i < abs.length - 1 ? (t => abs[i + 1] - 0.004 + 0.012 * t * t) : (t => chestBottom(t) - 0.008);
    const bone = abs[i] < 1.1 ? 'pelvis' : 'spine';
    P(bone, { a0: 0.01, a1: 0.95, b0: y0, b1: y1 }, { thickness: 0.007, segA: 24, segB: 10, offset: 0.004 }, mats.red, 'absR' + i);
    P(bone, { a0: -0.95, a1: -0.01, b0: y0, b1: y1 }, { thickness: 0.007, segA: 24, segB: 10, offset: 0.004 }, mats.red, 'absL' + i);
  }
  for (const s of [1, -1]) {
    P('spine', { a0: s > 0 ? 1.0 : -1.75, a1: s > 0 ? 1.75 : -1.0, b0: 1.075, b1: 1.205 }, { thickness: 0.007, segA: 18, segB: 10 }, mats.redDeep, 'oblique' + s);
  }
  for (let i = 0; i < 3; i++) {
    const y0 = 1.06 + i * 0.07, y1 = y0 + 0.064;
    P('spine', { a0: 1.82, a1: 2 * PI - 1.82, b0: y0, b1: y1 }, { thickness: 0.007, segA: 36, segB: 8 }, mats.red, 'lowback' + i);
    P('spine', { a0: PI - 0.06, a1: PI + 0.06, b0: y0 + 0.008, b1: y1 - 0.008 }, { thickness: 0.008, offset: 0.013, bevel: 0.003, segA: 6, segB: 4 }, mats.redDeep, 'spineLow' + i);
  }
  P('pelvis', { a0: -PI, a1: PI, b0: 0.998, b1: 1.044 }, { thickness: 0.006, segA: 72, segB: 6, offset: 0.006 }, mats.redDeep, 'belt');
  P('pelvis', { a0: -0.62, a1: 0.62, b0: t => 0.865 + 0.075 * (t / 0.62) ** 2, b1: 0.99 }, { thickness: 0.008, segA: 24, segB: 14 }, mats.red, 'codpiece');
  P('pelvis', { a0: PI - 0.78, a1: PI + 0.78, b0: t => 0.885 + 0.05 * ((t - PI) / 0.78) ** 2, b1: 0.99 }, { thickness: 0.008, segA: 24, segB: 12 }, mats.red, 'seat');
  for (const s of [1, -1]) P('pelvis', { a0: s > 0 ? 1.0 : -2.1, a1: s > 0 ? 2.1 : -1.0, b0: 0.93, b1: 0.992 }, { thickness: 0.008, segA: 20, segB: 8, offset: 0.006 }, mats.red, 'hipPlate' + s);

  // arc reactor
  {
    const c = torso.point(0, 1.445);
    const g = new THREE.Group();
    g.position.set(c.x, c.y - BONES.chest[1], c.z + 0.002);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.008, 16, 48), mats.chrome);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.054, 0.02, 48), mats.dark);
    housing.rotation.x = PI / 2;
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.008, 48), mats.glow);
    lens.rotation.x = PI / 2; lens.position.z = -0.009;
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0035, 8, 32), mats.dark);
    coil.position.z = -0.012;
    ring.position.z = -0.009;
    g.add(housing, ring, lens, coil);
    bones.chest.add(g);
    parts.push(housing, ring, lens, coil);
    root.userData.reactor = lens;
  }
  // neck
  {
    const g = ribbed(0.06, 0.09, { ribs: 4, depth: 0.004 });
    g.translate(0, 0.075, 0);
    add('neck', g, mats.dark, 'neckRibs');
  }

  // ------------------------------------------------------------------ head
  {
    const helmet = new SectionSurface([
      { y: -0.05, w: 0.062, dF: 0.06, dB: 0.075, e: 2.2, z: 0.0 },
      { y: -0.005, w: 0.066, dF: 0.085, dB: 0.085, e: 2.4, z: -0.01 },
      { y: 0.03, w: 0.094, dF: 0.118, dB: 0.094, e: 2.7, z: -0.012 },
      { y: 0.075, w: 0.112, dF: 0.13, dB: 0.11, e: 2.9, z: -0.006 },
      { y: 0.125, w: 0.122, dF: 0.133, dB: 0.124, e: 3.0, z: 0 },
      { y: 0.175, w: 0.123, dF: 0.128, dB: 0.129, e: 2.8, z: 0.004 },
      { y: 0.215, w: 0.117, dF: 0.117, dB: 0.126, e: 2.6, z: 0.006 },
      { y: 0.25, w: 0.106, dF: 0.1, dB: 0.116, e: 2.5, z: 0.008 },
      { y: 0.277, w: 0.085, dF: 0.078, dB: 0.093, e: 2.3, z: 0.01 },
      { y: 0.294, w: 0.055, dF: 0.049, dB: 0.057, e: 2.1, z: 0.01 },
      { y: 0.302, w: 0.012, dF: 0.011, dB: 0.012, e: 2, z: 0.01 },
    ], {
      bumps: [
        (t, y) => -0.007 * gauss(Math.abs(t) - 0.62, 0.18) * gauss(y - 0.085, 0.035),
        (t, y) => 0.004 * gauss(t, 0.5) * gauss(y - 0.2, 0.012),
        (t, y) => 0.0025 * gauss(t, 0.06) * sm(0.02, 0.12, y) * (1 - sm(0.2, 0.26, y)),
        (t, y) => -0.006 * gauss(Math.abs(t) - 0.95, 0.2) * gauss(y - 0.03, 0.03),
        (t, y) => 0.004 * gauss(Math.abs(t) - PI / 2, 0.25) * gauss(y - 0.14, 0.04),
      ],
    });
    const faceTop = t => lerp(0.272, 0.212, sm(0.24, 0.36, Math.abs(t)));
    const faceBot = t => 0.0 + 0.052 * sm(0.55, 1.02, Math.abs(t));
    const H = (region, opts, mat, name) => add('head', plate(helmet, region, { segA: 36, segB: 30, thickness: 0.006, bevel: 0.0028, ...opts }), mat, name);
    H({ a0: -1.04, a1: 1.04, b0: faceBot, b1: faceTop }, { offset: 0.004, segA: 56, segB: 44 }, mats.gold, 'faceplate');
    const shellBot = t => 0.01 - 0.052 * (1 - sm(0.5, 1.7, Math.abs(t - PI)));
    const seam = t => 0.158 + 0.05 * sm(0.4, 2.0, Math.abs(t - PI));
    H({ a0: 1.07, a1: 2 * PI - 1.07, b0: shellBot, b1: seam }, { segA: 64, segB: 22 }, mats.red, 'shellBack');
    H({ a0: 1.07, a1: 2 * PI - 1.07, b0: t => seam(t) + 0.005, b1: 0.302 }, { segA: 64, segB: 26 }, mats.red, 'shellTop');
    H({ a0: PI - 0.085, a1: PI + 0.085, b0: 0.035, b1: 0.302 }, { offset: 0.0085, thickness: 0.005, bevel: 0.0025, segA: 8, segB: 34 }, mats.red, 'crownRidgeB');
    H({ a0: -0.07, a1: 0.07, b0: t => faceTop(t) + 0.006, b1: 0.302 }, { offset: 0.0085, thickness: 0.005, bevel: 0.0025, segA: 6, segB: 10 }, mats.red, 'crownRidgeF');
    H({ a0: PI - 1.25, a1: PI + 1.25, b0: t => shellBot(t) - 0.004, b1: t => shellBot(t) + 0.04 }, { offset: 0.0095, thickness: 0.006, bevel: 0.003, segA: 40, segB: 6 }, mats.redDeep, 'napeGuard');
    H({ a0: 0.27, a1: 1.07, b0: t => faceTop(t) + 0.006, b1: 0.302 }, { segA: 24, segB: 14 }, mats.red, 'browR');
    H({ a0: -1.07, a1: -0.27, b0: t => faceTop(t) + 0.006, b1: 0.302 }, { segA: 24, segB: 14 }, mats.red, 'browL');
    H({ a0: -0.29, a1: 0.29, b0: 0.272, b1: 0.302 }, { segA: 16, segB: 6 }, mats.red, 'crownFront');
    for (const s of [1, -1]) {
      const eyeLo = t => 0.157 + 0.018 * sm(0.12, 0.52, Math.abs(t));
      const eyeHi = t => eyeLo(t) + 0.015 - 0.006 * sm(0.38, 0.52, Math.abs(t)) - 0.004 * (1 - sm(0.12, 0.2, Math.abs(t)));
      const ra = s > 0 ? [0.13, 0.53] : [-0.53, -0.13];
      H({ a0: ra[0] - 0.02 * s, a1: ra[1] + 0.02 * s, b0: t => eyeLo(t) - 0.004, b1: t => eyeHi(t) + 0.004 }, { offset: 0.0062, thickness: 0.002, bevel: 0.001, segA: 20, segB: 4 }, mats.socket, 'socket' + s);
      H({ a0: ra[0], a1: ra[1], b0: eyeLo, b1: eyeHi }, { offset: 0.0078, thickness: 0.0015, bevel: 0.0012, segA: 20, segB: 4 }, mats.eye, 'eye' + s);
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.012, 40), mats.redDeep);
      const p = helmet.point(s * PI / 2, 0.135);
      ear.position.set(p.x + 0.004 * s, p.y, p.z);
      ear.rotation.z = PI / 2;
      const earIn = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.021, 0.016, 32), mats.dark);
      earIn.position.copy(ear.position); earIn.rotation.z = PI / 2;
      bones.head.add(ear, earIn);
      parts.push(ear, earIn);
    }
    H({ a0: -0.3, a1: 0.3, b0: t => 0.0535 - 0.0015 * (t / 0.3) ** 4, b1: t => 0.0565 - 0.0015 * (t / 0.3) ** 4 }, { offset: 0.0072, thickness: 0.0015, bevel: 0.0008, segA: 20, segB: 2 }, mats.socket, 'mouth');
    const underHead = new SectionSurface(helmet.rows.map(r => ({ ...r, w: r.w * 0.9, dF: r.dF * 0.9, dB: r.dB * 0.9 })));
    add('head', tube(underHead, -0.045, 0.3, { segA: 40, segB: 16 }), mats.under, 'headCore', { shadow: false });
  }

  // ------------------------------------------------------------------ arms (built as right, mirrored to left)
  const arm = {};
  {
    const G = [];
    const push = (bone, geo, mat, name) => G.push({ bone, geo, mat, name });
    const deltoid = (r) => new SphereSurface({ rx: r, ry: r * 0.9, rz: r * 1.02, cx: 0.03, cy: -0.004, cz: 0.004, bumps: [] });
    const d1 = deltoid(0.122), d2 = deltoid(0.13), d3 = deltoid(0.136);
    push('shoulder', plate(d1, { a0: PI / 2 - 1.75, a1: PI / 2 + 1.75, b0: 0.42, b1: 1.32 }, { segA: 40, segB: 18, thickness: 0.008, bevel: 0.004, offset: 0 }), mats.red, 'pauldron1');
    push('shoulder', plate(d2, { a0: PI / 2 - 1.6, a1: PI / 2 + 1.6, b0: -0.05, b1: 0.4 }, { segA: 40, segB: 12, thickness: 0.008, bevel: 0.004, offset: 0 }), mats.red, 'pauldron2');
    push('shoulder', plate(d3, { a0: PI / 2 - 1.35, a1: PI / 2 + 1.35, b0: -0.5, b1: -0.07 }, { segA: 36, segB: 12, thickness: 0.008, bevel: 0.004, offset: 0 }), mats.redDeep, 'pauldron3');
    const upper = new SectionSurface([
      { y: -0.3, w: 0.055, dF: 0.055, dB: 0.057, e: 2.2 },
      { y: -0.24, w: 0.062, dF: 0.064, dB: 0.065, e: 2.3 },
      { y: -0.16, w: 0.068, dF: 0.07, dB: 0.071, e: 2.4 },
      { y: -0.08, w: 0.07, dF: 0.068, dB: 0.072, e: 2.4 },
      { y: -0.01, w: 0.067, dF: 0.065, dB: 0.07, e: 2.3 },
    ], { bumps: [(t, y) => 0.005 * gauss(t, 0.5) * gauss(y + 0.15, 0.05)] });
    push('shoulder', tube(new SectionSurface(upper.rows.map(r => ({ ...r, w: r.w - 0.01, dF: r.dF - 0.01, dB: r.dB - 0.01 }))), -0.31, -0.01, { segA: 32, segB: 8 }), mats.under, 'underUpper');
    push('shoulder', plate(upper, { a0: -PI / 2 + 0.22, a1: PI * 1.5 - 0.22, b0: -0.265, b1: t => -0.07 - 0.03 * sm(0, 1, Math.cos(t - PI / 2)) }, { segA: 48, segB: 16, thickness: 0.007 }), mats.gold, 'bicep');
    push('shoulder', plate(upper, { a0: -PI / 2 + 0.22, a1: PI * 1.5 - 0.22, b0: -0.29, b1: -0.272 }, { segA: 48, segB: 3, thickness: 0.006, offset: 0.006 }), mats.redDeep, 'bicepRing');
    const elbowG = ribbed(0.05, 0.06, { ribs: 3, depth: 0.003 });
    elbowG.translate(0, 0.03, 0);
    push('elbow', elbowG, mats.dark, 'elbowJoint');
    const ecap = new SphereSurface({ r: 0.057, cz: 0.014 });
    push('elbow', plate(ecap, { a0: PI - 1.1, a1: PI + 1.1, b0: -0.9, b1: 0.75 }, { segA: 20, segB: 16, thickness: 0.006 }), mats.red, 'elbowCap');
    const fore = new SectionSurface([
      { y: -0.275, w: 0.047, dF: 0.04, dB: 0.044, e: 2.3 },
      { y: -0.225, w: 0.051, dF: 0.045, dB: 0.05, e: 2.4 },
      { y: -0.15, w: 0.058, dF: 0.052, dB: 0.057, e: 2.5 },
      { y: -0.07, w: 0.062, dF: 0.056, dB: 0.061, e: 2.5 },
      { y: -0.015, w: 0.057, dF: 0.052, dB: 0.056, e: 2.4 },
    ], { bumps: [(t, y) => 0.004 * gauss(t - PI / 2, 0.5) * gauss(y + 0.1, 0.06)] });
    push('elbow', tube(new SectionSurface(fore.rows.map(r => ({ ...r, w: r.w - 0.008, dF: r.dF - 0.008, dB: r.dB - 0.008 }))), -0.28, -0.02, { segA: 32, segB: 8 }), mats.under, 'underFore');
    push('elbow', plate(fore, { a0: 0.08, a1: PI - 0.08, b0: -0.244, b1: -0.03 }, { segA: 30, segB: 18, thickness: 0.007 }), mats.red, 'foreTop');
    push('elbow', plate(fore, { a0: PI + 0.08, a1: 2 * PI - 0.08, b0: -0.244, b1: -0.03 }, { segA: 30, segB: 18, thickness: 0.007 }), mats.red, 'foreBot');
    const cuff = new SectionSurface(fore.rows.map(r => ({ ...r, w: r.w + 0.005, dF: r.dF + 0.005, dB: r.dB + 0.005 })));
    push('elbow', plate(cuff, { a0: -PI, a1: PI, b0: -0.284, b1: -0.25 }, { segA: 48, segB: 4, thickness: 0.006, offset: 0.002 }), mats.redDeep, 'cuff');
    push('elbow', plate(fore, { a0: PI / 2 - 0.42, a1: PI / 2 + 0.42, b0: -0.19, b1: -0.075 }, { segA: 16, segB: 10, thickness: 0.006, offset: 0.011 }), mats.red, 'hatch');
    const wristG = ribbed(0.036, 0.04, { ribs: 3, depth: 0.002, rz: 1.15 });
    push('wrist', wristG, mats.dark, 'wristJoint');
    // hand: palm faces -X (inward), fingers along -Y, width along Z
    const palm = new SectionSurface([
      { y: -0.012, w: 0.021, dF: 0.036, dB: 0.034, e: 3 },
      { y: -0.05, w: 0.024, dF: 0.045, dB: 0.042, e: 3.2 },
      { y: -0.09, w: 0.021, dF: 0.046, dB: 0.043, e: 3.3 },
      { y: -0.105, w: 0.016, dF: 0.044, dB: 0.04, e: 3 },
    ]);
    push('wrist', tube(new SectionSurface(palm.rows.map(r => ({ ...r, w: r.w - 0.004, dF: r.dF - 0.004, dB: r.dB - 0.004 }))), -0.105, -0.012, { segA: 28, segB: 6 }), mats.under, 'palmCore');
    push('wrist', plate(palm, { a0: 0.22, a1: PI - 0.22, b0: -0.1, b1: -0.018 }, { segA: 24, segB: 12, thickness: 0.006 }), mats.red, 'handBack');
    push('wrist', plate(palm, { a0: PI + 0.25, a1: 2 * PI - 0.25, b0: -0.1, b1: -0.018 }, { segA: 24, segB: 12, thickness: 0.005 }), mats.redDeep, 'palm');
    {
      const pc = palm.point(-PI / 2, -0.058);
      const disc = new THREE.CylinderGeometry(0.0165, 0.0165, 0.004, 40);
      disc.rotateZ(PI / 2); disc.translate(pc.x - 0.006, pc.y, pc.z);
      push('wrist', disc, mats.glow, 'repulsor');
      const ring = new THREE.TorusGeometry(0.019, 0.0035, 10, 40);
      ring.rotateY(PI / 2); ring.translate(pc.x - 0.006, pc.y, pc.z);
      push('wrist', ring, mats.dark, 'repulsorRing');
    }
    arm.parts = G;
    // fingers: name, z, base y, lengths
    arm.fingers = [
      { n: 'index', z: -0.031, y: -0.105, L: [0.042, 0.027, 0.022], r: 0.0098 },
      { n: 'middle', z: -0.0105, y: -0.108, L: [0.046, 0.03, 0.023], r: 0.0102 },
      { n: 'ring', z: 0.0105, y: -0.106, L: [0.043, 0.028, 0.022], r: 0.0098 },
      { n: 'pinky', z: 0.03, y: -0.1, L: [0.034, 0.022, 0.019], r: 0.0088 },
    ];
  }
  const fingerSeg = (len, r, last) => {
    const s = new SectionSurface([
      { y: -len - (last ? 0.004 : 0), w: r * (last ? 0.45 : 0.85), dF: r * (last ? 0.45 : 0.85), e: 2.4 },
      { y: -len * 0.85, w: r * 0.95, dF: r * 0.95, e: 2.6 },
      { y: -len * 0.5, w: r, dF: r * 0.97, e: 2.7 },
      { y: -0.002, w: r * 1.02, dF: r, e: 2.6 },
    ]);
    const core = tube(new SectionSurface(s.rows.map(rw => ({ ...rw, w: rw.w * 0.82, dF: rw.dF * 0.82 }))), -len - 0.002, 0.002, { segA: 14, segB: 4 });
    const top = plate(s, { a0: 0.35, a1: PI - 0.35, b0: -len + 0.002, b1: -0.003 }, { segA: 12, segB: 6, thickness: 0.003, bevel: 0.0016, offset: 0.0015 });
    const bot = plate(s, { a0: PI + 0.45, a1: 2 * PI - 0.45, b0: -len + 0.003, b1: -0.004 }, { segA: 10, segB: 5, thickness: 0.0025, bevel: 0.0014, offset: 0.001 });
    return [core, top, bot];
  };
  for (const side of ['R', 'L']) {
    const mir = side === 'L';
    const map = { shoulder: 'shoulder_' + side, elbow: 'elbow_' + side, wrist: 'wrist_' + side };
    for (const p of arm.parts) add(map[p.bone], mir ? mirrorGeo(p.geo) : p.geo, p.mat, p.name + side);
    bones['fingers_' + side] = {};
    for (const f of arm.fingers) {
      let parent = bones['wrist_' + side];
      const chain = [];
      let y = f.y;
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Group();
        b.name = `${f.n}${k}_${side}`;
        b.position.set(0, k === 0 ? f.y : -f.L[k - 1], k === 0 ? f.z : 0);
        parent.add(b);
        const geos = fingerSeg(f.L[k], f.r * (1 - k * 0.06), k === 2);
        const mats3 = [mats.dark, mats.red, mats.redDeep];
        geos.forEach((g, gi) => {
          const m = new THREE.Mesh(mir ? mirrorGeo(g) : g, mats3[gi]);
          m.castShadow = true; b.add(m); parts.push(m);
        });
        chain.push(b);
        parent = b;
      }
      bones['fingers_' + side][f.n] = chain;
    }
    // thumb
    {
      let parent = bones['wrist_' + side];
      const chain = [];
      const L = [0.036, 0.028, 0.022];
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Group();
        b.name = `thumb${k}_${side}`;
        if (k === 0) { b.position.set(mir ? 0.012 : -0.012, -0.03, -0.04); b.rotation.set(-0.7, 0, mir ? -0.35 : 0.35); }
        else b.position.set(0, -L[k - 1], 0);
        parent.add(b);
        const geos = fingerSeg(L[k], 0.0115 * (1 - k * 0.08), k === 2);
        const mats3 = [mats.dark, mats.red, mats.redDeep];
        geos.forEach((g, gi) => { const m = new THREE.Mesh(mir ? mirrorGeo(g) : g, mats3[gi]); m.castShadow = true; b.add(m); parts.push(m); });
        chain.push(b);
        parent = b;
      }
      bones['fingers_' + side].thumb = chain;
    }
  }

  // ------------------------------------------------------------------ legs (right, mirrored)
  {
    const L = [];
    const push = (bone, geo, mat, name) => L.push({ bone, geo, mat, name });
    const thigh = new SectionSurface([
      { y: 0.035, w: 0.108, dF: 0.11, dB: 0.12, e: 2.3, x: 0.006 },
      { y: -0.06, w: 0.113, dF: 0.118, dB: 0.12, e: 2.4, x: 0.004 },
      { y: -0.16, w: 0.106, dF: 0.112, dB: 0.11, e: 2.4 },
      { y: -0.28, w: 0.093, dF: 0.1, dB: 0.096, e: 2.4 },
      { y: -0.38, w: 0.079, dF: 0.087, dB: 0.082, e: 2.3 },
      { y: -0.445, w: 0.071, dF: 0.078, dB: 0.073, e: 2.2 },
    ], { bumps: [(t, y) => 0.006 * gauss(t + 0.3, 0.45) * gauss(y + 0.3, 0.07)] });
    push('hip', tube(new SectionSurface(thigh.rows.map(r => ({ ...r, w: r.w - 0.012, dF: r.dF - 0.012, dB: r.dB - 0.012 }))), -0.45, 0.03, { segA: 36, segB: 10 }), mats.under, 'underThigh');
    const thighTop = t => -0.07 - 0.05 * sm(0, 1, Math.abs(t)) + 0.02 * gauss(t, 0.25);
    push('hip', plate(thigh, { a0: -0.98, a1: 0.98, b0: t => -0.405 + 0.025 * (t / 0.98) ** 2, b1: thighTop }, { segA: 32, segB: 26, thickness: 0.008, offset: 0.006 }), mats.gold, 'thighFront');
    push('hip', plate(thigh, { a0: 1.04, a1: 2.45, b0: -0.41, b1: 0.01 }, { segA: 20, segB: 24, thickness: 0.008 }), mats.red, 'thighOuter');
    push('hip', plate(thigh, { a0: -2.45, a1: -1.04, b0: -0.41, b1: -0.03 }, { segA: 20, segB: 24, thickness: 0.008 }), mats.red, 'thighInner');
    push('hip', plate(thigh, { a0: 2.5, a1: 2 * PI - 2.5, b0: -0.41, b1: 0.0 }, { segA: 22, segB: 24, thickness: 0.008 }), mats.red, 'thighBack');
    push('hip', plate(thigh, { a0: -1.0, a1: 1.0, b0: t => thighTop(t) + 0.008, b1: t => thighTop(t) + 0.06 }, { segA: 24, segB: 6, thickness: 0.007 }), mats.red, 'thighCap');
    const kneeG = ribbed(0.061, 0.075, { ribs: 3, depth: 0.003 });
    kneeG.translate(0, 0.035, 0);
    push('knee', kneeG, mats.dark, 'kneeJoint');
    const kc = new SphereSurface({ rx: 0.064, ry: 0.075, rz: 0.054, cz: -0.024, cy: 0.0 });
    push('knee', plate(kc, { a0: -1.15, a1: 1.15, b0: -0.95, b1: 0.95 }, { segA: 20, segB: 20, thickness: 0.008 }), mats.red, 'kneecap');
    for (const s of [1, -1]) {
      const d = new THREE.CylinderGeometry(0.026, 0.028, 0.012, 32);
      d.rotateZ(PI / 2); d.translate(s * 0.07, 0.0, 0.004);
      push('knee', d, mats.gold, 'kneeDisc' + s);
    }
    const shin = new SectionSurface([
      { y: -0.03, w: 0.074, dF: 0.076, dB: 0.08, e: 2.3 },
      { y: -0.1, w: 0.079, dF: 0.074, dB: 0.104, e: 2.4 },
      { y: -0.18, w: 0.075, dF: 0.07, dB: 0.097, e: 2.4 },
      { y: -0.28, w: 0.065, dF: 0.065, dB: 0.074, e: 2.4 },
      { y: -0.35, w: 0.062, dF: 0.066, dB: 0.066, e: 2.4 },
      { y: -0.405, w: 0.07, dF: 0.08, dB: 0.072, e: 2.6 },
    ], { bumps: [(t, y) => 0.006 * gauss(t, 0.2) * sm(-0.36, -0.1, y)] });
    push('knee', tube(new SectionSurface(shin.rows.map(r => ({ ...r, w: r.w - 0.01, dF: r.dF - 0.01, dB: r.dB - 0.01 }))), -0.42, -0.02, { segA: 32, segB: 10 }), mats.under, 'underShin');
    push('knee', plate(shin, { a0: -1.25, a1: 1.25, b0: -0.395, b1: t => -0.07 + 0.015 * gauss(t, 0.4) }, { segA: 30, segB: 26, thickness: 0.008 }), mats.red, 'shinFront');
    push('knee', plate(shin, { a0: 1.3, a1: 2 * PI - 1.3, b0: -0.395, b1: -0.055 }, { segA: 32, segB: 26, thickness: 0.008 }), mats.red, 'calf');
    push('knee', plate(shin, { a0: PI - 0.5, a1: PI + 0.5, b0: -0.3, b1: -0.11 }, { segA: 14, segB: 12, thickness: 0.006, offset: 0.012 }), mats.redDeep, 'calfFlap');
    const ankleG = ribbed(0.04, 0.05, { ribs: 2, depth: 0.003 });
    ankleG.translate(0, 0.04, 0);
    push('ankle', ankleG, mats.dark, 'ankleJoint');
    // boot along -Z: surface y = distance from heel, mapped to foot space
    const boot = new SectionSurface([
      { y: 0.0, w: 0.052, dF: 0.06, dB: 0.032, e: 2.4 },
      { y: 0.04, w: 0.064, dF: 0.1, dB: 0.036, e: 2.8 },
      { y: 0.11, w: 0.069, dF: 0.088, dB: 0.036, e: 3.2 },
      { y: 0.19, w: 0.07, dF: 0.056, dB: 0.036, e: 3.4 },
      { y: 0.265, w: 0.064, dF: 0.04, dB: 0.035, e: 3.2 },
      { y: 0.318, w: 0.045, dF: 0.027, dB: 0.032, e: 2.6 },
      { y: 0.335, w: 0.018, dF: 0.012, dB: 0.021, e: 2.2 },
    ]);
    const toFoot = g => {
      const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        p.setXYZ(i, x, -z - 0.035, 0.085 - y);
        if (n) { const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i); n.setXYZ(i, nx, -nz, -ny); }
      }
      g.computeBoundingSphere();
      return orient(g);
    };
    push('ankle', toFoot(plate(boot, { a0: -1.25, a1: 1.25, b0: 0.005, b1: 0.312 }, { segA: 28, segB: 30, thickness: 0.008 })), mats.red, 'bootTop');
    push('ankle', toFoot(plate(boot, { a0: 1.3, a1: 2.05, b0: 0.005, b1: 0.3 }, { segA: 10, segB: 26, thickness: 0.008 })), mats.redDeep, 'bootSideR');
    push('ankle', toFoot(plate(boot, { a0: -2.05, a1: -1.3, b0: 0.005, b1: 0.3 }, { segA: 10, segB: 26, thickness: 0.008 })), mats.redDeep, 'bootSideL');
    push('ankle', toFoot(plate(boot, { a0: 2.1, a1: 2 * PI - 2.1, b0: 0.005, b1: 0.31 }, { segA: 20, segB: 26, thickness: 0.01, offset: 0.002 })), mats.rubber, 'sole');
    push('ankle', toFoot(plate(boot, { a0: PI * 0.5, a1: PI * 1.5, b0: -0.002, b1: 0.04 }, { segA: 16, segB: 6, thickness: 0.01 })), mats.redDeep, 'heel');
    for (const [z, r] of [[-0.12, 0.02], [0.04, 0.016]]) {
      const j = new THREE.CylinderGeometry(r, r, 0.004, 28);
      j.translate(0, -0.071, z);
      push('ankle', j, mats.glow, 'jet');
    }
    for (const side of ['R', 'L']) {
      const mir = side === 'L';
      const map = { hip: 'hip_' + side, knee: 'knee_' + side, ankle: 'ankle_' + side };
      for (const p of L) {
        const m = add(map[p.bone], mir ? mirrorGeo(p.geo) : p.geo, p.mat, p.name + side);
        if (p.name === 'jet') { m.castShadow = false; }
      }
    }
  }

  applyDetail(root);
  root.userData.bones = bones;
  root.userData.parts = parts;
  root.userData.mats = mats;
  return root;
}

// per-plate surface detail: x = grooves across u, y = grooves across v, z = rivets, w = desert dust
const DETAIL = [
  [/^chest/, [0, 2, 1, 0.12]], [/^backFlap/, [0, 1, 1, 0.15]], [/^back/, [1, 2, 1, 0.12]], [/^calfFlap/, [0, 1, 1, 0.7]], [/^collar/, [0, 0, 1, 0.1]], [/^abs/, [0, 0, 0, 0.18]], [/^rib/, [0, 0, 0, 0.15]],
  [/^oblique/, [0, 1, 0, 0.2]], [/^lowback/, [0, 0, 1, 0.2]], [/^codpiece/, [1, 0, 1, 0.25]], [/^seat/, [0, 1, 0, 0.25]], [/^hipPlate/, [0, 0, 1, 0.3]],
  [/^pauldron/, [2, 0, 1, 0.12]], [/^bicep/, [0, 2, 0, 0.15]], [/^elbowCap/, [0, 0, 1, 0.2]], [/^fore/, [0, 1, 1, 0.22]], [/^cuff/, [0, 0, 0, 0.25]], [/^hatch/, [1, 0, 1, 0.2]],
  [/^hand|^palm/, [0, 0, 0, 0.25]], [/^thighFront/, [0, 1, 1, 0.35]], [/^thigh(Outer|Inner|Back)/, [0, 2, 1, 0.4]], [/^thighCap/, [0, 0, 1, 0.35]],
  [/^kneecap/, [0, 1, 0, 0.55]], [/^shinFront/, [0, 2, 1, 0.75]], [/^calf/, [0, 1, 1, 0.75]], [/^boot|^heel/, [0, 1, 1, 1.0]],
  [/^faceplate/, [0, 0, 0, 0.08]], [/^shellBack/, [1, 0, 0, 0.1]], [/^shell|^brow|^crown/, [0, 0, 0, 0.1]], [/^napeGuard/, [0, 0, 1, 0.12]], [/^belt/, [0, 0, 1, 0.3]],
  [/^spineSeg|^spineLow/, [0, 0, 0, 0.12]],
];
function applyDetail(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const name = o.name || '';
    let d = [0, 0, 0, 0.3];
    for (const [re, v] of DETAIL) if (re.test(name)) { d = v; break; }
    const n = o.geometry.attributes.position.count;
    const arr = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) arr.set(d, i * 4);
    o.geometry.setAttribute('aDetail', new THREE.BufferAttribute(arr, 4));
  });
}

export const SUIT_DETAIL_GLSL = {
  vertPars: 'attribute vec4 aDetail;\nvarying vec4 vDetail;\nvarying vec2 vSuitUv;\nvarying vec3 vSuitObj;',
  vert: 'vDetail = aDetail;\nvSuitUv = uv;\nvSuitObj = position;',
  fragPars: `varying vec4 vDetail;
varying vec2 vSuitUv;
varying vec3 vSuitObj;
float sH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sN(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sH(i), sH(i + vec3(1, 0, 0)), f.x), mix(sH(i + vec3(0, 1, 0)), sH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sH(i + vec3(0, 0, 1)), sH(i + vec3(1, 0, 1)), f.x), mix(sH(i + vec3(0, 1, 1)), sH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`,
  frag: `
    float sGroove = 0.0;
    vec2 suv = vSuitUv;
    bool onPlate = suv.x > 0.0005 || suv.y > 0.0005;
    if (onPlate) {
      for (int k = 1; k <= 2; k++) {
        if (float(k) <= vDetail.y) { float c = float(k) / (vDetail.y + 1.0); sGroove = max(sGroove, smoothstep(0.007, 0.0015, abs(suv.y - c))); }
        if (float(k) <= vDetail.x) { float c = float(k) / (vDetail.x + 1.0); sGroove = max(sGroove, smoothstep(0.007, 0.0015, abs(suv.x - c))); }
      }
      if (vDetail.z > 0.5) {
        vec2 e = min(suv, 1.0 - suv);
        float edge = min(e.x, e.y);
        vec2 rc = vec2(fract(suv.x * 9.0), fract(suv.y * 9.0)) - 0.5;
        float riv = (1.0 - smoothstep(0.035, 0.05, edge)) * smoothstep(0.015, 0.03, edge) * (1.0 - smoothstep(0.12, 0.2, length(rc * vec2(1.0, 0.25)))) * step(e.y, e.x);
        sGroove = max(sGroove, riv * 0.6);
      }
    }
    vec3 sWN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    float sDustN = sN(vSuitObj * 38.0) * 0.6 + sN(vSuitObj * 9.0) * 0.4;
    float sDust = clamp(vDetail.w * (0.35 + 0.65 * smoothstep(-0.2, 0.7, sWN.y)) * smoothstep(0.25, 0.75, sDustN) * 1.2, 0.0, 0.85);
    float sScratch = smoothstep(0.82, 0.95, sN(vSuitObj * vec3(220.0, 18.0, 220.0))) * 0.5;
    roughnessFactor = clamp(roughnessFactor + sGroove * 0.4 + sDust * 0.5 + (sN(vSuitObj * 140.0) - 0.5) * 0.06, 0.03, 1.0);
    diffuseColor.rgb *= 1.0 - 0.72 * sGroove;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.29, 0.22), sDust * 0.55);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.52, 0.5), sScratch * 0.25);
  `,
  rough: `
    roughnessFactor = clamp(roughnessFactor + sGroove * 0.4 + sDust * 0.5 + (sN(vSuitObj * 140.0) - 0.5) * 0.06, 0.03, 1.0);
  `,
  clearcoat: `
    #ifdef USE_CLEARCOAT
      material.clearcoat *= 1.0 - sDust * 0.8 - sGroove * 0.6;
      material.clearcoatRoughness = clamp(material.clearcoatRoughness + sDust * 0.5 + sScratch * 0.2, 0.0, 1.0);
    #endif
  `,
};
