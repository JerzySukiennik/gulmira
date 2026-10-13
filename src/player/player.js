// Player suit controller: ground walking, hover, flight, landings, crashes and knockdowns.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const COM = 1.02;

export const TUNE = {
  walk: 2.1, run: 5.4, hoverSpeed: 17, hoverBoost: 26, hoverAcc: 11, climb: 10,
  cruise: 115, boost: 285, flightAcc: 34, boostAcc: 62, brake: 46, maxLat: 135, minTurn: 2.4,
  flightMin: 16, crashSpeed: 38, regenDelay: 4.2, regenRate: 11,
};

export class Player {
  constructor({ suit, animator, terrain, world, input }) {
    this.suit = suit;
    this.anim = animator;
    this.terrain = terrain;
    this.world = world;
    this.input = input;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.mode = 'hover';
    this.bodyQuat = new THREE.Quaternion();
    this.yaw = 0;
    this.camYaw = 0; this.camPitch = 0;
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.aimPoint = new THREE.Vector3();
    this.flightBlend = 0;
    this.bank = 0;
    this.thrust = 0;
    this.boosting = false;
    this.integrity = 100;
    this.lastHit = -99;
    this.time = 0;
    this.landT = 0;
    this.knockT = 0;
    this.spin = new THREE.Vector3();
    this.groundY = 0;
    this.agl = 0;
    this.events = [];
    this.locked = false;
    this.invulnerable = false;
    this.aimR = false; this.aimL = false;
    this.moveLocal = new THREE.Vector3();
    this.res = { push: new THREE.Vector3(), normal: new THREE.Vector3(), hit: null };
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  spawn(pos, mode = 'flight', vel = null, yaw = 0) {
    this.pos.copy(pos);
    this.vel.copy(vel || new THREE.Vector3());
    this.mode = mode;
    this.yaw = yaw; this.camYaw = yaw; this.camPitch = 0;
    this.flightBlend = mode === 'flight' ? 1 : 0;
    this.integrity = 100;
    this.knockT = 0; this.landT = 0;
    this.updateBodyQuat(1, 1 / 60);
  }

  hit(damage, impulse = null, kind = 'bullet') {
    if (this.mode === 'dead') return;
    if (!this.invulnerable) this.integrity = Math.max(0, this.integrity - damage);
    this.lastHit = this.time;
    this.emit('hit', { damage, kind, impulse: impulse ? impulse.clone() : null });
    if (impulse) {
      this.vel.add(impulse);
      if (impulse.length() > 14 && this.mode !== 'knockdown') this.knockdown(impulse);
    }
    if (this.integrity <= 0) { this.mode = 'dead'; this.knockT = 0; this.emit('dead'); }
  }

  knockdown(impulse) {
    this.mode = 'knockdown';
    this.knockT = 0;
    _a.copy(impulse).normalize();
    this.spin.set(_a.z, (Math.random() - 0.5) * 2, -_a.x).multiplyScalar(5 + Math.random() * 3);
    this.emit('knockdown');
  }

  inputVector() {
    const I = this.input;
    const f = (I.key('KeyW') ? 1 : 0) - (I.key('KeyS') ? 1 : 0);
    const r = (I.key('KeyD') ? 1 : 0) - (I.key('KeyA') ? 1 : 0);
    return { f, r };
  }

  update(dt, camYaw, camPitch, camForward) {
    this.time += dt;
    this.camYaw = camYaw; this.camPitch = camPitch;
    const I = this.input;
    const { f, r } = this.locked ? { f: 0, r: 0 } : this.inputVector();
    const shift = !this.locked && I.key('ShiftLeft');
    const space = !this.locked && I.key('Space');
    const down = !this.locked && (I.key('ControlLeft') || I.key('KeyC'));
    const fwdFlat = _a.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const rightFlat = _b.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    this.groundY = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y - COM + 0.5);
    this.agl = this.pos.y - COM - this.groundY;
    const prevVel = this.vel.clone();
    this.thrust = 0;
    this.boosting = false;

    if (this.mode === 'ground') {
      const speed = shift ? TUNE.run : TUNE.walk;
      const want = _c.set(0, 0, 0).addScaledVector(fwdFlat, f).addScaledVector(rightFlat, r);
      if (want.lengthSq() > 1) want.normalize();
      want.multiplyScalar(speed);
      if (this.autoWalk) want.copy(this.autoWalk).setY(0).normalize().multiplyScalar(TUNE.walk);
      const k = damp(want.lengthSq() > 0.01 ? 7 : 10, dt);
      this.vel.x += (want.x - this.vel.x) * k;
      this.vel.z += (want.z - this.vel.z) * k;
      this.vel.y = 0;
      this.pos.addScaledVector(this.vel, dt);
      const g = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y - COM + 0.6);
      this.pos.y += (g + COM - this.pos.y) * damp(18, dt);
      this.yaw = this.autoWalk ? this.turnToward(this.yaw, Math.atan2(-this.autoWalk.x, -this.autoWalk.z), 6, dt) : this.turnToward(this.yaw, camYaw, 7, dt);
      if (I.hit('Space') && !this.locked) {
        this.mode = 'hover';
        this.vel.y = 7.5;
        this.emit('takeoff');
      }
      if (this.agl > 1.6) this.mode = 'hover';
    } else if (this.mode === 'hover') {
      const sp = shift ? TUNE.hoverBoost : TUNE.hoverSpeed;
      const want = _c.set(0, 0, 0).addScaledVector(fwdFlat, f).addScaledVector(rightFlat, r);
      if (want.lengthSq() > 1) want.normalize();
      want.multiplyScalar(sp);
      want.y = space ? TUNE.climb : down ? -TUNE.climb : 0;
      if (this.agl < 3 && !space && !down) want.y = Math.max(want.y, (3 - this.agl) * 1.2);
      const acc = _d.subVectors(want, this.vel).multiplyScalar(2.6);
      const al = acc.length();
      if (al > TUNE.hoverAcc) acc.multiplyScalar(TUNE.hoverAcc / al);
      this.vel.addScaledVector(acc, dt);
      this.acc.copy(acc);
      this.thrust = 0.45 + Math.min(0.55, al / TUNE.hoverAcc * 0.5) + (space ? 0.2 : 0);
      this.pos.addScaledVector(this.vel, dt);
      this.yaw = this.turnToward(this.yaw, camYaw, 5, dt);
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if ((shift && f > 0) || (f > 0 && hs > TUNE.hoverSpeed * 0.9 && shift)) {
        this.mode = 'flight';
        this.vel.addScaledVector(camForward, 14);
        this.emit('boost');
      }
      if (this.agl < 0.08 && this.vel.y <= 0.5 && !space) this.touchDown(prevVel);
    } else if (this.mode === 'flight') {
      const speed = this.vel.length();
      const aim = this.locked && speed > 1 ? this.vel.clone().normalize() : camForward;
      let target = speed;
      let accel = TUNE.flightAcc;
      if (f > 0) { target = shift ? TUNE.boost : TUNE.cruise; accel = shift ? TUNE.boostAcc : TUNE.flightAcc; this.boosting = shift; }
      const dir = speed > 0.5 ? _c.copy(this.vel).divideScalar(speed) : _c.copy(aim);
      const omega = Math.min(TUNE.minTurn, TUNE.maxLat / Math.max(speed, 1)) * (f < 0 ? 0.5 : 1);
      const ang = dir.angleTo(aim);
      if (ang > 1e-4) {
        const t = Math.min(1, omega * dt / ang);
        _d.copy(dir).lerp(aim, t).normalize();
        const lat = _a.copy(_d).sub(dir).divideScalar(dt).multiplyScalar(Math.max(speed, 20));
        this.acc.copy(lat);
        dir.copy(_d);
      } else this.acc.set(0, 0, 0);
      let ns = speed;
      if (f > 0) ns = speed < target ? Math.min(target, speed + accel * dt) : Math.max(target, speed - 12 * dt);
      else if (f < 0) ns = Math.max(0, speed - TUNE.brake * dt);
      else if (!this.locked) ns = speed * Math.exp(-0.07 * dt);
      ns *= Math.exp(-Math.min(ang, omega * dt) * 0.35);
      ns += -dir.y * 9.81 * 0.35 * dt;
      this.vel.copy(dir).multiplyScalar(Math.max(0, ns));
      if (space) this.vel.y += 14 * dt;
      if (down) this.vel.y -= 14 * dt;
      this.thrust = f > 0 ? (shift ? 1 : 0.75) : f < 0 ? 0.9 : 0.4;
      this.pos.addScaledVector(this.vel, dt);
      const latSign = this.acc.dot(_b.set(Math.cos(camYaw), 0, -Math.sin(camYaw)));
      this.bank += (THREE.MathUtils.clamp(-latSign / 45, -1.1, 1.1) - this.bank) * damp(4, dt);
      this.yaw = Math.atan2(-dir.x, -dir.z);
      if (ns < TUNE.flightMin && f <= 0) { this.mode = 'hover'; this.emit('hoverIn'); }
      if (this.agl < 0.6) {
        const n = this.terrain.normalAt(this.pos.x, this.pos.z, _d);
        const into = -this.vel.dot(n);
        if (into > TUNE.crashSpeed * 0.55 && ns > TUNE.crashSpeed) this.crash(n, ns);
        else if (this.vel.y < -6 && ns < 60 && this.agl < 0.2) this.touchDown(prevVel);
        else { if (into > 0) this.vel.addScaledVector(n, into); this.pos.y = Math.max(this.pos.y, this.groundY + COM + 0.6); }
      }
    } else if (this.mode === 'landing') {
      this.landT += dt / 1.45;
      this.vel.multiplyScalar(Math.exp(-dt * 12));
      this.pos.addScaledVector(this.vel, dt);
      const g = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
      this.pos.y = g + COM;
      if (this.landT >= 1) { this.mode = 'ground'; this.vel.set(0, 0, 0); }
      if (this.landT > 0.55 && (f || r)) { this.mode = 'ground'; }
      if (this.landT > 0.4 && I.hit('Space')) { this.mode = 'hover'; this.vel.y = 8; this.emit('takeoff'); }
    } else if (this.mode === 'knockdown' || this.mode === 'dead') {
      this.knockT += dt;
      this.vel.y -= 9.81 * dt;
      this.vel.multiplyScalar(Math.exp(-dt * 0.4));
      this.pos.addScaledVector(this.vel, dt);
      if (this.agl < 0.2) {
        this.pos.y = this.groundY + COM * 0.45;
        if (this.vel.y < -4) this.emit('impact', { speed: -this.vel.y });
        this.vel.y = Math.abs(this.vel.y) * 0.25;
        this.vel.x *= 0.5; this.vel.z *= 0.5;
        this.spin.multiplyScalar(0.5);
      }
      this.spin.multiplyScalar(Math.exp(-dt * 1.2));
      if (this.mode === 'knockdown' && this.knockT > 1.3) {
        this.mode = this.agl < 1 ? 'landing' : 'hover';
        this.landT = 0.3;
        if (this.mode === 'hover') this.vel.multiplyScalar(0.3);
        this.emit('recover');
      }
    }

    // collisions with buildings and rocks (sphere around the torso and one at the legs)
    if (this.mode !== 'ground' || true) {
      for (const off of [0.35, -0.45]) {
        _d.copy(this.pos); _d.y += off;
        const res = this.world.resolveSphere(_d, 0.45, this.res);
        if (res.hit) {
          this.pos.add(res.push);
          const n = res.normal;
          const into = -this.vel.dot(n);
          if (into > 0) {
            if (into > 30 && this.mode === 'flight') this.crash(n, into);
            this.vel.addScaledVector(n, into * (this.mode === 'flight' ? 1.05 : 1));
          }
        }
      }
    }
    if (this.pos.y < this.groundY + COM * 0.4) this.pos.y = this.groundY + COM * 0.4;

    // regen
    if (this.mode !== 'dead' && this.time - this.lastHit > TUNE.regenDelay) this.integrity = Math.min(100, this.integrity + TUNE.regenRate * dt);

    const fb = this.mode === 'flight' ? THREE.MathUtils.clamp((this.vel.length() - 8) / 28, 0, 1) : 0;
    this.flightBlend += (fb - this.flightBlend) * damp(this.mode === 'flight' ? 3.5 : 5, dt);
    this.updateBodyQuat(this.flightBlend, dt);
    this.suit.quaternion.copy(this.bodyQuat);
    _a.set(0, COM, 0).applyQuaternion(this.bodyQuat);
    this.suit.position.copy(this.pos).sub(_a);
    this.suit.updateMatrixWorld(true);
  }

  turnToward(a, b, rate, dt) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * damp(rate, dt);
  }

  updateBodyQuat(fb, dt) {
    // upright frame with lean from acceleration
    const qUp = _q.setFromAxisAngle(UP, this.yaw);
    if (this.mode === 'hover' || this.mode === 'ground' || this.mode === 'landing') {
      const local = _a.copy(this.acc).applyQuaternion(_q2.copy(qUp).invert());
      const leanF = this.mode === 'hover' ? THREE.MathUtils.clamp(local.z / 30, -0.35, 0.35) : 0;
      const leanS = this.mode === 'hover' ? THREE.MathUtils.clamp(-local.x / 30, -0.3, 0.3) : 0;
      const lv = _b.copy(this.vel).applyQuaternion(_q2);
      const velLean = this.mode === 'hover' ? THREE.MathUtils.clamp(lv.z / 60, -0.3, 0.3) : 0;
      _q2.setFromEuler(new THREE.Euler(leanF + velLean, 0, leanS, 'XYZ'));
      qUp.multiply(_q2);
    }
    let target = qUp;
    if (fb > 0.001 && this.vel.lengthSq() > 1) {
      const v = _a.copy(this.vel).normalize();
      const ref = Math.abs(v.y) > 0.97 ? _b.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw)) : _b.set(0, 1, 0);
      const back = _c.copy(ref).addScaledVector(v, -ref.dot(v)).normalize();
      if (Math.abs(v.y) > 0.97) back.negate();
      const x = _d.crossVectors(v, back).normalize();
      _m.makeBasis(x, v, back);
      const qf = new THREE.Quaternion().setFromRotationMatrix(_m);
      qf.multiply(new THREE.Quaternion().setFromAxisAngle(UP, this.bank * 0.9));
      target = qUp.clone().slerp(qf, fb);
    }
    if (this.mode === 'knockdown' || this.mode === 'dead') {
      const s = this.spin.length();
      if (s > 1e-3) this.bodyQuat.premultiply(new THREE.Quaternion().setFromAxisAngle(_a.copy(this.spin).divideScalar(s), s * dt));
      return;
    }
    this.bodyQuat.slerp(target, damp(this.mode === 'flight' ? 7 : 9, dt));
  }

  touchDown(prevVel) {
    const vy = -prevVel.y, hs = Math.hypot(prevVel.x, prevVel.z);
    if (vy > 9 || hs > 22) {
      this.mode = 'landing';
      this.landT = 0;
      this.vel.set(prevVel.x * 0.3, 0, prevVel.z * 0.3);
      this.emit('heroLanding', { speed: Math.max(vy, hs * 0.5) });
    } else {
      this.mode = 'ground';
      this.vel.y = 0;
      this.emit('land', { speed: vy });
    }
  }

  crash(n, speed) {
    this.hit(Math.min(35, (speed - TUNE.crashSpeed) * 0.35 + 6), null, 'crash');
    this.emit('crash', { speed, normal: n.clone() });
    const into = -this.vel.dot(n);
    this.vel.addScaledVector(n, into * 1.4).multiplyScalar(0.45);
    this.knockdown(n.clone().multiplyScalar(20));
  }

  animState() {
    const inv = _q.copy(this.bodyQuat).invert();
    const velLocal = this.vel.clone().applyQuaternion(inv);
    const yawQ = _q2.setFromAxisAngle(UP, this.yaw).invert();
    const moveLocal = this.vel.clone().applyQuaternion(yawQ);
    moveLocal.z = -moveLocal.z;
    return {
      mode: this.mode === 'takeoff' ? 'hover' : (this.mode === 'flight' && this.flightBlend < 0.35 ? 'hover' : this.mode),
      groundSpeed: Math.hypot(this.vel.x, this.vel.z),
      moveLocal,
      velLocal,
      speedK: THREE.MathUtils.clamp(this.vel.length() / TUNE.boost, 0, 1),
      bank: this.bank,
      landT: this.landT,
      lookPitch: THREE.MathUtils.clamp(this.camPitch, -0.6, 0.5),
      aimDir: this.aimDir,
      aimR: this.aimR, aimL: this.aimL,
    };
  }
}
