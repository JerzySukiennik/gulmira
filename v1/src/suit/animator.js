// Procedural animation for the Mk III rig: gait, hover, flight, aiming IK, landing, knockdown, weapon hardware.
import * as THREE from 'three';

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _x = new THREE.Vector3(), _z = new THREE.Vector3();
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const lerp = (a, b, t) => a + (b - a) * t;

const BODY = ['pelvis', 'spine', 'chest', 'neck', 'head', 'shoulder_R', 'elbow_R', 'wrist_R', 'shoulder_L', 'elbow_L', 'wrist_L', 'hip_R', 'knee_R', 'ankle_R', 'hip_L', 'knee_L', 'ankle_L'];

export class SuitAnimator {
  constructor(root) {
    this.root = root;
    this.B = root.userData.bones;
    this.target = {};
    this.stiff = {};
    for (const n of BODY) { this.target[n] = new THREE.Quaternion(); this.stiff[n] = 14; }
    this.pelvisRest = this.B.pelvis.position.clone();
    this.pelvisOffset = new THREE.Vector3();
    this.pelvisTarget = new THREE.Vector3();
    this.phase = 0;
    this.lastStepSign = [0, 0];
    this.onStep = null;
    this.fingerCurl = { R: 0.3, L: 0.3 };
    this.fingerTarget = { R: 0.3, L: 0.3 };
    this.recoil = { R: 0, L: 0 };
    this.aimBlend = { R: 0, L: 0 };
    this.aimDir = { R: new THREE.Vector3(0, 0, -1), L: new THREE.Vector3(0, 0, -1) };
    this.pods = 0; this.podsTarget = 0;
    this.hatch = { R: 0, L: 0 }; this.hatchTarget = { R: 0, L: 0 };
    this.time = 0;
    this.knock = new THREE.Vector3();
    this.setupHardware();
    this.setupFlaps();
  }

  setupHardware() {
    const findMesh = (bone, name) => bone.children.find(c => c.name === name);
    this.podHinge = {};
    this.hatchHinge = {};
    for (const s of ['R', 'L']) {
      const sh = this.B['shoulder_' + s];
      const cap = findMesh(sh, 'pauldron1' + s);
      if (cap) {
        cap.geometry.computeBoundingBox();
        const bb = cap.geometry.boundingBox;
        const hinge = new THREE.Group();
        hinge.position.set((bb.min.x + bb.max.x) / 2, bb.max.y - 0.02, bb.max.z - 0.01);
        sh.add(hinge);
        cap.position.sub(hinge.position);
        hinge.add(cap);
        this.podHinge[s] = hinge;
        const rack = new THREE.Group();
        const mats = this.root.userData.mats;
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.035, 0.1), mats.dark);
        rack.add(box);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
          const t = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 12), mats.under);
          t.position.set(-0.022 + i * 0.022, 0.018, -0.025 + j * 0.05);
          rack.add(t);
          const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), mats.chrome);
          tip.position.set(-0.022 + i * 0.022, 0.024, -0.025 + j * 0.05);
          rack.add(tip);
        }
        rack.position.set((bb.min.x + bb.max.x) / 2, bb.max.y - 0.07, 0);
        rack.visible = false;
        sh.add(rack);
        this.podHinge[s].rack = rack;
        this.podHinge[s].rackY = rack.position.y;
      }
      const el = this.B['elbow_' + s];
      const hatch = findMesh(el, 'hatch' + s);
      if (hatch) {
        hatch.geometry.computeBoundingBox();
        const bb = hatch.geometry.boundingBox;
        const hinge = new THREE.Group();
        hinge.position.set(s === 'R' ? bb.max.x - 0.01 : bb.min.x + 0.01, bb.min.y + 0.01, (bb.min.z + bb.max.z) / 2);
        el.add(hinge);
        hatch.position.sub(hinge.position);
        hinge.add(hatch);
        this.hatchHinge[s] = hinge;
        const mats = this.root.userData.mats;
        const launcher = new THREE.Group();
        const tubeM = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.11, 16), mats.dark);
        launcher.add(tubeM);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.03, 16), mats.chrome);
        tip.position.y = -0.07;
        tip.rotation.x = Math.PI;
        launcher.add(tip);
        launcher.position.set(s === 'R' ? 0.035 : -0.035, -0.13, 0);
        launcher.visible = false;
        el.add(launcher);
        hinge.launcher = launcher;
      }
    }
  }

  setupFlaps() {
    this.flaps = [];
    const wrap = (bone, name, edge) => {
      const mesh = bone.children.find(c => c.name === name);
      if (!mesh) return;
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      const hinge = new THREE.Group();
      hinge.position.set((bb.min.x + bb.max.x) / 2, edge === 'top' ? bb.max.y : bb.max.y, edge === 'top' ? (bb.min.z + bb.max.z) / 2 : bb.min.z);
      bone.add(hinge);
      mesh.position.sub(hinge.position);
      hinge.add(mesh);
      this.flaps.push({ hinge, name });
    };
    wrap(this.B.chest, 'backFlapL', 'top');
    wrap(this.B.chest, 'backFlapR', 'top');
    for (const s of ['R', 'L']) wrap(this.B['knee_' + s], 'calfFlap' + s, 'top');
    this.flapOpen = 0;
  }

  // world-space aim -> shoulder quaternion that points the arm along dir with fingers up
  aimQuat(side, dir, out) {
    const sh = this.B['shoulder_' + side];
    const parent = sh.parent;
    parent.getWorldQuaternion(_q).invert();
    _v.copy(dir).applyQuaternion(_q).normalize();
    _w.set(0, 1, 0).applyQuaternion(_q);
    const yAxis = _u.copy(_v).negate();
    const xAxis = _x.copy(_w).addScaledVector(_v, -_w.dot(_v));
    if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
    xAxis.normalize();
    if (side === 'L') xAxis.negate();
    const zAxis = _z.crossVectors(xAxis, yAxis).normalize();
    xAxis.crossVectors(yAxis, zAxis).normalize();
    _m.makeBasis(xAxis, yAxis, zAxis);
    return out.setFromRotationMatrix(_m);
  }

  set(name, x, y, z) { this.target[name].setFromEuler(_e.set(x, y, z, 'XYZ')); }

  update(dt, s) {
    this.time += dt;
    const t = this.time;
    const sideSign = { R: 1, L: -1 };
    for (const n of BODY) this.target[n].identity();
    this.pelvisTarget.set(0, 0, 0);
    let stiff = 12;
    const mode = s.mode;
    if (mode === 'ground') {
      const sp = s.groundSpeed;
      const walk = Math.min(1, sp / 2.0);
      const run = Math.max(0, Math.min(1, (sp - 2.5) / 3.5));
      const stride = lerp(0.62, 1.25, run);
      this.phase += dt * sp / stride * Math.PI;
      const fwd = s.moveLocal ? s.moveLocal.z : 0;
      const lat = s.moveLocal ? s.moveLocal.x : 0;
      const dirF = sp > 0.05 ? fwd / Math.max(0.001, Math.hypot(fwd, lat)) : 1;
      const dirL = sp > 0.05 ? lat / Math.max(0.001, Math.hypot(fwd, lat)) : 0;
      const ampH = lerp(0.42, 0.72, run) * walk;
      for (const [side, ph] of [['R', this.phase], ['L', this.phase + Math.PI]]) {
        const sw = Math.sin(ph), cw = Math.cos(ph);
        const lift = Math.max(0, cw);
        this.set('hip_' + side, ampH * sw * dirF - 0.04 * walk, 0, (side === 'R' ? 0.035 : -0.035) + 0.22 * sw * dirL * walk);
        this.set('knee_' + side, -(0.08 + (0.75 + run * 0.6) * lift * walk + 0.12 * walk), 0, 0);
        this.set('ankle_' + side, (-0.25 * sw * dirF + 0.18 * lift) * walk, 0, 0);
        const armSw = -sw * lerp(0.22, 0.5, run) * walk * dirF;
        this.set('shoulder_' + side, armSw + 0.05, 0, sideSign[side] * (0.12 + 0.04 * walk));
        this.set('elbow_' + side, 0.3 + 0.35 * run + Math.max(0, -armSw) * 0.4, 0, 0);
        this.set('wrist_' + side, 0, 0, 0);
        const contact = Math.sign(sw);
        const idx = side === 'R' ? 0 : 1;
        if (walk > 0.15 && contact !== this.lastStepSign[idx] && contact > 0) { if (this.onStep) this.onStep(side, walk, run); }
        this.lastStepSign[idx] = contact;
      }
      const bob = Math.abs(Math.cos(this.phase));
      this.pelvisTarget.set(0, -0.035 * walk - 0.05 * run + 0.03 * bob * walk, 0);
      this.set('pelvis', -0.06 * run, 0, 0.03 * Math.sin(this.phase) * walk);
      this.set('spine', -0.05 * walk - 0.12 * run, 0.06 * Math.sin(this.phase) * walk, 0);
      this.set('chest', 0.02, -0.08 * Math.sin(this.phase) * walk, 0);
      this.set('neck', 0.04 * walk, 0, 0);
      this.set('head', s.lookPitch * 0.4, 0, 0);
      if (sp < 0.05) {
        const br = Math.sin(t * 1.4) * 0.012;
        this.set('chest', br, 0, 0);
        this.set('shoulder_R', 0.04, 0, 0.13); this.set('shoulder_L', 0.04, 0, -0.13);
        this.set('elbow_R', 0.22, 0, 0); this.set('elbow_L', 0.22, 0, 0);
        this.set('hip_R', -0.02, 0, 0.05); this.set('hip_L', 0.02, 0, -0.05);
        this.set('knee_R', -0.08, 0, 0); this.set('knee_L', -0.06, 0, 0);
      }
      this.fingerTarget.R = this.fingerTarget.L = 0.85;
      stiff = 16;
    } else if (mode === 'hover' || mode === 'takeoff') {
      const lv = s.velLocal || _v.set(0, 0, 0);
      const fw = THREE.MathUtils.clamp(-lv.z / 18, -1, 1);
      const sd = THREE.MathUtils.clamp(lv.x / 18, -1, 1);
      const up = THREE.MathUtils.clamp(lv.y / 10, -1, 1);
      const sway = Math.sin(t * 1.7) * 0.03;
      for (const side of ['R', 'L']) {
        const k = sideSign[side];
        const ph = t * 1.3 + (side === 'R' ? 0 : 1.7);
        this.set('hip_' + side, 0.12 - 0.35 * fw + 0.04 * Math.sin(ph) + 0.1 * up, 0, k * (0.06 + 0.1 * Math.abs(sd)) - 0.12 * sd);
        this.set('knee_' + side, -0.32 - 0.2 * Math.max(0, fw) - 0.05 * Math.sin(ph + 1) + 0.15 * up, 0, 0);
        this.set('ankle_' + side, -0.42 - 0.2 * Math.max(0, fw), 0, 0);
        this.set('shoulder_' + side, 0.12 - 0.35 * fw + sway, 0, k * (0.32 + 0.08 * Math.max(0, -up)) - 0.1 * sd);
        this.set('elbow_' + side, 0.32 + 0.1 * Math.sin(ph), 0, 0);
        this.set('wrist_' + side, 0, 0, k * 1.25);
      }
      this.set('spine', -0.04 - 0.1 * fw, 0, 0);
      this.set('chest', 0.03, 0, 0);
      this.set('head', s.lookPitch * 0.5, 0, 0);
      this.fingerTarget.R = this.fingerTarget.L = 0.1;
      stiff = 9;
    } else if (mode === 'flight') {
      const bank = s.bank || 0;
      const turbulence = Math.sin(t * 9.1) * 0.01 * s.speedK;
      for (const side of ['R', 'L']) {
        const k = sideSign[side];
        const firing = this.aimBlend[side] > 0.01;
        this.set('hip_' + side, -0.05 + turbulence, 0, k * 0.02 + bank * 0.04);
        this.set('knee_' + side, -0.06 - 0.06 * (1 - s.speedK), 0, 0);
        this.set('ankle_' + side, -0.62, 0, 0);
        if (!firing) {
          this.set('shoulder_' + side, -0.12 - 0.08 * s.speedK, 0, k * (0.1 + 0.12 * (1 - s.speedK)));
          this.set('elbow_' + side, 0.1, 0, 0);
          this.set('wrist_' + side, 0, 0, k * 1.32);
        }
      }
      this.set('spine', 0.03, 0, -bank * 0.12);
      this.set('neck', 0.55, 0, 0);
      this.set('head', 0.55 + s.lookPitch * 0.3, 0, 0);
      this.fingerTarget.R = this.fingerTarget.L = 0.05;
      stiff = 8;
    } else if (mode === 'landing') {
      const k = s.landT;
      const rise = THREE.MathUtils.smoothstep(k, 0.55, 1.0);
      const lowP = 1 - rise;
      this.pelvisTarget.set(0, -0.55 * lowP, -0.05 * lowP);
      this.set('pelvis', -0.25 * lowP, 0, 0);
      this.set('hip_L', 1.5 * lowP, 0, -0.1 * lowP);
      this.set('knee_L', -2.05 * lowP, 0, 0);
      this.set('ankle_L', 0.55 * lowP, 0, 0);
      this.set('hip_R', -0.05 * lowP, 0, 0.12 * lowP);
      this.set('knee_R', -2.0 * lowP, 0, 0);
      this.set('ankle_R', -0.5 * lowP, 0, 0);
      this.set('spine', -0.42 * lowP, 0, 0);
      this.set('chest', -0.2 * lowP, 0, 0);
      this.set('shoulder_R', 0.5 * lowP, 0, 0.12);
      this.set('elbow_R', 0.05 * lowP, 0, 0);
      this.set('shoulder_L', -0.55 * lowP, 0, -0.75 * lowP - 0.12 * rise);
      this.set('elbow_L', 0.35 * lowP, 0, 0);
      this.set('wrist_L', 0, 0, -0.9 * lowP);
      this.set('head', -0.45 * lowP * (1 - THREE.MathUtils.smoothstep(k, 0.25, 0.5)) + 0.25 * THREE.MathUtils.smoothstep(k, 0.25, 0.5) * lowP, 0, 0);
      this.fingerTarget.R = 1.4; this.fingerTarget.L = 0.4;
      stiff = k < 0.05 ? 60 : 7;
    } else if (mode === 'knockdown' || mode === 'dead') {
      const n = (a) => Math.sin(t * 7.3 + a) * 0.6 + Math.sin(t * 3.1 + a * 2.1) * 0.4;
      for (const side of ['R', 'L']) {
        const k = sideSign[side];
        this.set('shoulder_' + side, n(1 + k) * 0.9, 0, k * (0.8 + n(2 + k) * 0.5));
        this.set('elbow_' + side, 0.6 + n(3 + k) * 0.5, 0, 0);
        this.set('hip_' + side, 0.4 + n(4 + k) * 0.5, 0, k * 0.25);
        this.set('knee_' + side, -0.8 + n(5 + k) * 0.5, 0, 0);
      }
      this.set('spine', n(6) * 0.2, 0, 0);
      stiff = mode === 'dead' ? 4 : 10;
      this.fingerTarget.R = this.fingerTarget.L = 0.5;
    }

    // aiming overrides (any airborne/ground mode except landing/knockdown)
    for (const side of ['R', 'L']) {
      const want = s['aim' + side] && !['landing', 'knockdown', 'dead'].includes(mode) ? 1 : 0;
      this.aimBlend[side] += (want - this.aimBlend[side]) * damp(want ? 18 : 6, dt);
      if (this.aimBlend[side] > 0.001 && s.aimDir) {
        this.aimDir[side].copy(s.aimDir);
        const aq = this.aimQuat(side, this.aimDir[side], _q);
        this.target['shoulder_' + side].slerp(aq, this.aimBlend[side]);
        const rc = this.recoil[side];
        this.target['elbow_' + side].slerp(_q.setFromEuler(_e.set(0.12 + rc * 0.5, 0, 0)), this.aimBlend[side]);
        this.target['wrist_' + side].slerp(_q.setFromEuler(_e.set(0, 0, sideSign[side] * (1.42 - rc * 0.3))), this.aimBlend[side]);
        this.fingerTarget[side] = lerp(this.fingerTarget[side], -0.12, this.aimBlend[side]);
        if (mode === 'ground') this.target.chest.slerp(_q.setFromEuler(_e.set(0, sideSign[side] * 0.1, 0)), 0.5 * this.aimBlend[side]);
      }
      this.recoil[side] *= Math.exp(-dt * 9);
    }
    if (s.fistR) this.fingerTarget.R = 1.4;

    // apply with per-frame smoothing
    const B = this.B;
    for (const n of BODY) {
      const k = (n.startsWith('shoulder') || n.startsWith('elbow') || n.startsWith('wrist')) && this.aimBlend[n.slice(-1)] > 0.5 ? 26 : stiff;
      B[n].quaternion.slerp(this.target[n], damp(k, dt));
    }
    this.pelvisOffset.lerp(this.pelvisTarget, damp(stiff, dt));
    B.pelvis.position.copy(this.pelvisRest).add(this.pelvisOffset);

    // fingers
    for (const side of ['R', 'L']) {
      this.fingerCurl[side] += (this.fingerTarget[side] - this.fingerCurl[side]) * damp(14, dt);
      const c = this.fingerCurl[side];
      const k = side === 'R' ? -1 : 1;
      const F = B['fingers_' + side];
      for (const [name, chain] of Object.entries(F)) {
        if (name === 'thumb') {
          chain[1].rotation.x = -0.3 * Math.max(0, c);
          chain[2].rotation.x = -0.5 * Math.max(0, c);
          continue;
        }
        const spread = { index: -0.08, middle: 0, ring: 0.06, pinky: 0.12 }[name] * (1 - Math.max(0, c));
        chain[0].rotation.set(spread, 0, k * c * 0.9);
        chain[1].rotation.set(0, 0, k * c * 1.15);
        chain[2].rotation.set(0, 0, k * c * 0.8);
      }
    }

    // flight flaps
    const fo = mode === 'flight' ? 0.55 + s.speedK * 0.45 : mode === 'hover' ? 0.15 : 0;
    this.flapOpen += (fo - this.flapOpen) * damp(5, dt);
    for (const f of this.flaps) {
      const k = this.flapOpen + Math.sin(t * 23 + f.name.length) * 0.015 * this.flapOpen;
      f.hinge.rotation.x = f.name.startsWith('back') ? -k * 0.42 : -k * 0.55;
    }
    // weapon hardware
    this.pods += (this.podsTarget - this.pods) * damp(10, dt);
    this.hatch.R += (this.hatchTarget.R - this.hatch.R) * damp(12, dt);
    this.hatch.L += (this.hatchTarget.L - this.hatch.L) * damp(12, dt);
    for (const s2 of ['R', 'L']) {
      const h = this.podHinge[s2];
      if (h) {
        h.rotation.x = -this.pods * 1.25;
        h.rack.visible = this.pods > 0.02;
        h.rack.position.y = h.rackY + this.pods * 0.07;
      }
      const hh = this.hatchHinge[s2];
      if (hh) {
        hh.rotation.y = 0;
        hh.rotation.z = (s2 === 'R' ? 1 : -1) * this.hatch[s2] * 0.9;
        hh.launcher.visible = this.hatch[s2] > 0.05;
        hh.launcher.position.x = (s2 === 'R' ? 1 : -1) * (0.035 + this.hatch[s2] * 0.03);
      }
    }
  }

  fire(side) { this.recoil[side] = 1; }

  // world positions of thruster/weapon mounts
  palm(side, out) {
    const w = this.B['wrist_' + side];
    return out.set(side === 'R' ? -0.03 : 0.03, -0.058, 0).applyMatrix4(w.matrixWorld);
  }
  palmDir(side, out) {
    const w = this.B['wrist_' + side];
    w.getWorldQuaternion(_q);
    return out.set(side === 'R' ? -1 : 1, 0, 0).applyQuaternion(_q).normalize();
  }
  sole(side, out, heel = false) {
    const a = this.B['ankle_' + side];
    return out.set(0, -0.075, heel ? 0.04 : -0.11).applyMatrix4(a.matrixWorld);
  }
  soleDir(side, out) {
    const a = this.B['ankle_' + side];
    a.getWorldQuaternion(_q);
    return out.set(0, -1, 0).applyQuaternion(_q).normalize();
  }
  podPos(side, out) {
    const h = this.podHinge[side];
    return out.set(0, 0.03, 0).applyMatrix4(h.rack.matrixWorld);
  }
  launcherPos(side, out) {
    const hh = this.hatchHinge[side];
    return out.set(0, -0.08, 0).applyMatrix4(hh.launcher.matrixWorld);
  }
}
