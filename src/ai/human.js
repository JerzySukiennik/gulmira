// A single human: skinned mesh + procedural animation (gait, aiming with two-bone IK, kneel, cower, flee) + verlet ragdoll.
import * as THREE from 'three';
import { makeBones, BONE_DEF } from './humanModel.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _eu = new THREE.Euler();
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const UP = new THREE.Vector3(0, 1, 0);

const RAG_POINTS = ['hips', 'chest', 'head', 'upperarm_R', 'forearm_R', 'hand_R', 'upperarm_L', 'forearm_L', 'hand_L', 'thigh_R', 'shin_R', 'foot_R', 'thigh_L', 'shin_L', 'foot_L'];
const RAG_LINKS = [
  ['hips', 'chest'], ['chest', 'head'], ['chest', 'upperarm_R'], ['chest', 'upperarm_L'], ['upperarm_R', 'forearm_R'], ['forearm_R', 'hand_R'],
  ['upperarm_L', 'forearm_L'], ['forearm_L', 'hand_L'], ['hips', 'thigh_R'], ['hips', 'thigh_L'], ['thigh_R', 'shin_R'], ['shin_R', 'foot_R'],
  ['thigh_L', 'shin_L'], ['shin_L', 'foot_L'], ['thigh_R', 'thigh_L'], ['upperarm_R', 'upperarm_L'], ['upperarm_R', 'hips'], ['upperarm_L', 'hips'],
  ['thigh_R', 'chest'], ['thigh_L', 'chest'], ['head', 'upperarm_R'], ['head', 'upperarm_L'],
];
const RAG_MIN = [['hand_R', 'upperarm_R', 0.12], ['hand_L', 'upperarm_L', 0.12], ['foot_R', 'thigh_R', 0.2], ['foot_L', 'thigh_L', 0.2], ['head', 'hips', 0.45]];

export class Human {
  constructor({ geometry, material, weapon = null, kind = 'civilian', scale = 1 }) {
    this.root = new THREE.Group();
    this.mesh = new THREE.SkinnedMesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    const { bones, list, root } = makeBones();
    this.mesh.add(root);
    this.mesh.bind(new THREE.Skeleton(list));
    this.root.add(this.mesh);
    this.root.scale.setScalar(scale);
    this.B = bones;
    this.boneList = list;
    this.kind = kind;
    this.weapon = weapon;
    if (weapon) this.root.add(weapon);
    this.hipsRest = bones.hips.position.clone();
    this.targets = Object.fromEntries(list.map(b => [b.name, new THREE.Quaternion()]));
    this.hipsOffset = new THREE.Vector3();
    this.hipsTarget = new THREE.Vector3();
    this.phase = Math.random() * 6;
    this.time = Math.random() * 10;
    this.recoil = 0;
    this.mode = 'idle';
    this.dead = false;
    this.rag = null;
    this.bindDir = {};
    for (const [name, parent] of BONE_DEF) {
      const child = list.find(b => b.parent === bones[name]);
      if (child) this.bindDir[name] = child.position.clone().normalize();
    }
    this.bindDir.hand_R = this.bindDir.forearm_R.clone();
    this.bindDir.hand_L = this.bindDir.forearm_L.clone();
    this.bindDir.foot_R = new THREE.Vector3(0, 0, -1);
    this.bindDir.foot_L = new THREE.Vector3(0, 0, -1);
    this.lastStep = 0;
  }

  set(n, x, y, z) { this.targets[n].setFromEuler(_eu.set(x, y, z, 'XYZ')); }

  // s: { mode, speed, aimDir (world), aimWeight, lookAt, crouch }
  update(dt, s) {
    if (this.rag) return;
    this.time += dt;
    const t = this.time;
    for (const k in this.targets) this.targets[k].identity();
    this.hipsTarget.set(0, 0, 0);
    const mode = s.mode;
    const sp = s.speed || 0;
    let stiff = 12;
    if (mode === 'walk' || mode === 'run' || mode === 'flee' || mode === 'idle' || mode === 'aim' || mode === 'rpg') {
      const walk = Math.min(1, sp / 1.4), run = Math.max(0, Math.min(1, (sp - 2) / 3));
      const stride = 0.75 + run * 0.7;
      this.phase += dt * sp / stride * Math.PI;
      for (const [side, ph] of [['R', this.phase], ['L', this.phase + Math.PI]]) {
        const sw = Math.sin(ph), lift = Math.max(0, Math.cos(ph));
        const crouch = s.crouch ? 0.5 : 0;
        this.set('thigh_' + side, (0.45 + run * 0.35) * sw * walk + crouch * 0.9, 0, side === 'R' ? 0.03 : -0.03);
        this.set('shin_' + side, -(0.1 + (0.8 + run * 0.7) * lift * walk) - crouch * 1.6, 0, 0);
        this.set('foot_' + side, (-0.2 * sw * walk + 0.25 * lift * walk) + crouch * 0.6, 0, 0);
        if (mode !== 'aim' && mode !== 'rpg' && !this.weapon) {
          const armSw = -sw * (0.25 + run * 0.6) * walk;
          const flail = mode === 'flee' ? 0.5 : 0;
          this.set('upperarm_' + side, armSw - flail * 0.3, 0, (side === 'R' ? -1 : 1) * (0.1 + flail * 0.1));
          this.set('forearm_' + side, 0.25 + run * 0.9 + flail, 0, 0);
        }
      }
      const bob = Math.abs(Math.cos(this.phase));
      this.hipsTarget.set(0, -0.02 * walk - 0.06 * run + 0.03 * bob * walk - (s.crouch ? 0.38 : 0), 0);
      this.set('spine', -0.05 * walk - 0.18 * run - (s.crouch ? 0.25 : 0), 0.08 * Math.sin(this.phase) * walk, 0);
      if (sp < 0.05 && !s.crouch) {
        const br = Math.sin(t * 1.3) * 0.015;
        this.set('chest', br, 0, 0);
        this.set('thigh_R', 0, 0, 0.05); this.set('thigh_L', 0, 0, -0.04);
        if (!this.weapon) { this.set('upperarm_R', 0.05, 0, -0.08); this.set('upperarm_L', 0.05, 0, 0.08); this.set('forearm_R', 0.3, 0, 0); this.set('forearm_L', 0.3, 0, 0); }
      }
    } else if (mode === 'kneel' || mode === 'cower' || mode === 'handsup') {
      const kneel = mode === 'kneel';
      const cower = mode === 'cower';
      if (kneel) {
        this.hipsTarget.set(0, -0.46, 0.05);
        this.set('thigh_R', 0.05, 0, 0.08); this.set('thigh_L', 0.05, 0, -0.08);
        this.set('shin_R', -1.62, 0, 0); this.set('shin_L', -1.62, 0, 0);
        this.set('foot_R', 0.6, 0, 0); this.set('foot_L', 0.6, 0, 0);
        this.set('spine', -0.15 + Math.sin(t * 0.7) * 0.02, 0, 0);
        this.set('head', -0.25, 0, 0);
      } else if (cower) {
        this.hipsTarget.set(0, -0.62, 0.1);
        this.set('thigh_R', 1.9, 0, 0.25); this.set('thigh_L', 1.9, 0, -0.25);
        this.set('shin_R', -2.3, 0, 0); this.set('shin_L', -2.3, 0, 0);
        this.set('foot_R', 0.4, 0, 0); this.set('foot_L', 0.4, 0, 0);
        this.set('spine', -0.75 + Math.sin(t * 9) * 0.02, 0, 0);
        this.set('chest', -0.3, 0, 0);
        this.set('head', -0.5, 0, 0);
      } else {
        this.set('spine', 0.05, 0, 0);
      }
      stiff = 6;
    }
    this.mode = mode;
    const B = this.B;
    if (this.weapon && !this.dead && (s.aimWeight ?? 0) > 0.01 && s.aimDir) {
      const rootQ = this.root.getWorldQuaternion(_q3);
      const local = _b.copy(s.aimDir).normalize().applyQuaternion(_q2.copy(rootQ).invert());
      const aw = s.aimWeight;
      const yaw = THREE.MathUtils.clamp(Math.atan2(-local.x, -local.z), -1.1, 1.1) * aw;
      const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(local.y, -1, 1)), -0.9, 0.9) * aw;
      this.targets.spine.multiply(_q2.setFromEuler(_eu.set(pitch * 0.4, yaw * 0.45, 0, 'YXZ')));
      this.targets.chest.multiply(_q2.setFromEuler(_eu.set(pitch * 0.45, yaw * 0.45, 0, 'YXZ')));
      this.targets.head.multiply(_q2.setFromEuler(_eu.set(pitch * 0.2, yaw * 0.1, 0, 'YXZ')));
    }
    // smoothing
    for (const b of this.boneList) b.quaternion.slerp(this.targets[b.name], damp(stiff, dt));
    this.hipsOffset.lerp(this.hipsTarget, damp(stiff, dt));
    B.hips.position.copy(this.hipsRest).add(this.hipsOffset);
    this.root.updateMatrixWorld(true);

    // upper body: weapons and hand poses via IK
    if (this.weapon && !this.dead) this.poseWeapon(dt, s);
    if (mode === 'kneel' || mode === 'cower' || mode === 'handsup') this.poseHandsHead(mode);
    // footsteps
    if (sp > 0.6) {
      const st = Math.sign(Math.sin(this.phase));
      if (st !== this.lastStep) { this.lastStep = st; if (this.onStep) this.onStep(sp); }
    }
  }

  poseWeapon(dt, s) {
    const W = this.weapon;
    const B = this.B;
    const aim = s.aimWeight ?? 0;
    this.recoil *= Math.exp(-dt * 14);
    B.chest.updateWorldMatrix(true, false);
    const chestQ = B.chest.getWorldQuaternion(_q);
    const rootQ = this.root.getWorldQuaternion(_q3);
    // body-relative aim direction
    let dir = _a;
    if (s.aimDir && aim > 0.01) dir.copy(s.aimDir).normalize();
    else dir.set(0, 0, -1).applyQuaternion(rootQ);
    this.root.updateMatrixWorld(true);
    // weapon pose: aimed at shoulder vs low ready
    B.upperarm_R.getWorldPosition(_c);
    const rootInv = _q2.copy(rootQ).invert();
    let wpos = _d, wdir = _e;
    const isRPG = this.kind === 'rpg';
    if (aim > 0.5) {
      wdir.copy(dir);
      const right = _b.crossVectors(wdir, UP).normalize();
      wpos.copy(_c).addScaledVector(wdir, isRPG ? -0.1 : 0.12).addScaledVector(right, isRPG ? -0.02 : -0.06);
      wpos.y += isRPG ? 0.08 : -0.06;
      wpos.addScaledVector(wdir, -this.recoil * 0.04);
    } else {
      const fwd = _b.set(0, 0, -1).applyQuaternion(rootQ);
      wdir.copy(fwd).applyAxisAngle(UP, isRPG ? 0 : 0.6);
      wdir.y = isRPG ? -0.1 : -0.75; wdir.normalize();
      B.chest.getWorldPosition(wpos);
      wpos.addScaledVector(fwd, 0.22);
      wpos.y -= isRPG ? -0.18 : 0.12;
      if (isRPG) wpos.addScaledVector(_b.crossVectors(fwd, UP).normalize(), 0.08);
    }
    // place weapon in root-local space
    const lp = this.root.worldToLocal(wpos.clone());
    W.position.copy(lp);
    const lookM = _m.lookAt(new THREE.Vector3(), wdir.clone().applyQuaternion(rootInv), UP);
    W.quaternion.setFromRotationMatrix(lookM);
    if (this.recoil > 0.01) W.rotateX(this.recoil * 0.08);
    W.updateMatrixWorld(true);
    // hands to grips
    const grip = W.localToWorld(W.userData.grip.clone());
    const fore = W.localToWorld(W.userData.fore.clone());
    const rootRight = _b.set(1, 0, 0).applyQuaternion(rootQ);
    this.ik('R', grip, rootRight.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, -1, 0)));
    this.ik('L', fore, rootRight.clone().multiplyScalar(-0.7).add(new THREE.Vector3(0, -1, 0)));
    void chestQ;
  }

  poseHandsHead(mode) {
    const B = this.B;
    B.head.updateWorldMatrix(true, false);
    const hp = B.head.getWorldPosition(new THREE.Vector3());
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rootQ);
    if (mode === 'handsup') {
      this.ik('R', hp.clone().addScaledVector(right, 0.28).add(new THREE.Vector3(0, 0.38, 0)), right.clone().add(new THREE.Vector3(0, -0.5, 0)));
      this.ik('L', hp.clone().addScaledVector(right, -0.28).add(new THREE.Vector3(0, 0.38, 0)), right.clone().negate().add(new THREE.Vector3(0, -0.5, 0)));
    } else {
      const top = hp.clone().add(new THREE.Vector3(0, mode === 'cower' ? 0.16 : 0.2, 0)).addScaledVector(fwd, mode === 'cower' ? 0.05 : -0.02);
      this.ik('R', top.clone().addScaledVector(right, 0.05), right.clone().add(fwd.clone().multiplyScalar(0.3)));
      this.ik('L', top.clone().addScaledVector(right, -0.05), right.clone().negate().add(fwd.clone().multiplyScalar(0.3)));
    }
  }

  ik(side, target, pole) {
    const U = this.B['upperarm_' + side], F = this.B['forearm_' + side], H = this.B['hand_' + side];
    U.parent.updateWorldMatrix(true, false);
    const S = U.getWorldPosition(new THREE.Vector3());
    const sc = this.root.scale.x;
    const L1 = F.position.length() * sc, L2 = H.position.length() * sc;
    const D = new THREE.Vector3().subVectors(target, S);
    const d = THREE.MathUtils.clamp(D.length(), 0.05, L1 + L2 - 0.002);
    const Dn = D.clone().normalize();
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const P = pole.clone().addScaledVector(Dn, -pole.dot(Dn)).normalize();
    const E = S.clone().addScaledVector(Dn, a).addScaledVector(P, h);
    const T = S.clone().addScaledVector(Dn, d);
    const parentQ = U.parent.getWorldQuaternion(new THREE.Quaternion());
    const uDir = E.clone().sub(S).normalize();
    const restU = this.bindDir['upperarm_' + side].clone().applyQuaternion(parentQ);
    const Qu = new THREE.Quaternion().setFromUnitVectors(restU, uDir).multiply(parentQ);
    U.quaternion.copy(parentQ.clone().invert().multiply(Qu));
    const fDir = T.clone().sub(E).normalize();
    const restF = this.bindDir['forearm_' + side].clone().applyQuaternion(Qu);
    const Qf = new THREE.Quaternion().setFromUnitVectors(restF, fDir).multiply(Qu);
    F.quaternion.copy(Qu.clone().invert().multiply(Qf));
    H.quaternion.identity();
    U.updateMatrixWorld(true);
  }

  fireRecoil() { this.recoil = 1; }

  // ------------------------------------------------------------------ ragdoll
  startRagdoll(impulse = new THREE.Vector3(), hitPoint = null) {
    if (this.rag) return;
    this.dead = true;
    this.root.updateMatrixWorld(true);
    const P = {};
    for (const n of RAG_POINTS) {
      const p = this.B[n].getWorldPosition(new THREE.Vector3());
      let w = 1;
      if (hitPoint) { const dd = p.distanceTo(hitPoint); w = 0.5 + 1.2 * Math.exp(-dd * dd * 4); }
      const v = impulse.clone().multiplyScalar(w * (0.85 + Math.random() * 0.3));
      P[n] = { p, o: p.clone().addScaledVector(v, -1 / 60), r: n === 'head' ? 0.11 : n.startsWith('hand') || n.startsWith('foot') ? 0.05 : 0.09 };
    }
    const L = RAG_LINKS.map(([a, b]) => ({ a: P[a], b: P[b], len: P[a].p.distanceTo(P[b].p) }));
    const M = RAG_MIN.map(([a, b, k]) => ({ a: P[a], b: P[b], min: k }));
    this.rag = { P, L, M, t: 0, sleep: 0 };
    if (this.weapon) {
      const wp = this.weapon.getWorldPosition(new THREE.Vector3());
      const wq = this.weapon.getWorldQuaternion(new THREE.Quaternion());
      this.dropped = { obj: this.weapon, vel: impulse.clone().multiplyScalar(0.8).add(new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2)), spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), pos: wp, quat: wq };
      this.root.remove(this.weapon);
      this.weapon.position.copy(wp); this.weapon.quaternion.copy(wq);
      if (this.root.parent) this.root.parent.add(this.weapon);
    }
  }

  updateRagdoll(dt, groundFn, world) {
    const R = this.rag;
    if (!R) return;
    R.t += dt;
    const g = -9.81 * dt * dt;
    let motion = 0;
    for (const n of RAG_POINTS) {
      const q = R.P[n];
      const vx = (q.p.x - q.o.x) * 0.995, vy = (q.p.y - q.o.y) * 0.995, vz = (q.p.z - q.o.z) * 0.995;
      q.o.copy(q.p);
      q.p.x += vx; q.p.y += vy + g; q.p.z += vz;
      motion += vx * vx + vy * vy + vz * vz;
    }
    for (let it = 0; it < 10; it++) {
      for (const c of R.L) {
        _a.subVectors(c.b.p, c.a.p);
        const d = _a.length() || 1e-6;
        const diff = (d - c.len) / d * 0.5;
        c.a.p.addScaledVector(_a, diff); c.b.p.addScaledVector(_a, -diff);
      }
      for (const c of R.M) {
        _a.subVectors(c.b.p, c.a.p);
        const d = _a.length() || 1e-6;
        if (d < c.min) { const diff = (d - c.min) / d * 0.5; c.a.p.addScaledVector(_a, diff); c.b.p.addScaledVector(_a, -diff); }
      }
      for (const n of RAG_POINTS) {
        const q = R.P[n];
        const gy = groundFn(q.p.x, q.p.z) + q.r;
        if (q.p.y < gy) {
          q.p.y = gy;
          q.o.x += (q.p.x - q.o.x) * 0.35; q.o.z += (q.p.z - q.o.z) * 0.35;
        }
      }
      if (world && it % 3 === 0) for (const n of ['hips', 'chest', 'head']) { const q = R.P[n]; world.resolveSphere(q.p, q.r + 0.05, this._res || (this._res = { push: new THREE.Vector3(), normal: new THREE.Vector3(), hit: null })); }
    }
    if (motion < 1e-6 * RAG_POINTS.length) R.sleep += dt; else R.sleep = 0;
    this.applyRagdollPose();
    if (this.dropped) {
      const D = this.dropped;
      D.vel.y -= 9.81 * dt;
      D.pos.addScaledVector(D.vel, dt);
      const gy = groundFn(D.pos.x, D.pos.z) + 0.04;
      if (D.pos.y < gy) { D.pos.y = gy; D.vel.multiplyScalar(0.3); D.vel.y = Math.abs(D.vel.y) * 0.2; D.spin.multiplyScalar(0.4); }
      D.quat.multiply(_q.setFromEuler(_eu.set(D.spin.x * dt, D.spin.y * dt, D.spin.z * dt)));
      D.obj.position.copy(D.pos); D.obj.quaternion.copy(D.quat);
    }
  }

  applyRagdollPose() {
    const P = this.rag.P, B = this.B;
    const basis = (up, right) => {
      const y = up.clone().normalize();
      const x = right.clone().addScaledVector(y, -right.dot(y)).normalize();
      const z = new THREE.Vector3().crossVectors(x, y).normalize();
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    };
    const meshQ = this.mesh.getWorldQuaternion(new THREE.Quaternion());
    const meshQi = meshQ.clone().invert();
    const hipsW = basis(_a.subVectors(P.chest.p, P.hips.p), _b.subVectors(P.thigh_R.p, P.thigh_L.p));
    const chestW = basis(_a.subVectors(P.head.p, P.chest.p), _b.subVectors(P.upperarm_R.p, P.upperarm_L.p));
    B.hips.position.copy(this.mesh.worldToLocal(P.hips.p.clone()));
    B.hips.quaternion.copy(meshQi.clone().multiply(hipsW));
    const spineW = hipsW.clone().slerp(chestW, 0.5);
    B.spine.quaternion.copy(hipsW.clone().invert().multiply(spineW));
    B.chest.quaternion.copy(spineW.clone().invert().multiply(chestW));
    B.neck.quaternion.identity(); B.head.quaternion.identity();
    const limb = (bone, from, to) => {
      const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      const rest = this.bindDir[bone.name].clone().applyQuaternion(parentQ);
      const dir = _c.subVectors(to.p, from.p).normalize();
      const W = new THREE.Quaternion().setFromUnitVectors(rest, dir).multiply(parentQ);
      bone.quaternion.copy(parentQ.invert().multiply(W));
      bone.updateMatrixWorld(true);
    };
    this.mesh.updateMatrixWorld(true);
    for (const s of ['R', 'L']) {
      limb(B['upperarm_' + s], P['upperarm_' + s], P['forearm_' + s]);
      limb(B['forearm_' + s], P['forearm_' + s], P['hand_' + s]);
      limb(B['thigh_' + s], P['thigh_' + s], P['shin_' + s]);
      limb(B['shin_' + s], P['shin_' + s], P['foot_' + s]);
    }
  }

  worldCenter(out = new THREE.Vector3()) {
    if (this.rag) return out.copy(this.rag.P.chest.p);
    return this.B.chest.getWorldPosition(out);
  }
}
