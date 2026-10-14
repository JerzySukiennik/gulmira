// Hand-built T-72 and Hilux technical from real dimensions. Facing -Z, ground at y = 0.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SectionSurface, tube } from '../suit/geom.js';

const PI = Math.PI;

function mesh(geo, mat, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
const rbox = (w, h, d, r = 0.03, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
const cyl = (r0, r1, h, seg = 16, open = false) => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open);

// side profile (z, y) extruded across x
function profileExtrude(pts, width, bevel = 0.04) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-PI / 2);
  g.computeVertexNormals();
  return g;
}

function wheelGeo(r, w, hub = 0.5) {
  const pts = [];
  const rr = r * 0.12;
  pts.push(new THREE.Vector2(0.001, -w / 2));
  pts.push(new THREE.Vector2(r * hub, -w / 2));
  pts.push(new THREE.Vector2(r * (hub + 0.05), -w / 2 - 0.01));
  for (let i = 0; i <= 6; i++) { const a = -PI / 2 + i / 6 * PI / 2; pts.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, -w / 2 + rr + Math.sin(a) * rr)); }
  for (let i = 0; i <= 6; i++) { const a = i / 6 * PI / 2; pts.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, w / 2 - rr + Math.sin(a) * rr)); }
  pts.push(new THREE.Vector2(r * (hub + 0.05), w / 2 + 0.01));
  pts.push(new THREE.Vector2(r * hub, w / 2));
  pts.push(new THREE.Vector2(0.001, w / 2));
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateZ(PI / 2);
  return g;
}

// ------------------------------------------------------------------ T-72
export function buildTank(M) {
  const root = new THREE.Group();
  const paint = M.paint('#7f7759'), paintDk = M.paint('#5f5a44'), paintLt = M.paint('#8f876a');
  const hull = new THREE.Group();
  root.add(hull);
  // hull body: upper glacis, deck, rear plate, belly
  const hullProfile = [[-3.42, 0.62], [-3.5, 0.86], [-2.32, 1.46], [3.18, 1.5], [3.42, 1.32], [3.45, 0.62], [3.2, 0.48], [-3.2, 0.48]];
  mesh(profileExtrude(hullProfile, 2.28, 0.05), paint, hull);
  // fenders and skirts
  for (const s of [-1, 1]) {
    const fx = s * 1.47;
    mesh(rbox(0.66, 0.05, 6.75, 0.015), paint, hull, fx, 1.06, 0.05);
    mesh(rbox(0.66, 0.05, 0.55, 0.015), paint, hull, fx, 0.98, -3.55, -0.5);
    for (let i = 0; i < 6; i++) mesh(rbox(0.035, 0.42, 1.0, 0.01), paintDk, hull, s * 1.79, 0.86, -2.65 + i * 1.07, 0, 0, s * 0.05);
    for (let i = 0; i < 3; i++) mesh(rbox(0.5, 0.28, 0.62, 0.02), paintLt, hull, s * 1.5, 1.22, -0.8 + i * 1.1);
  }
  // running gear
  const roadW = wheelGeo(0.375, 0.42, 0.38);
  const hubGeo = cyl(0.12, 0.12, 0.46, 12);
  hubGeo.rotateZ(PI / 2);
  const wheels = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const w = new THREE.Group();
      w.position.set(s * 1.48, 0.42, -2.42 + i * 0.83);
      hull.add(w);
      mesh(roadW, M.rubber, w);
      mesh(hubGeo, paintDk, w);
      wheels.push(w);
    }
    const spr = new THREE.Group(); spr.position.set(s * 1.48, 0.62, 3.05); hull.add(spr);
    mesh(cyl(0.3, 0.3, 0.36, 14), M.dark, spr, 0, 0, 0, 0, 0, PI / 2);
    for (let k = 0; k < 12; k++) { const a = k / 12 * PI * 2; mesh(rbox(0.36, 0.06, 0.06, 0.01), M.dark, spr, 0, Math.cos(a) * 0.33, Math.sin(a) * 0.33, a); }
    wheels.push(spr);
    const idl = new THREE.Group(); idl.position.set(s * 1.48, 0.6, -3.12); hull.add(idl);
    mesh(wheelGeo(0.3, 0.36, 0.45), M.dark, idl);
    wheels.push(idl);
    for (let k = 0; k < 3; k++) mesh(cyl(0.11, 0.11, 0.2, 10), M.dark, hull, s * 1.4, 0.9, -1.6 + k * 1.5, 0, 0, PI / 2);
  }
  // tracks: links along a loop
  const linkGeo = rbox(0.6, 0.055, 0.15, 0.012);
  const grouser = rbox(0.62, 0.03, 0.04, 0.008);
  const path = [];
  const addSeg = (z0, y0, z1, y1) => { const L = Math.hypot(z1 - z0, y1 - y0), n = Math.ceil(L / 0.155); for (let k = 0; k < n; k++) { const t = k / n; path.push([z0 + (z1 - z0) * t, y0 + (y1 - y0) * t, Math.atan2(y1 - y0, z1 - z0)]); } };
  const addArc = (cz, cy, r, a0, a1) => { const n = Math.ceil(Math.abs(a1 - a0) * r / 0.155); for (let k = 0; k < n; k++) { const a = a0 + (a1 - a0) * k / n; path.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r, a + PI / 2]); } };
  addSeg(-2.85, 0.03, 2.85, 0.03);
  addArc(3.05, 0.62, 0.36, -PI / 2 + 0.55, PI / 2);
  addSeg(3.05, 0.98, -3.12, 0.95);
  addArc(-3.12, 0.6, 0.35, PI / 2, PI * 1.5 - 0.45);
  const trackMat = M.dark;
  for (const s of [-1, 1]) {
    const im = new THREE.InstancedMesh(linkGeo, trackMat, path.length);
    const ig = new THREE.InstancedMesh(grouser, trackMat, path.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    path.forEach(([z, y, a], k) => {
      q.setFromEuler(new THREE.Euler(-a, 0, 0));
      m.compose(new THREE.Vector3(s * 1.48, y, z), q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(k, m);
      const off = new THREE.Vector3(0, -0.035, 0).applyQuaternion(q);
      m.compose(new THREE.Vector3(s * 1.48, y, z).add(off), q, new THREE.Vector3(1, 1, 1));
      ig.setMatrixAt(k, m);
    });
    im.castShadow = ig.castShadow = true; im.receiveShadow = true;
    hull.add(im, ig);
  }
  // glacis details: headlights, tow cables, splash board
  mesh(rbox(1.9, 0.06, 0.18, 0.02), paintDk, hull, 0, 1.12, -2.98, -1.15);
  for (const s of [-1, 1]) {
    mesh(cyl(0.07, 0.08, 0.14, 12), M.dark, hull, s * 1.0, 1.24, -2.72, -1.15);
    mesh(cyl(0.06, 0.06, 0.02, 12), M.light, hull, s * 1.0, 1.29, -2.75, -1.15);
  }
  // engine deck grilles, exhaust, fuel drums, log
  for (let i = 0; i < 7; i++) mesh(rbox(1.8, 0.02, 0.06, 0.005), M.dark, hull, 0, 1.52, 1.4 + i * 0.22);
  mesh(rbox(0.12, 0.3, 0.7, 0.03), M.dark, hull, -1.16, 1.1, 2.4);
  for (const s of [-1, 1]) {
    const drum = mesh(cyl(0.29, 0.29, 0.9, 18), paintLt, hull, s * 0.6, 1.25, 3.62, 0, 0, PI / 2);
    for (const k of [-0.3, 0, 0.3]) mesh(new THREE.TorusGeometry(0.295, 0.012, 6, 24), paintDk, drum, 0, k, 0, PI / 2);
  }
  mesh(cyl(0.13, 0.13, 3.2, 12), M.paint('#6b5236'), hull, 0, 1.6, 3.35, 0, 0, PI / 2);
  // turret
  const turret = new THREE.Group();
  turret.position.set(0, 1.5, -0.35);
  hull.add(turret);
  const tSurf = new SectionSurface([
    { y: 0.0, w: 1.17, dF: 1.28, dB: 1.08, e: 2.25 },
    { y: 0.18, w: 1.14, dF: 1.24, dB: 1.06, e: 2.3 },
    { y: 0.42, w: 1.04, dF: 1.08, dB: 0.98, e: 2.2 },
    { y: 0.62, w: 0.86, dF: 0.84, dB: 0.86, e: 2.1 },
    { y: 0.74, w: 0.6, dF: 0.55, dB: 0.62, e: 2.0 },
    { y: 0.78, w: 0.05, dF: 0.05, dB: 0.05, e: 2.0 },
  ], { bumps: [(t, y) => 0.03 * Math.sin(t * 3 + y * 7)] });
  mesh(tube(tSurf, 0, 0.78, { segA: 56, segB: 14 }), paint, turret);
  mesh(cyl(1.05, 1.05, 0.12, 40), paintDk, turret, 0, -0.02, 0);
  // stowage bin at the turret rear, snorkel
  mesh(rbox(1.5, 0.36, 0.42, 0.04), paintLt, turret, 0, 0.32, 1.12);
  mesh(cyl(0.08, 0.08, 1.6, 12), paintDk, turret, 0.25, 0.62, 1.38, 0, 0, PI / 2);
  // commander cupola + NSVT, gunner hatch, sight
  mesh(cyl(0.36, 0.38, 0.2, 24), paintDk, turret, 0.42, 0.78, 0.15);
  mesh(cyl(0.33, 0.33, 0.06, 24), paint, turret, 0.42, 0.9, 0.15);
  const mg = new THREE.Group(); mg.position.set(0.42, 1.0, 0.0); turret.add(mg);
  mesh(rbox(0.12, 0.12, 0.6, 0.015), M.dark, mg, 0, 0.05, -0.1);
  mesh(cyl(0.022, 0.022, 0.95, 8), M.dark, mg, 0, 0.06, -0.85, PI / 2);
  mesh(rbox(0.16, 0.16, 0.2, 0.02), M.paint('#4f5236'), mg, -0.15, -0.02, -0.05);
  mesh(cyl(0.3, 0.32, 0.12, 22), paintDk, turret, -0.45, 0.76, 0.2);
  mesh(rbox(0.28, 0.24, 0.3, 0.03), paintDk, turret, -0.62, 0.82, -0.5);
  mesh(rbox(0.2, 0.12, 0.04, 0.01), M.glass, turret, -0.62, 0.86, -0.66);
  // smoke grenade launchers
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) mesh(cyl(0.045, 0.045, 0.22, 10), M.dark, turret, s * (0.72 + k * 0.1), 0.48 - k * 0.02, -0.92 + k * 0.08, -PI / 2 + 0.35);
  // gun
  const gun = new THREE.Group();
  gun.position.set(0.0, 0.42, -1.12);
  turret.add(gun);
  mesh(rbox(0.62, 0.42, 0.42, 0.08), paint, gun, 0, 0, 0.05);
  const barrelPts = [];
  const prof = [[0, 0.11], [0.3, 0.1], [1.4, 0.085], [1.45, 0.095], [2.2, 0.095], [2.25, 0.13], [2.9, 0.13], [2.95, 0.085], [4.0, 0.08], [4.05, 0.088], [5.1, 0.083], [5.15, 0.075], [6.15, 0.07], [6.25, 0.09], [6.35, 0.09], [6.36, 0.0]];
  for (const [z, r] of prof) barrelPts.push(new THREE.Vector2(r, z));
  barrelPts.unshift(new THREE.Vector2(0.0, 0));
  const bg = new THREE.LatheGeometry(barrelPts, 20);
  bg.rotateX(-PI / 2);
  mesh(bg, paintDk, gun, 0, 0, -0.1);
  // IR searchlight on the right of the gun
  const ir = new THREE.Group(); ir.position.set(0.55, 0.15, -0.15); gun.add(ir);
  mesh(cyl(0.17, 0.19, 0.32, 18), paintDk, ir, 0, 0, 0, PI / 2);
  mesh(cyl(0.15, 0.15, 0.02, 18), M.glass, ir, 0, 0, -0.17, PI / 2);
  root.userData = {
    wheels, turret, gun,
    muzzles: [new THREE.Vector3(0, 0, -6.5)],
    size: new THREE.Vector3(3.6, 2.3, 6.95),
    halfExtents: new THREE.Vector3(1.8, 1.15, 3.5),
    parts: [turret],
  };
  return root;
}

// ------------------------------------------------------------------ Hilux technical
export function buildTechnical(M) {
  const root = new THREE.Group();
  const body = M.paint('#cfc7b2'), bodyDk = M.paint('#b5ac95'), black = M.rubber, trim = M.paint('#2a2a2a');
  const B = new THREE.Group();
  B.position.y = 0.0;
  root.add(B);
  // lower body sides profile (z, y) with cut-outs implied by fender flares
  const lower = [[-2.42, 0.48], [-2.45, 0.78], [-2.3, 0.98], [-0.85, 1.04], [0.62, 1.04], [2.38, 1.0], [2.42, 0.62], [2.3, 0.5], [1.75, 0.5], [1.68, 0.72], [1.35, 0.86], [0.92, 0.72], [0.85, 0.5], [-1.05, 0.5], [-1.12, 0.72], [-1.48, 0.86], [-1.88, 0.72], [-1.95, 0.5]];
  mesh(profileExtrude(lower, 1.66, 0.04), body, B);
  // hood and cab
  mesh(rbox(1.56, 0.08, 1.45, 0.03), body, B, 0, 1.04, -1.62);
  const cabProfile = [[-0.86, 1.04], [-0.42, 1.62], [0.48, 1.64], [0.6, 1.04]];
  mesh(profileExtrude(cabProfile, 1.58, 0.05), body, B);
  // windows
  const glass = M.glass;
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.62), glass);
  ws.position.set(0, 1.33 + 0.6 * 0.075, -0.64 - 0.8 * 0.075); ws.rotation.set(-2.498, 0, 0); B.add(ws);
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.42), glass);
    side.position.set(s * 0.8, 1.36, 0.05); side.rotation.y = s * PI / 2; B.add(side);
    mesh(rbox(0.02, 0.5, 0.012, 0.004), trim, B, s * 0.8, 1.3, -0.35);
    mesh(rbox(0.012, 0.012, 0.9, 0.004), trim, B, s * 0.835, 0.95, -0.15);
    mesh(rbox(0.012, 0.42, 0.012, 0.004), trim, B, s * 0.835, 0.78, 0.4);
    mesh(rbox(0.04, 0.02, 0.12, 0.008), trim, B, s * 0.84, 0.98, 0.18);
    const mir = new THREE.Group(); mir.position.set(s * 0.92, 1.22, -0.6); B.add(mir);
    mesh(rbox(0.04, 0.12, 0.17, 0.02), trim, mir);
  }
  const rw = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.36), glass);
  rw.position.set(0, 1.4, 0.61); rw.rotation.y = PI; B.add(rw);
  // grille, lights, bumpers
  mesh(rbox(1.3, 0.3, 0.06, 0.02), trim, B, 0, 0.82, -2.45);
  for (let i = 0; i < 4; i++) mesh(rbox(1.22, 0.025, 0.07, 0.006), M.chrome, B, 0, 0.72 + i * 0.065, -2.47);
  for (const s of [-1, 1]) {
    mesh(rbox(0.26, 0.14, 0.05, 0.02), M.chrome, B, s * 0.6, 0.86, -2.46);
    mesh(rbox(0.22, 0.1, 0.02, 0.01), M.light, B, s * 0.6, 0.86, -2.485);
    mesh(rbox(0.1, 0.22, 0.03, 0.01), M.paint('#7a1a12'), B, s * 0.74, 0.86, 2.43);
  }
  mesh(rbox(1.72, 0.16, 0.16, 0.04), black, B, 0, 0.55, -2.55);
  mesh(rbox(1.66, 0.12, 0.12, 0.03), black, B, 0, 0.55, 2.47);
  // fender flares
  for (const s of [-1, 1]) for (const z of [-1.5, 1.3]) {
    const fl = new THREE.TorusGeometry(0.47, 0.035, 6, 20, PI);
    mesh(fl, bodyDk, B, s * 0.83, 0.52, z, 0, PI / 2, 0);
  }
  // bed
  mesh(rbox(1.62, 0.04, 1.8, 0.01), bodyDk, B, 0, 0.98, 1.5);
  for (const s of [-1, 1]) mesh(rbox(0.05, 0.42, 1.82, 0.015), body, B, s * 0.8, 1.22, 1.5);
  mesh(rbox(1.62, 0.42, 0.05, 0.015), body, B, 0, 1.22, 2.4);
  mesh(rbox(1.62, 0.42, 0.05, 0.015), body, B, 0, 1.22, 0.62);
  // roll bar
  for (const s of [-1, 1]) mesh(cyl(0.03, 0.03, 0.75, 8), M.dark, B, s * 0.7, 1.8, 0.7);
  mesh(cyl(0.03, 0.03, 1.42, 8), M.dark, B, 0, 2.16, 0.7, 0, 0, PI / 2);
  // spare tyre and jerrycans in the bed
  mesh(wheelGeo(0.33, 0.24, 0.5), black, B, 0.45, 1.13, 2.05, 0, 0, PI / 2);
  for (let i = 0; i < 2; i++) mesh(rbox(0.16, 0.45, 0.34, 0.03), M.paint('#4e5634'), B, -0.62, 1.22, 1.95 - i * 0.38);
  // wheels
  const wheels = [];
  const tire = wheelGeo(0.37, 0.27, 0.58);
  const rim = cyl(0.21, 0.21, 0.28, 16);
  rim.rotateZ(PI / 2);
  for (const s of [-1, 1]) for (const z of [-1.5, 1.3]) {
    const w = new THREE.Group();
    w.position.set(s * 0.76, 0.37, z);
    B.add(w);
    mesh(tire, black, w);
    mesh(rim, M.metal, w);
    for (let k = 0; k < 6; k++) { const a = k / 6 * PI * 2; mesh(cyl(0.02, 0.02, 0.29, 6), M.dark, w, 0, Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0, 0, PI / 2); }
    wheels.push(w);
  }
  // DShK on a pedestal
  const turret = new THREE.Group();
  turret.position.set(0, 1.0, 1.25);
  B.add(turret);
  mesh(cyl(0.07, 0.09, 0.9, 12), M.dark, turret, 0, 0.45, 0);
  mesh(cyl(0.12, 0.12, 0.06, 14), M.dark, turret, 0, 0.88, 0);
  const gun = new THREE.Group();
  gun.position.set(0, 1.0, 0);
  turret.add(gun);
  mesh(rbox(0.12, 0.14, 0.62, 0.02), M.dark, gun, 0, 0, 0.05);
  const bp = [new THREE.Vector2(0, 0), new THREE.Vector2(0.032, 0), new THREE.Vector2(0.03, 0.9), new THREE.Vector2(0.026, 0.9), new THREE.Vector2(0.026, 1.0)];
  for (let k = 0; k < 6; k++) { bp.push(new THREE.Vector2(0.046, 0.18 + k * 0.05)); bp.push(new THREE.Vector2(0.03, 0.2 + k * 0.05)); }
  const bar = new THREE.Mesh(cyl(0.026, 0.03, 1.1, 10), M.dark);
  bar.rotation.x = PI / 2; bar.position.set(0, 0.02, -0.78); bar.castShadow = true; gun.add(bar);
  for (let k = 0; k < 7; k++) mesh(cyl(0.045, 0.045, 0.02, 10), M.dark, gun, 0, 0.02, -0.38 - k * 0.045, PI / 2);
  mesh(rbox(0.1, 0.06, 0.16, 0.01), M.dark, gun, 0, 0.02, -1.4);
  mesh(rbox(0.12, 0.2, 0.26, 0.02), M.paint('#4f5634'), gun, -0.14, -0.08, 0.05);
  for (const s of [-1, 1]) mesh(cyl(0.015, 0.015, 0.16, 6), M.dark, gun, s * 0.06, 0, 0.42, PI / 2);
  mesh(rbox(0.5, 0.36, 0.015, 0.01), M.dark, gun, 0, 0.12, -0.2);
  root.userData = {
    wheels, turret, gun,
    muzzles: [new THREE.Vector3(0, 0.02, -1.5)],
    gunnerPos: new THREE.Vector3(0, 1.0, 1.95),
    size: new THREE.Vector3(1.8, 2.2, 5.0),
    halfExtents: new THREE.Vector3(0.9, 0.95, 2.5),
    parts: [],
  };
  return root;
}

// ------------------------------------------------------------------ MAZ-543 TEL with a Scud-type missile
function decalTexture(text, w = 1024, h = 128, color = '#151515') {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.fillStyle = color;
  g.font = `600 ${Math.round(h * 0.62)}px 'Rajdhani', 'Arial Narrow', sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildTEL(M) {
  const root = new THREE.Group();
  const paint = M.paint('#596048'), paintDk = M.paint('#454a37'), paintLt = M.paint('#6c7357');
  const chassis = new THREE.Group();
  root.add(chassis);
  const wheels = [];
  const tire = wheelGeo(0.8, 0.55, 0.5);
  const hub = cyl(0.42, 0.42, 0.57, 18); hub.rotateZ(PI / 2);
  for (const z of [-3.9, -1.75, 1.25, 3.35]) for (const s of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(s * 1.2, 0.8, z); chassis.add(w);
    mesh(tire, M.rubber, w); mesh(hub, paintDk, w);
    for (let k = 0; k < 8; k++) { const a = k / 8 * PI * 2; mesh(cyl(0.03, 0.03, 0.6, 6), M.dark, w, 0, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0, 0, PI / 2); }
    wheels.push(w);
  }
  mesh(rbox(2.0, 0.55, 11.2, 0.05), paintDk, chassis, 0, 1.05, -0.2);
  for (const s of [-1, 1]) {
    mesh(rbox(0.7, 0.08, 4.0, 0.02), paint, chassis, s * 1.2, 1.72, -2.8);
    mesh(rbox(0.7, 0.08, 3.9, 0.02), paint, chassis, s * 1.2, 1.72, 2.3);
    for (const z of [-0.2, 0.55]) mesh(rbox(0.55, 0.62, 0.7, 0.04), paintLt, chassis, s * 1.25, 1.4, z);
    mesh(cyl(0.3, 0.3, 1.4, 16), paintLt, chassis, s * 1.15, 1.32, -0.2 + 0.0, PI / 2);
    for (let k = 0; k < 6; k++) mesh(rbox(0.04, 0.04, 0.5, 0.01), M.dark, chassis, s * 1.5, 0.95 + k * 0.12, 4.3, 0, 0, 0);
  }
  // split cabs
  for (const s of [-1, 1]) {
    const cab = new THREE.Group(); cab.position.set(s * 0.9, 1.3, -5.0); chassis.add(cab);
    mesh(rbox(1.15, 1.45, 1.9, 0.1), paint, cab, 0, 0.72, 0);
    mesh(rbox(1.02, 0.5, 0.04, 0.02), M.glass, cab, 0, 1.05, -0.96);
    mesh(rbox(0.04, 0.42, 0.9, 0.02), M.glass, cab, s * 0.58, 1.05, -0.3);
    mesh(rbox(1.1, 0.22, 0.08, 0.03), M.dark, cab, 0, 0.12, -0.98);
    mesh(cyl(0.09, 0.1, 0.06, 12), M.light, cab, s * 0.36, 0.3, -0.99, PI / 2);
    mesh(rbox(0.06, 0.3, 0.06, 0.02), M.dark, cab, s * 0.6, 1.3, -0.95);
  }
  // erector with the missile, hinged at the rear
  const erector = new THREE.Group();
  erector.position.set(0, 2.05, 4.55);
  chassis.add(erector);
  for (const s of [-1, 1]) {
    mesh(rbox(0.16, 0.28, 9.6, 0.03), paintDk, erector, s * 0.62, -0.25, -4.6);
    for (let k = 0; k < 5; k++) mesh(rbox(1.36, 0.1, 0.12, 0.02), paintDk, erector, 0, -0.3, -1.2 - k * 2.0);
  }
  mesh(cyl(0.18, 0.18, 1.7, 14), M.dark, erector, 0, 0, 0, 0, 0, PI / 2);
  mesh(cyl(0.14, 0.12, 4.2, 14), M.metal, erector, 0, -0.45, -4.4, PI / 2 + 0.1);
  const missile = new THREE.Group();
  missile.position.set(0, 0.45, -5.2);
  erector.add(missile);
  const white = M.paint('#dcdcd2'), band = M.paint('#2b2f24');
  const mp = [[0, 0], [0.18, 0], [0.32, 0.12], [0.42, 0.35], [0.44, 0.5], [0.44, 10.2], [0.4, 10.45], [0.32, 10.7]];
  const nosePts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; nosePts.push([0.44 * Math.sqrt(1 - t * t * 0.98), 0 - t * 2.4]); }
  const prof = [new THREE.Vector2(0, 2.6)];
  for (let i = nosePts.length - 1; i >= 0; i--) prof.push(new THREE.Vector2(nosePts[i][0], 2.6 + 2.4 * (1 - i / 10) - 2.4 + 0));
  void mp;
  const body = new THREE.LatheGeometry([new THREE.Vector2(0, -5.6), new THREE.Vector2(0.36, -5.6), new THREE.Vector2(0.44, -5.4), new THREE.Vector2(0.44, 3.2), new THREE.Vector2(0.42, 3.6), new THREE.Vector2(0.36, 4.3), new THREE.Vector2(0.26, 4.9), new THREE.Vector2(0.13, 5.35), new THREE.Vector2(0.0, 5.6)], 32);
  body.rotateX(-PI / 2);
  mesh(body, white, missile);
  for (const z of [-1.5, 1.8, 2.6]) mesh(cyl(0.445, 0.445, 0.22, 32), band, missile, 0, 0, -z, PI / 2);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Shape();
    fin.moveTo(0, 0); fin.lineTo(0.65, 0.25); fin.lineTo(0.65, 0.9); fin.lineTo(0, 1.35); fin.closePath();
    const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.03, bevelEnabled: false });
    fg.translate(0.42, 0, -0.015);
    fg.rotateX(PI / 2);
    const f = mesh(fg, white, missile, 0, 0, 4.15, 0, 0, k * PI / 2 + PI / 4);
    f.rotation.order = 'ZXY';
  }
  mesh(cyl(0.32, 0.26, 0.4, 20, true), M.dark, missile, 0, 0, 5.75, PI / 2);
  const decal = new THREE.MeshStandardMaterial({ map: decalTexture('STARK  INDUSTRIES'), transparent: true, roughness: 0.6, depthWrite: false });
  for (const s of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.4), decal);
    pl.position.set(s * 0.447, 0, -0.2);
    pl.rotation.y = s * PI / 2;
    pl.renderOrder = 3;
    missile.add(pl);
  }
  root.userData = {
    wheels, erector, missile, erectorSign: 1,
    size: new THREE.Vector3(3.05, 3.0, 12.5),
    halfExtents: new THREE.Vector3(1.5, 1.5, 6.0),
    parts: [],
    decalMaterial: decal,
  };
  return root;
}

// ------------------------------------------------------------------ ZU-23-2 emplaced
export function buildZU23(M) {
  const root = new THREE.Group();
  const paint = M.paint('#5e6447'), paintDk = M.paint('#444834');
  mesh(rbox(1.6, 0.22, 2.2, 0.05), paintDk, root, 0, 0.42, 0);
  for (const [x, z, a] of [[0, -1.6, 0], [-1.2, 0.9, 2.1], [1.2, 0.9, -2.1]]) {
    mesh(rbox(0.14, 0.12, 1.5, 0.03), paintDk, root, x * 0.5, 0.36, z * 0.5, 0, a, 0);
    mesh(cyl(0.05, 0.08, 0.45, 8), M.dark, root, x, 0.2, z);
    mesh(cyl(0.18, 0.2, 0.05, 12), M.dark, root, x, 0.02, z);
  }
  for (const s of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(s * 0.95, 0.55, 0.5); root.add(w);
    mesh(wheelGeo(0.33, 0.2, 0.5), M.rubber, w);
  }
  const turret = new THREE.Group(); turret.position.set(0, 0.55, 0); root.add(turret);
  mesh(cyl(0.6, 0.62, 0.12, 24), paint, turret, 0, 0.06, 0);
  for (const s of [-1, 1]) {
    mesh(rbox(0.36, 0.08, 0.4, 0.02), M.dark, turret, s * 0.62, 0.55, 0.45);
    mesh(rbox(0.32, 0.4, 0.06, 0.02), M.dark, turret, s * 0.62, 0.78, 0.66);
    mesh(rbox(0.12, 0.6, 0.12, 0.02), paintDk, turret, s * 0.62, 0.3, 0.45);
  }
  mesh(cyl(0.22, 0.28, 0.8, 16), paintDk, turret, 0, 0.5, 0.05);
  for (const s of [-1, 1]) mesh(rbox(0.08, 0.7, 0.5, 0.02), paint, turret, s * 0.3, 0.6, 0.05);
  const gun = new THREE.Group(); gun.position.set(0, 0.95, 0.05); turret.add(gun);
  mesh(rbox(0.7, 0.32, 0.9, 0.04), paint, gun, 0, 0, 0.1);
  const muzzles = [];
  for (const s of [-1, 1]) {
    mesh(cyl(0.035, 0.035, 2.1, 10), M.dark, gun, s * 0.17, 0.02, -1.2, PI / 2);
    mesh(cyl(0.05, 0.05, 0.2, 10), M.dark, gun, s * 0.17, 0.02, -2.25, PI / 2);
    for (let k = 0; k < 4; k++) mesh(rbox(0.012, 0.08, 0.18, 0.004), M.dark, gun, s * 0.17 + s * 0.04, 0.02, -2.28, 0, 0, k * PI / 4);
    mesh(rbox(0.22, 0.32, 0.4, 0.03), M.paint('#4c5236'), gun, s * 0.48, 0.05, 0.1);
    muzzles.push(new THREE.Vector3(s * 0.17, 0.02, -2.38));
  }
  mesh(rbox(0.16, 0.22, 0.26, 0.03), M.dark, gun, 0.0, 0.3, 0.2);
  mesh(cyl(0.06, 0.06, 0.04, 12), M.glass, gun, 0.0, 0.32, 0.06, PI / 2);
  root.userData = {
    turret, gun, muzzles,
    size: new THREE.Vector3(2.8, 1.9, 4.6),
    halfExtents: new THREE.Vector3(1.3, 0.95, 1.5),
    parts: [gun],
  };
  return root;
}

// ------------------------------------------------------------------ F-22 Raptor (faceted loft)
function loftSections(stations, flat = true) {
  const pos = [];
  for (let s = 0; s < stations.length - 1; s++) {
    const A = stations[s], B = stations[s + 1];
    const n = A.pts.length;
    for (let i = 0; i < n; i++) {
      const a0 = A.pts[i], a1 = A.pts[(i + 1) % n], b0 = B.pts[i], b1 = B.pts[(i + 1) % n];
      const v = (p, z) => [p[0], p[1], z];
      const q = [v(a0, A.z), v(a1, A.z), v(b1, B.z), v(b0, B.z)];
      pos.push(...q[0], ...q[2], ...q[1], ...q[0], ...q[3], ...q[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function slab(planform, thickRoot, thickTip, spanAxis = 'x') {
  // planform: [[a,b],...] polygon (a = span coordinate, b = chord coordinate), diamond airfoil thickness
  const pos = [];
  const n = planform.length;
  const maxA = Math.max(...planform.map(p => p[0])), minA = Math.min(...planform.map(p => p[0]));
  const ctr = planform.reduce((c, p) => [c[0] + p[0] / n, c[1] + p[1] / n], [0, 0]);
  const th = (a) => thickRoot + (thickTip - thickRoot) * (a - minA) / Math.max(1e-6, maxA - minA);
  const top = [ctr[0], th(ctr[0]) / 2, ctr[1]], bot = [ctr[0], -th(ctr[0]) / 2, ctr[1]];
  for (let i = 0; i < n; i++) {
    const p = planform[i], q = planform[(i + 1) % n];
    const P = [p[0], 0, p[1]], Q = [q[0], 0, q[1]];
    pos.push(...P, ...Q, ...top);
    pos.push(...Q, ...P, ...bot);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function fixFacing(g, center) {
  const p = g.attributes.position.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 9) {
    a.fromArray(p, i); b.fromArray(p, i + 3); c.fromArray(p, i + 6);
    n.subVectors(b, a).cross(m.subVectors(c, a));
    m.copy(a).add(b).add(c).divideScalar(3).sub(center(a.clone().add(b).add(c).divideScalar(3)));
    if (n.dot(m) < 0) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
  }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

export function buildF22(M) {
  const root = new THREE.Group();
  const grey = M.paint('#7d8187'), greyDk = M.paint('#6c7076'), greyLt = M.paint('#8b8f95');
  const S = [
    [-9.45, 0.02, 0.0, 0.02, -0.02], [-8.6, 0.28, -0.04, 0.24, -0.2], [-7.4, 0.55, -0.02, 0.45, -0.38], [-6.0, 0.82, 0.0, 0.6, -0.5],
    [-4.4, 1.12, 0.02, 0.72, -0.62], [-2.6, 1.6, 0.02, 0.8, -0.74], [-0.6, 2.05, 0.05, 0.8, -0.78], [2.0, 2.22, 0.08, 0.74, -0.74],
    [5.0, 2.1, 0.1, 0.66, -0.64], [7.6, 1.66, 0.08, 0.54, -0.52], [9.1, 1.32, 0.02, 0.4, -0.36],
  ];
  const stations = S.map(([z, w, yc, yt, yb]) => ({ z, pts: [[0, yt], [-w * 0.52, yt * 0.9], [-w, yc], [-w * 0.62, yb * 0.92], [0, yb], [w * 0.62, yb * 0.92], [w, yc], [w * 0.52, yt * 0.9]] }));
  const fus = loftSections(stations);
  fixFacing(fus, (c) => new THREE.Vector3(0, 0.05, c.z));
  mesh(fus, grey, root);
  // canopy
  const can = new THREE.SphereGeometry(1, 24, 12);
  can.scale(0.55, 0.48, 2.05);
  const canopy = mesh(can, M.paint('#5e5232'), root, 0, 0.5, -5.4);
  canopy.material = canopy.material.clone();
  canopy.material.metalness = 0.9; canopy.material.roughness = 0.08; canopy.material.color.set('#6a5c30');
  // intakes (caret)
  for (const s of [-1, 1]) {
    const inlet = new THREE.Shape();
    inlet.moveTo(0, 0.45); inlet.lineTo(0.62, 0.0); inlet.lineTo(0, -0.42); inlet.closePath();
    const ig = new THREE.ExtrudeGeometry(inlet, { depth: 2.6, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
    ig.translate(0, 0, -2.6);
    const im = mesh(ig, greyDk, root, s * 1.08, -0.18, -0.6, 0, 0, 0);
    if (s < 0) im.scale.x = -1;
    mesh(new THREE.PlaneGeometry(0.5, 0.6), M.dark, root, s * 1.38, -0.18, -3.21);
  }
  // wings
  for (const s of [-1, 1]) {
    const plan = [[1.6, -1.6], [6.78, 3.75], [6.78, 4.85], [2.0, 7.1]].map(([x, z]) => [x * s, z]);
    const wg = slab(plan.map(([x, z]) => [x, z]), 0.34, 0.07);
    fixFacing(wg, (c) => new THREE.Vector3(c.x, 0, c.z));
    mesh(wg, greyLt, root, 0, 0.0, 0);
  }
  // horizontal stabilizers (all-moving)
  const stabs = {};
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * 1.4, 0.0, 8.0); root.add(pivot);
    const plan = [[0.0, -1.2], [3.0, 0.4], [3.0, 1.2], [0.1, 1.9]].map(([x, z]) => [x * s, z]);
    const sg = slab(plan, 0.16, 0.05);
    fixFacing(sg, (c) => new THREE.Vector3(c.x, 0, c.z));
    mesh(sg, greyLt, pivot);
    stabs[s < 0 ? 'leftStab' : 'rightStab'] = pivot;
  }
  // canted vertical tails
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * 1.5, 0.55, 5.0); pivot.rotation.z = -s * 0.49; root.add(pivot);
    const plan = [[0.0, 0.0], [2.95, 2.75], [2.95, 3.85], [0.0, 4.2]];
    const vg = slab(plan, 0.16, 0.05);
    vg.rotateZ(PI / 2);
    fixFacing(vg, (c) => new THREE.Vector3(0, c.y, c.z));
    mesh(vg, greyLt, pivot);
    stabs[s < 0 ? 'leftTail' : 'rightTail'] = pivot;
  }
  // 2D nozzles
  const nozzles = [];
  for (const s of [-1, 1]) {
    mesh(rbox(0.95, 0.6, 0.9, 0.05), greyDk, root, s * 0.6, 0.0, 9.3);
    mesh(rbox(0.75, 0.42, 0.05, 0.01), M.dark, root, s * 0.6, 0.0, 9.76);
    nozzles.push(new THREE.Vector3(s * 0.6, 0.0, 9.9));
  }
  // weapon bay seams and panel lines (flat thin strips)
  for (const s of [-1, 1]) mesh(rbox(0.02, 0.01, 4.2, 0.004), greyDk, root, s * 0.6, -0.76, 1.8);
  root.userData = {
    nozzles,
    controlSurfaces: stabs,
    size: new THREE.Vector3(13.56, 5.08, 18.9),
    halfExtents: new THREE.Vector3(6.78, 1.5, 9.45),
    parts: [],
  };
  return root;
}
