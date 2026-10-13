// Third-person / helmet camera: mouse look, mode-dependent framing, collision, speed FOV and shake.
import * as THREE from 'three';

const damp = (k, dt) => 1 - Math.exp(-k * dt);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export class CameraRig {
  constructor(camera, player, world) {
    this.camera = camera;
    this.player = player;
    this.world = world;
    this.yaw = 0;
    this.pitch = -0.05;
    this.view = 'tpp';
    this.dist = 6;
    this.offset = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.fov = 62;
    this.trauma = 0;
    this.shakeT = 0;
    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.zoom = 0;
    this.cinematic = null;
    this.inited = false;
    this.landCam = 0; this.landDur = 2.2;
  }

  addTrauma(t) { this.trauma = Math.min(1, this.trauma + t); }

  update(dt, mouse) {
    const P = this.player;
    if (this.cinematic) { this.cinematic(dt, this.camera); this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion); return; }
    this.yaw -= mouse.dx;
    this.pitch -= mouse.dy;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.35);
    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const speed = P.vel.length();
    const sk = THREE.MathUtils.clamp((speed - 20) / 260, 0, 1);
    let dist, side, up;
    switch (P.mode) {
      case 'ground': dist = 3.5; side = 0.78; up = 0.42; break;
      case 'landing': dist = 4.4; side = 0.5; up = 0.2; break;
      case 'hover': dist = 5.0; side = 0.62; up = 0.5; break;
      case 'flight': dist = 5.6 + sk * 4.0; side = 0.35 * (1 - P.flightBlend); up = 1.25; break;
      default: dist = 7.5; side = 0; up = 1.2;
    }
    dist *= 1 - this.zoom * 0.35;
    this.dist += (dist - this.dist) * damp(3.5, dt);
    this.offset.x += (side - this.offset.x) * damp(4, dt);
    this.offset.y += (up - this.offset.y) * damp(4, dt);
    const pivot = _a.copy(P.pos);
    pivot.y += 0.5;
    if (this.view === 'fpp') {
      const head = P.anim.B.head;
      head.getWorldPosition(_b);
      _b.y += 0.12;
      this.camera.position.copy(_b).addScaledVector(this.forward, 0.12);
    } else {
      const want = _b.copy(pivot).addScaledVector(this.forward, -this.dist).addScaledVector(this.right, this.offset.x);
      want.y += this.offset.y;
      const toCam = _c.subVectors(want, pivot);
      const len = toCam.length();
      toCam.divideScalar(len);
      const hit = this.world.raycast(pivot, toCam, len + 0.4, { terrain: true });
      if (hit) want.copy(pivot).addScaledVector(toCam, Math.max(0.6, hit.dist - 0.35));
      if (!this.inited) { this.pos.copy(want); this.inited = true; }
      const follow = P.mode === 'flight' ? 30 : 22;
      this.pos.lerp(want, damp(follow, dt));
      const lead = P.mode === 'flight' ? 0 : 0;
      this.pos.addScaledVector(P.vel, lead);
      const g = this.world.terrain.heightAt(this.pos.x, this.pos.z) + 0.5;
      if (this.pos.y < g) this.pos.y = g;
      this.camera.position.copy(this.pos);
    }
    const look = _c.copy(this.camera.position).add(this.forward);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(look);
    if (this.landCam > 0 && this.view === 'tpp') {
      this.landCam -= dt;
      const T = this.landDur, t = T - this.landCam;
      const k = THREE.MathUtils.smoothstep(t, 0, 0.35) * (1 - THREE.MathUtils.smoothstep(t, T - 0.45, T));
      const yaw = P.yaw;
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const orbit = t * 0.25;
      const cp = P.pos.clone().addScaledVector(fwd, 3.4 * Math.cos(orbit)).addScaledVector(right, 1.6 + 3.4 * Math.sin(orbit)).add(new THREE.Vector3(0, -0.15, 0));
      const g = this.world.terrain.heightAt(cp.x, cp.z) + 0.35;
      if (cp.y < g) cp.y = g;
      const tgt = P.pos.clone().add(new THREE.Vector3(0, -0.35, 0));
      const q0 = this.camera.quaternion.clone();
      const p0 = this.camera.position.clone();
      this.camera.position.copy(cp);
      this.camera.lookAt(tgt);
      const q1 = this.camera.quaternion.clone();
      this.camera.position.lerpVectors(p0, cp, k);
      this.camera.quaternion.slerpQuaternions(q0, q1, k);
    }
    if (P.mode === 'flight' && this.view === 'tpp') this.camera.rotateZ(-P.bank * 0.06);
    // shake
    this.shakeT += dt;
    const tr = this.trauma * this.trauma;
    if (tr > 0.0001) {
      const n = (s) => Math.sin(this.shakeT * 37.1 + s) * 0.6 + Math.sin(this.shakeT * 61.7 + s * 2.3) * 0.4;
      this.camera.rotateX(n(1) * 0.05 * tr);
      this.camera.rotateY(n(2) * 0.05 * tr);
      this.camera.rotateZ(n(3) * 0.04 * tr);
    }
    if (P.boosting) {
      const b = 0.0025 * (0.5 + sk);
      this.camera.rotateX((Math.random() - 0.5) * b);
      this.camera.rotateY((Math.random() - 0.5) * b);
    }
    this.trauma = Math.max(0, this.trauma - dt * 0.9);
    const fov = (this.view === 'fpp' ? 70 : 60) + sk * 22 + (P.boosting ? 4 : 0) - this.zoom * 18;
    this.fov += (fov - this.fov) * damp(3, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld();
  }
}
