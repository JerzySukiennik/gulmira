// Combat effects: explosions, impacts, muzzle flashes, tracers, missile trails, fires, light flashes, scorch decals.
import * as THREE from 'three';
import { later } from '../core/scheduler.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

function scorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = x / 128 - 1, v = y / 128 - 1;
    const a = Math.atan2(v, u), r = Math.hypot(u, v);
    const n = 0.75 + 0.25 * Math.sin(a * 7 + Math.sin(a * 3) * 2) + 0.15 * Math.sin(a * 23 + r * 9);
    const d = Math.max(0, 1 - r / (0.9 * n));
    const o = (y * 256 + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
    img.data[o + 3] = Math.min(255, Math.pow(d, 0.7) * 235 * (0.8 + Math.random() * 0.2));
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export class Effects {
  constructor({ scene, particles, terrain, world, atmo }) {
    this.scene = scene;
    this.P = particles;
    this.terrain = terrain;
    this.world = world;
    this.lights = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 40, 2);
      l.layers.enableAll();
      scene.add(l);
      this.lights.push({ l, t: 0, dur: 1, peak: 0 });
    }
    this.emitters = [];
    this.scorchMat = new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, color: 0x090706, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.decals = [];
    this.onShake = null;
    this.audio = null;
    this.listener = null;
  }

  flash(pos, color, intensity, range, dur) {
    let best = this.lights[0];
    for (const L of this.lights) if (L.t >= L.dur) { best = L; break; } else if (L.peak * (1 - L.t / L.dur) < best.peak * (1 - best.t / best.dur)) best = L;
    best.l.position.copy(pos);
    best.l.color.set(color);
    best.l.distance = range;
    best.peak = intensity; best.t = 0; best.dur = dur;
    best.l.intensity = intensity;
  }

  scorch(pos, normal, size) {
    const g = new THREE.PlaneGeometry(size, size);
    const m = new THREE.Mesh(g, this.scorchMat);
    m.position.copy(pos).addScaledVector(normal, 0.04);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    m.rotateZ(Math.random() * 6.28);
    m.renderOrder = 2;
    this.scene.add(m);
    this.decals.push(m);
    if (this.decals.length > 90) { const o = this.decals.shift(); this.scene.remove(o); o.geometry.dispose(); }
  }

  shake(pos, strength, radius) {
    if (!this.onShake || !this.listener) return;
    const d = this.listener.distanceTo(pos);
    const k = Math.max(0, 1 - d / radius);
    if (k > 0) this.onShake(strength * k * k);
  }

  sound(name, pos, opts) { if (this.audio) this.audio.play(name, pos, opts); }

  explosion(pos, { size = 1, kind = 'medium', normal = null, silent = false } = {}) {
    const P = this.P;
    const n = normal || new THREE.Vector3(0, 1, 0);
    const gy = this.terrain.heightAt(pos.x, pos.z);
    const nearGround = pos.y - gy < 3 * size;
    this.flash(_v.copy(pos).addScaledVector(n, 1.5 * size), 0xffb070, 260 * size * size, 60 * size, 0.55 + 0.25 * size);
    // core flash
    P.emit({ kind: 2, pos: pos.clone(), size: 3.2 * size, life: 0.09, color: [6, 4.2, 2.4], alpha: 1, drag: 0, fadeIn: 0 });
    P.emit({ kind: 2, pos: pos.clone(), size: 9 * size, life: 0.18, color: [1.6, 0.8, 0.35], alpha: 0.7, drag: 0, fadeIn: 0 });
    // fireball
    const nf = Math.round(42 * size + 16);
    for (let i = 0; i < nf; i++) {
      const dir = _v.set(rnd(-1, 1), rnd(-0.3, 1), rnd(-1, 1)).normalize().add(n).normalize();
      const sp = rnd(4, 18) * size;
      P.emit({ kind: 1, pos: pos.clone().addScaledVector(dir, rnd(0, 1.4) * size), vel: dir.clone().multiplyScalar(sp), size: rnd(1.1, 2.3) * size, grow: rnd(2, 3.6) * size, life: rnd(0.55, 1.5) * (0.8 + size * 0.2), drag: 3.2, buoy: 3.5, color: [3.6, 1.9, 0.7], color2: [0.8, 0.22, 0.05], alpha: 0.72, curve: 1.4, fadeIn: 0.03, wind: 0.2 });
    }
    // smoke
    const ns = Math.round(30 * size + 12);
    for (let i = 0; i < ns; i++) {
      const dir = _v.set(rnd(-1, 1), rnd(0, 1.2), rnd(-1, 1)).normalize().add(n).normalize();
      const sp = rnd(2, 10) * size;
      const dark = kind === 'vehicle' ? rnd(0.06, 0.11) : rnd(0.14, 0.26);
      P.emit({ kind: 0, pos: pos.clone().addScaledVector(dir, rnd(0, 1.5) * size), vel: dir.clone().multiplyScalar(sp * 0.8).add(new THREE.Vector3(0, rnd(1, 4) * size, 0)), size: rnd(1.8, 3.2) * size, grow: rnd(1.4, 2.6) * size, life: rnd(5, 12) * (0.7 + size * 0.3), drag: 1.4, buoy: rnd(1.6, 3.2), color: [dark * 0.85, dark * 0.75, dark * 0.65], alpha: rnd(0.45, 0.7), curve: 1.2, fadeIn: rnd(0.2, 0.5), lit: 0.9, wind: 0.8 });
    }
    // dirt column + clods
    if (nearGround) {
      for (let i = 0; i < 22 * size; i++) {
        const dir = _v.set(rnd(-0.5, 0.5), 1, rnd(-0.5, 0.5)).normalize();
        P.emit({ kind: 0, pos: pos.clone(), vel: dir.clone().multiplyScalar(rnd(8, 26) * size), size: rnd(0.8, 1.6) * size, grow: 1.8 * size, life: rnd(1.5, 3.5), drag: 1.2, grav: 7, color: [0.32, 0.26, 0.19], alpha: 0.7, curve: 1.3, lit: 1 });
      }
      for (let i = 0; i < 26 * size; i++) {
        const ang = Math.random() * 6.283;
        P.emit({ kind: 0, pos: new THREE.Vector3(pos.x + Math.cos(ang) * size, gy + 0.3, pos.z + Math.sin(ang) * size), vel: new THREE.Vector3(Math.cos(ang), rnd(0.05, 0.25), Math.sin(ang)).multiplyScalar(rnd(10, 24) * size), size: rnd(1.2, 2.2) * size, grow: 2.2 * size, life: rnd(2, 4), drag: 2.4, color: [0.5, 0.43, 0.33], alpha: 0.38, curve: 1.3, lit: 1, buoy: 0.3 });
      }
      for (let i = 0; i < 30 * size; i++) {
        const dir = _v.set(rnd(-1, 1), rnd(0.3, 1.4), rnd(-1, 1)).normalize();
        P.emit({ kind: 0, pos: pos.clone(), vel: dir.clone().multiplyScalar(rnd(6, 22) * size), size: rnd(0.12, 0.3) * Math.sqrt(size), life: rnd(1.2, 2.6), drag: 0.1, grav: 9.8, color: [0.12, 0.1, 0.08], alpha: 1, curve: 0.2, lit: 1, bounce: true, groundY: gy, wind: 0 });
      }
      this.scorch(new THREE.Vector3(pos.x, gy, pos.z), this.terrain.normalAt(pos.x, pos.z), 5 * size + 2);
    }
    // sparks
    for (let i = 0; i < 40 * size; i++) {
      const dir = _v.set(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize();
      P.emit({ kind: 3, pos: pos.clone(), vel: dir.clone().multiplyScalar(rnd(15, 55) * Math.sqrt(size)), size: rnd(0.05, 0.12), life: rnd(0.4, 1.4), drag: 0.6, grav: 9.8, color: [8, 4.5, 1.6], alpha: 1, stretch: 0.2, curve: 0.6, fadeIn: 0, bounce: true, groundY: gy, wind: 0 });
    }
    this.shake(pos, 0.35 + size * 0.25, 120 * size + 80);
    if (!silent) {
      const name = kind === 'vehicle' || size >= 2 ? 'explosion_big' : size >= 1 ? 'explosion_med' : 'explosion_small';
      this.sound(name, pos, { vol: 0.8 + size * 0.2 });
      if (size >= 1) later(0.6 + Math.random() * 0.4, () => this.sound('debris_rain', pos, { vol: 0.5 }));
    }
  }

  repulsorImpact(pos, normal, { hitBody = false } = {}) {
    const P = this.P;
    this.flash(_v.copy(pos).addScaledVector(normal, 0.6), 0xbfe2ff, 90, 22, 0.25);
    P.emit({ kind: 2, pos: pos.clone().addScaledVector(normal, 0.2), size: 3.4, life: 0.14, color: [4, 6, 9], alpha: 1, drag: 0, fadeIn: 0 });
    P.emit({ kind: 2, pos: pos.clone().addScaledVector(normal, 0.2), size: 1.4, life: 0.3, color: [6, 7, 9], alpha: 1, drag: 0, fadeIn: 0 });
    for (let i = 0; i < 22; i++) {
      const dir = _v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().addScaledVector(normal, 1.2).normalize();
      P.emit({ kind: 3, pos: pos.clone(), vel: dir.clone().multiplyScalar(rnd(10, 32)), size: rnd(0.03, 0.07), life: rnd(0.2, 0.6), drag: 1, grav: 6, color: [5, 6.5, 9], alpha: 1, stretch: 0.2, fadeIn: 0, wind: 0 });
    }
    const gy = this.terrain.heightAt(pos.x, pos.z);
    const dirt = pos.y - gy < 1.5 && !hitBody;
    for (let i = 0; i < (dirt ? 14 : 6); i++) {
      const dir = _v.set(rnd(-0.6, 0.6), rnd(0.2, 1), rnd(-0.6, 0.6)).normalize().addScaledVector(normal, 0.8).normalize();
      P.emit({ kind: 0, pos: pos.clone(), vel: dir.clone().multiplyScalar(rnd(3, 10)), size: rnd(0.5, 1.1), grow: 1.4, life: rnd(1.2, 2.8), drag: 2, buoy: 0.5, color: dirt ? [0.48, 0.41, 0.32] : [0.35, 0.33, 0.31], alpha: 0.5, lit: 1, curve: 1.3 });
    }
    if (dirt) this.scorch(new THREE.Vector3(pos.x, gy, pos.z), this.terrain.normalAt(pos.x, pos.z), rnd(1.2, 2));
    this.shake(pos, 0.12, 40);
    this.sound('repulsor_hit', pos, { vol: 0.9 });
  }

  bulletImpact(pos, normal, surface = 'dirt') {
    const P = this.P;
    if (surface === 'armor') {
      for (let i = 0; i < 6; i++) {
        const dir = _v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().addScaledVector(normal, 1.5).normalize();
        P.emit({ kind: 3, pos: pos.clone(), vel: dir.clone().multiplyScalar(rnd(6, 20)), size: rnd(0.015, 0.035), life: rnd(0.1, 0.35), drag: 1, grav: 9, color: [9, 6, 3], alpha: 1, stretch: 0.25, fadeIn: 0, wind: 0 });
      }
      P.emit({ kind: 2, pos: pos.clone(), size: 0.35, life: 0.06, color: [8, 6, 4], alpha: 1, drag: 0, fadeIn: 0 });
      return;
    }
    const col = surface === 'wall' ? [0.55, 0.47, 0.37] : [0.46, 0.39, 0.3];
    for (let i = 0; i < 4; i++) {
      const dir = _v.set(rnd(-0.4, 0.4), rnd(0.3, 1), rnd(-0.4, 0.4)).normalize().addScaledVector(normal, 0.8).normalize();
      P.emit({ kind: 0, pos: pos.clone(), vel: dir.clone().multiplyScalar(rnd(1.5, 5)), size: rnd(0.15, 0.35), grow: 0.6, life: rnd(0.6, 1.4), drag: 2.5, grav: 1, color: col, alpha: 0.6, lit: 1, curve: 1.2 });
    }
  }

  muzzleFlash(pos, dir, scale = 1) {
    const P = this.P;
    P.emit({ kind: 2, pos: pos.clone(), size: 0.7 * scale, life: 0.05, color: [9, 6, 3], alpha: 1, drag: 0, fadeIn: 0 });
    P.emit({ kind: 1, pos: pos.clone().addScaledVector(dir, 0.15 * scale), vel: dir.clone().multiplyScalar(6), size: 0.35 * scale, life: 0.05, color: [7, 4, 1.5], alpha: 1, drag: 0, fadeIn: 0, frame: Math.floor(Math.random() * 4) });
    if (Math.random() < 0.5) P.emit({ kind: 0, pos: pos.clone(), vel: dir.clone().multiplyScalar(1.5), size: 0.25 * scale, grow: 0.8, life: 0.9, drag: 1.5, buoy: 0.4, color: [0.5, 0.48, 0.45], alpha: 0.25, lit: 1 });
    if (Math.random() < 0.35) this.flash(pos, 0xffc080, 6 * scale, 10, 0.06);
  }

  tracer(from, dir, speed = 750, color = [9, 5, 2.2]) {
    this.P.emit({ kind: 3, pos: from.clone(), vel: dir.clone().multiplyScalar(speed), size: 0.12, life: 0.6, drag: 0, grav: 0, color, alpha: 1, stretch: 0.16, fadeIn: 0, curve: 0.1, wind: 0 });
  }

  missileTrail(pos, vel, scale = 1, fire = true) {
    const P = this.P;
    if (fire) P.emit({ kind: 1, pos: pos.clone(), vel: vel.clone().multiplyScalar(-0.1), size: 0.5 * scale, life: 0.07, color: [8, 5, 2.5], alpha: 1, drag: 0, fadeIn: 0 });
    P.emit({ kind: 0, pos: pos.clone(), vel: _v.set(rnd(-0.5, 0.5), rnd(-0.2, 0.5), rnd(-0.5, 0.5)).addScaledVector(vel, 0.02), size: 0.45 * scale, grow: 0.9 * scale, life: rnd(2.2, 4.2), drag: 1.5, buoy: 0.3, color: [0.78, 0.76, 0.73], alpha: 0.5, lit: 1, curve: 1.1, fadeIn: 0.05 });
  }

  addFire(pos, size = 1, duration = 60, smokeDark = 0.08) {
    const e = { pos: pos.clone(), size, t: 0, duration, acc: 0, dark: smokeDark, lightT: 0 };
    this.emitters.push(e);
    return e;
  }

  update(dt) {
    for (const L of this.lights) {
      if (L.t < L.dur) { L.t += dt; const k = Math.max(0, 1 - L.t / L.dur); L.l.intensity = L.peak * k * k; }
      else L.l.intensity = 0;
    }
    const P = this.P;
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.t += dt;
      if (e.t > e.duration) { this.emitters.splice(i, 1); continue; }
      const fade = Math.min(1, (e.duration - e.t) / 8);
      e.acc += dt * 18 * e.size * fade;
      while (e.acc > 1) {
        e.acc -= 1;
        const p = e.pos.clone().add(_w.set(rnd(-1, 1) * e.size, rnd(0, 0.5) * e.size, rnd(-1, 1) * e.size));
        P.emit({ kind: 1, pos: p, vel: new THREE.Vector3(rnd(-0.5, 0.5), rnd(2, 4) * e.size, rnd(-0.5, 0.5)), size: rnd(0.5, 1.0) * e.size, grow: 0.7 * e.size, life: rnd(0.4, 0.9), drag: 1, buoy: 2.5, color: [3.6, 1.8, 0.6], color2: [0.9, 0.22, 0.04], alpha: 0.75, curve: 1.5, fadeIn: 0.05, wind: 0.4 });
        if (Math.random() < 0.4) P.emit({ kind: 0, pos: p.clone().add(new THREE.Vector3(0, e.size * 1.6, 0)), vel: new THREE.Vector3(rnd(-0.3, 0.3), rnd(3, 5.5), rnd(-0.3, 0.3)), size: rnd(1.0, 1.6) * e.size, grow: rnd(1.2, 1.9) * e.size, life: rnd(7, 12), drag: 0.35, buoy: 0.8, color: [e.dark, e.dark * 0.95, e.dark * 0.9], alpha: 0.42, lit: 0.8, curve: 1.1, fadeIn: 0.6, wind: 0.9 });
      }
      e.lightT -= dt;
      if (e.lightT <= 0) { e.lightT = 0.12; this.flash(_w.copy(e.pos).add(new THREE.Vector3(0, e.size, 0)), 0xff8a40, 22 * e.size * fade * (0.7 + Math.random() * 0.6), 18 * e.size, 0.18); }
    }
  }
}
