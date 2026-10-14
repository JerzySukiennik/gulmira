// Weapons and projectiles for both sides: repulsors, micro-missiles with multi-lock, forearm rocket, flares,
// enemy rifles/HMG/RPG/tank shells/guided missiles, and area damage.
import * as THREE from 'three';
import { later } from '../core/scheduler.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);

function missileMesh(len, r, body, nose) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), body);
  b.rotation.x = Math.PI / 2; g.add(b);
  const n = new THREE.Mesh(new THREE.ConeGeometry(r, len * 0.3, 10), nose);
  n.rotation.x = -Math.PI / 2; n.position.z = -len * 0.65; g.add(n);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.004, r * 3.2, len * 0.18), body);
    f.position.z = len * 0.4; f.rotation.z = i * Math.PI / 2; g.add(f);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class Combat {
  constructor({ scene, world, terrain, fx, audio, player, anim, camera, atmo }) {
    Object.assign(this, { scene, world, terrain, fx, audio, player, anim, camera });
    this.projectiles = [];
    this.hitables = [];
    this.locks = [];
    this.scanning = false;
    this.scanT = 0;
    this.repulsorT = 0;
    this.side = 'R';
    this.aimHold = { R: 0, L: 0 };
    this.decoys = [];
    this.stats = { shots: 0, hits: 0, kills: 0, civilians: 0, vehicles: 0, missiles: 0 };
    this.time = 0;
    const mk = (c, e = 0) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.3, emissive: e }); atmo.patch(m, { key: 'proj' }); return m; };
    this.mats = { white: mk(0xd8d8d4), red: mk(0x9c1a12), olive: mk(0x4a5236), dark: mk(0x222222), gray: mk(0x8a8d90) };
    this.civilianIds = new Set();
    this.onEvent = null;
    this.scanCivilians = [];
  }

  addHitable(h) { this.hitables.push(h); }
  emit(type, data) { if (this.onEvent) this.onEvent(type, data); }

  // nearest hit across world, terrain and dynamic entities
  raycastAll(o, d, maxDist, { ignore = null, entities = true, worldToo = true } = {}) {
    let best = null;
    if (worldToo) {
      const w = this.world.raycast(o, d, maxDist, { terrain: true });
      if (w) best = { dist: w.dist, point: w.point, normal: w.normal, ent: null, surface: w.terrain ? 'dirt' : 'wall' };
    }
    if (entities) for (const h of this.hitables) {
      if (h === ignore || h.dead) continue;
      const r = h.raycast(o, d, best ? best.dist : maxDist);
      if (r && (!best || r.dist < best.dist)) best = { ...r, ent: h };
    }
    return best;
  }

  // ------------------------------------------------------------------ player weapons
  aimPoint() {
    const cam = this.camera;
    const o = cam.position.clone();
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = this.raycastAll(o, d, 3000, { ignore: null });
    return hit ? hit : { point: o.clone().addScaledVector(d, 2000), dist: 2000, ent: null };
  }

  fireRepulsor() {
    const P = this.player;
    const side = this.side;
    this.side = side === 'R' ? 'L' : 'R';
    this.aimHold[side] = 0.9;
    const muzzle = this.anim.palm(side, new THREE.Vector3());
    const tgt = this.aimPoint();
    const dir = tgt.point.clone().sub(muzzle).normalize();
    this.projectiles.push({ kind: 'repulsor', pos: muzzle.clone(), vel: dir.clone().multiplyScalar(520), life: 3, owner: 'player', dmg: 100 });
    this.anim.fire(side);
    this.fx.flash(muzzle, 0xcfe8ff, 50, 18, 0.12);
    this.fx.P.emit({ kind: 2, pos: muzzle.clone(), size: 1.6, life: 0.1, color: [5, 7, 10], alpha: 1, drag: 0, fadeIn: 0 });
    this.fx.P.emit({ kind: 2, pos: muzzle.clone().addScaledVector(dir, 0.3), size: 0.7, life: 0.18, color: [6, 8, 10], alpha: 1, drag: 0, fadeIn: 0 });
    this.audio.play('repulsor_fire', muzzle, { vol: 1.0, ref: 6, noDelay: true, verb: 0.4 });
    this.stats.shots++;
    if (this.onRepulsor) this.onRepulsor(side);
    P.recoilKick = (P.recoilKick || 0) + 1;
  }

  updateScan(dt, hostiles, civilians) {
    this.scanT -= dt;
    const cam = this.camera;
    const proj = new THREE.Vector3();
    const P = this.player;
    // tag civilians in view for the HUD
    this.scanCivilians = [];
    for (const c of civilians) {
      if (c.dead) continue;
      c.center(proj);
      const dist = proj.distanceTo(P.pos);
      if (dist > 300) continue;
      proj.project(cam);
      if (proj.z > 1 || Math.abs(proj.x) > 0.6 || Math.abs(proj.y) > 0.6) continue;
      this.scanCivilians.push(c);
    }
    if (this.scanT > 0 || this.locks.length >= 12) return;
    let best = null, bestS = 1e9;
    for (const h of hostiles) {
      if (h.dead || this.locks.includes(h)) continue;
      h.center(_a);
      const dist = _a.distanceTo(P.pos);
      if (dist > 380 || dist < 4) continue;
      proj.copy(_a).project(cam);
      if (proj.z > 1) continue;
      const r = Math.hypot(proj.x * cam.aspect, proj.y);
      if (r > 0.42) continue;
      const o = P.pos.clone().add(new THREE.Vector3(0, 0.4, 0));
      const dir = _b.subVectors(_a, o);
      const len = dir.length(); dir.divideScalar(len);
      const blk = this.world.raycast(o, dir, len - 1, { terrain: true });
      if (blk) continue;
      const score = r * 2 + dist / 400;
      if (score < bestS) { bestS = score; best = h; }
    }
    if (best) {
      this.locks.push(best);
      best.lockT = 0;
      this.scanT = 0.11;
      this.audio.play('hud_tick', null, { vol: 0.5, bus: 'ui' });
    }
  }

  launchMicroMissiles() {
    const locks = this.locks.slice();
    this.locks = [];
    const n = Math.max(locks.length, locks.length ? 0 : 4);
    if (!n) return;
    this.anim.podsTarget = 1;
    const aim = this.aimPoint();
    for (let i = 0; i < n; i++) {
      later(i * 0.075, () => {
        const side = i % 2 ? 'L' : 'R';
        const from = this.anim.podPos(side, new THREE.Vector3());
        const tgt = locks[i] || null;
        const up = new THREE.Vector3(rnd(-0.4, 0.4), 1, rnd(-0.4, 0.4)).normalize();
        const mesh = missileMesh(0.32, 0.022, this.mats.white, this.mats.red);
        mesh.position.copy(from);
        this.scene.add(mesh);
        this.projectiles.push({ kind: 'micro', pos: from.clone(), vel: up.multiplyScalar(30).add(this.player.vel.clone().multiplyScalar(0.8)), life: 9, owner: 'player', target: tgt, aimPoint: tgt ? null : aim.point.clone().add(new THREE.Vector3(rnd(-4, 4), 0, rnd(-4, 4))), mesh, speed: 30, age: 0, dmg: 100 });
        this.audio.play('missile_salvo', from, { vol: 0.55, ref: 8, noDelay: true });
        this.fx.P.emit({ kind: 2, pos: from.clone(), size: 0.6, life: 0.08, color: [8, 5, 2], alpha: 1, drag: 0, fadeIn: 0 });
      });
    }
    later(n * 0.075 + 0.6, () => { this.anim.podsTarget = 0; });
    this.stats.missiles += n;
    this.emit('microLaunch', { n, locked: locks.length });
  }

  fireRocket(vehicleTargets) {
    const side = 'L';
    this.anim.hatchTarget[side] = 1;
    this.aimHold[side] = 1.6;
    const aim = this.aimPoint();
    let target = aim.ent && aim.ent.isVehicle ? aim.ent : null;
    if (!target) {
      const cam = this.camera, f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      let best = 0.955;
      for (const v of vehicleTargets) {
        if (v.dead) continue;
        v.center(_a);
        const d = _a.sub(cam.position).normalize().dot(f);
        if (d > best) { best = d; target = v; }
      }
    }
    later(0.38, () => {
      const from = this.anim.launcherPos(side, new THREE.Vector3());
      const dir = (target ? target.center(new THREE.Vector3()) : aim.point.clone()).sub(from).normalize();
      const mesh = missileMesh(0.5, 0.032, this.mats.gray, this.mats.dark);
      mesh.position.copy(from);
      this.scene.add(mesh);
      this.projectiles.push({ kind: 'rocket', pos: from.clone(), vel: dir.multiplyScalar(60).add(this.player.vel.clone()), life: 8, owner: 'player', target, aimPoint: aim.point.clone(), mesh, speed: 60, age: 0, dmg: 160 });
      this.audio.play('rpg_launch', from, { vol: 0.9, ref: 8, noDelay: true });
      this.fx.flash(from, 0xffb070, 30, 12, 0.15);
      this.anim.fire(side);
      this.emit('rocket', { target });
    });
    later(1.5, () => { this.anim.hatchTarget[side] = 0; });
  }

  fireFlares() {
    const P = this.player;
    const base = P.pos.clone();
    for (let i = 0; i < 10; i++) {
      later(i * 0.06, () => {
        const dir = new THREE.Vector3(rnd(-1, 1), rnd(-0.6, 0.6), rnd(-1, 1)).normalize();
        const back = P.vel.clone().normalize().multiplyScalar(-1);
        const v = P.vel.clone().multiplyScalar(0.6).add(dir.multiplyScalar(rnd(18, 34))).addScaledVector(back, 10);
        this.decoys.push({ pos: P.pos.clone(), vel: v, life: 4.5, heat: 1.6 });
      });
    }
    this.audio.play('flare_launch', base, { vol: 0.8, noDelay: true });
    this.emit('flares');
  }

  // ------------------------------------------------------------------ enemy weapons
  enemyBullet(origin, dir, { dmg = 0.55, spread = 0.02, tracer = false, kind = 'ak', shooter = null } = {}) {
    const d = dir.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(spread)).normalize();
    if (tracer) this.fx.tracer(origin.clone().addScaledVector(d, 1.5), d, 720, kind === 'hmg' ? [9, 4, 1.5] : [8, 5, 2]);
    const P = this.player;
    // player hit test: capsule approximated by a sphere at the torso plus one at the legs
    const center = P.pos;
    _a.subVectors(center, origin);
    const t = _a.dot(d);
    if (t > 0 && t < 1200) {
      _b.copy(origin).addScaledVector(d, t);
      const miss = _b.distanceTo(center);
      if (miss < 0.75) {
        const blk = this.world.raycast(origin, d, t - 1, { terrain: true });
        if (!blk) {
          later(t / 720, () => {
            this.player.hit(dmg, null, kind);
            const hp = center.clone().addScaledVector(d, -0.5);
            this.fx.bulletImpact(hp, d.clone().negate(), 'armor');
            if (Math.random() < 0.35) this.audio.play('ricochet', hp, { vol: 0.5, ref: 4, noDelay: true });
            this.emit('playerHit', { kind, dir: d.clone() });
          });
          return true;
        }
      } else if (miss < 6 && Math.random() < 0.3) {
        const fp = _b.clone();
        later(t / 720, () => this.audio.play('bullet_flyby', fp, { vol: 0.5, ref: 3, noDelay: true }));
      }
    }
    if (Math.random() < 0.25 && origin.distanceTo(P.pos) < 400) {
      const w = this.world.raycast(origin, d, 600, { terrain: true });
      if (w && w.point.distanceTo(P.pos) < 120) later(w.dist / 720, () => this.fx.bulletImpact(w.point, w.normal, w.terrain ? 'dirt' : 'wall'));
    }
    return false;
  }

  enemyRPG(origin, dir, shooter) {
    const mesh = missileMesh(0.9, 0.04, this.mats.olive, this.mats.olive);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.projectiles.push({ kind: 'rpg', pos: origin.clone(), vel: dir.clone().multiplyScalar(115), life: 7, owner: 'enemy', mesh, dmg: 13, age: 0, shooter });
    this.audio.play('rpg_launch', origin, { vol: 1.0, ref: 14 });
    this.fx.muzzleFlash(origin, dir, 2.5);
    for (let i = 0; i < 12; i++) this.fx.P.emit({ kind: 0, pos: origin.clone().addScaledVector(dir, -1), vel: dir.clone().multiplyScalar(-rnd(4, 10)).add(new THREE.Vector3(rnd(-1, 1), rnd(0, 1), rnd(-1, 1))), size: 0.7, grow: 1.5, life: rnd(1.5, 3), drag: 2, color: [0.75, 0.72, 0.68], alpha: 0.6, lit: 1 });
  }

  enemyShell(origin, dir, shooter) {
    this.projectiles.push({ kind: 'shell', pos: origin.clone(), vel: dir.clone().multiplyScalar(900), life: 4, owner: 'enemy', dmg: 30, age: 0, shooter });
    this.fx.tracer(origin, dir, 900, [9, 6, 3]);
  }

  enemyMissile(origin, target, { speed = 520, turn = 3.2, dmg = 34, kind = 'aim9', seeker = 'heat' } = {}) {
    const mesh = missileMesh(2.6, 0.065, this.mats.white, this.mats.gray);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    const dir = target.pos.clone().sub(origin).normalize();
    const p = { kind: 'guided', sub: kind, pos: origin.clone(), vel: dir.multiplyScalar(speed * 0.6), life: 14, owner: 'enemy', mesh, dmg, age: 0, speed, turn, target, seeker, decoyed: null };
    this.projectiles.push(p);
    this.emit('missileLaunch', { p });
    return p;
  }

  // ------------------------------------------------------------------ explosions
  explode(pos, { radius = 6, dmg = 100, impulse = 18, size = 1, kind = 'medium', normal = null, owner = 'player' } = {}) {
    this.fx.explosion(pos, { size, kind, normal });
    for (const h of this.hitables) {
      if (h.dead) continue;
      h.center(_a);
      const d = _a.distanceTo(pos);
      if (d > radius + (h.radius || 1)) continue;
      const k = Math.max(0, 1 - d / (radius + (h.radius || 1)));
      const dir = _a.clone().sub(pos).normalize();
      dir.y = Math.abs(dir.y) * 0.5 + 0.6;
      h.takeHit({ dmg: dmg * (0.35 + 0.65 * k), impulse: dir.multiplyScalar(impulse * (0.4 + k)), point: _a.clone(), source: owner, explosive: true });
    }
    const P = this.player;
    const pd = P.pos.distanceTo(pos);
    if (owner !== 'player' && pd < radius * 1.6) {
      const k = 1 - pd / (radius * 1.6);
      P.hit(dmg * 0.3 * k, P.pos.clone().sub(pos).normalize().multiplyScalar(impulse * k * 0.8 + 2), 'explosion');
    } else if (owner === 'player' && pd < radius * 0.8) {
      P.hit(2 * (1 - pd / radius), null, 'explosion');
    }
    this.emit('explosion', { pos, radius });
  }

  // ------------------------------------------------------------------ update
  update(dt, { hostiles = [], civilians = [] } = {}) {
    this.time += dt;
    const P = this.player;
    for (const s of ['R', 'L']) this.aimHold[s] = Math.max(0, this.aimHold[s] - dt);
    P.aimR = this.aimHold.R > 0 || (this.scanning && false);
    P.aimL = this.aimHold.L > 0;
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const f = this.decoys[i];
      f.life -= dt;
      if (f.life <= 0) { this.decoys.splice(i, 1); continue; }
      f.vel.y -= 4 * dt; f.vel.multiplyScalar(Math.exp(-dt * 0.9));
      f.pos.addScaledVector(f.vel, dt);
      this.fx.P.emit({ kind: 2, pos: f.pos.clone(), size: 2.6 + Math.random() * 1.2, life: 0.08, color: [9, 7.5, 5], alpha: 1, drag: 0, fadeIn: 0 });
      this.fx.P.emit({ kind: 0, pos: f.pos.clone(), vel: new THREE.Vector3(0, 0.5, 0), size: 0.6, grow: 1.6, life: rnd(2.5, 4), drag: 1, color: [0.85, 0.85, 0.82], alpha: 0.35, lit: 1, fadeIn: 0.05 });
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt; p.age = (p.age || 0) + dt;
      if (p.life <= 0) { this.kill(i, p, false); continue; }
      if (p.kind === 'micro' || p.kind === 'rocket') this.guide(p, dt);
      if (p.kind === 'guided') this.guideEnemy(p, dt);
      if (p.kind === 'rpg' || p.kind === 'shell') p.vel.y -= (p.kind === 'rpg' ? 2.2 : 3) * dt;
      const step = p.vel.length() * dt;
      const dir = _d.copy(p.vel).normalize();
      const from = p.pos.clone();
      let hit = null;
      if (p.owner === 'player') hit = this.raycastAll(from, dir, step);
      else {
        hit = this.world.raycast(from, dir, step, { terrain: true });
        if (hit) hit = { dist: hit.dist, point: hit.point, normal: hit.normal, ent: null, surface: hit.terrain ? 'dirt' : 'wall' };
        const pr = p.kind === 'guided' ? 3.5 : p.kind === 'shell' ? 1.6 : 1.5;
        _a.subVectors(P.pos, from);
        const t = THREE.MathUtils.clamp(_a.dot(dir), 0, step);
        _b.copy(from).addScaledVector(dir, t);
        if (_b.distanceTo(P.pos) < pr && P.mode !== 'dead' && (!hit || t < hit.dist)) hit = { dist: t, point: _b.clone(), normal: dir.clone().negate(), ent: 'player' };
        if (!hit && p.kind === 'guided') {
          for (const f of this.decoys) if (f.pos.distanceTo(p.pos) < 6) { hit = { dist: 0, point: p.pos.clone(), normal: new THREE.Vector3(0, 1, 0), ent: 'decoy' }; break; }
        }
      }
      if (hit) {
        p.pos.copy(hit.point);
        this.impact(p, hit, dir);
        this.kill(i, p, true);
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
      if (p.mesh) {
        p.mesh.position.copy(p.pos);
        p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      }
      // visuals
      if (p.kind === 'repulsor') {
        this.fx.P.emit({ kind: 3, pos: p.pos.clone(), vel: p.vel.clone(), size: 0.16, life: 0.03, color: [6, 8, 10], alpha: 1, stretch: 0.012, fadeIn: 0, drag: 0, wind: 0 });
        this.fx.P.emit({ kind: 2, pos: p.pos.clone(), size: 0.9, life: 0.04, color: [3, 4.5, 7], alpha: 0.8, drag: 0, fadeIn: 0 });
      } else if (p.kind === 'micro' || p.kind === 'rocket' || p.kind === 'rpg' || p.kind === 'guided') {
        p.trail = (p.trail || 0) + dt * (p.kind === 'guided' ? 90 : 70);
        while (p.trail > 1) { p.trail -= 1; this.fx.missileTrail(p.pos.clone().addScaledVector(dir, -0.4), p.vel, p.kind === 'micro' ? 0.6 : p.kind === 'guided' ? 1.6 : 1.1); }
        if (!p.loop && p.kind === 'guided') { p.loop = true; this.audio.loop('rocket_loop', { vol: 0.9, pos: p.pos, ref: 30 }).then(h => { p.sound = h; if (p.dead && h) h.stop(0.1); }); }
        if (p.sound) p.sound.at(p.pos);
      }
    }
  }

  guide(p, dt) {
    let tp = null;
    if (p.target && !p.target.dead) tp = p.target.center(new THREE.Vector3());
    else if (p.target && p.target.dead) tp = p.lastTarget || p.aimPoint;
    else tp = p.aimPoint;
    if (p.target && !p.target.dead) p.lastTarget = tp.clone();
    const boost = p.age < 0.25 ? 0 : 1;
    p.speed = Math.min(p.kind === 'micro' ? 170 : 220, p.speed + (p.kind === 'micro' ? 260 : 300) * dt * boost);
    if (!tp) return;
    const want = _a.subVectors(tp, p.pos);
    const dist = want.length();
    want.normalize();
    if (p.kind === 'micro' && p.age < 0.35) want.y += 0.6;
    const cur = _b.copy(p.vel).normalize();
    const turn = (p.kind === 'micro' ? 7 : 5) * dt * (p.age < 0.2 ? 0.3 : 1);
    cur.lerp(want, Math.min(1, turn + (dist < 20 ? 0.3 : 0))).normalize();
    if (p.kind === 'micro') cur.add(_c.set(Math.sin(p.age * 13 + p.life), Math.cos(p.age * 11), Math.sin(p.age * 9)).multiplyScalar(0.02 * Math.min(1, dist / 40))).normalize();
    p.vel.copy(cur).multiplyScalar(p.speed);
  }

  guideEnemy(p, dt) {
    const P = this.player;
    let tp = P.pos;
    if (p.seeker === 'heat') {
      if (!p.decoyed) {
        for (const f of this.decoys) {
          const toF = _a.subVectors(f.pos, p.pos);
          const toP = _b.subVectors(P.pos, p.pos);
          const df = toF.length(), dp = toP.length();
          const angle = toF.normalize().dot(_c.copy(p.vel).normalize());
          if (angle > 0.55 && df < dp * 1.3 && Math.random() < 0.08 * f.heat) { p.decoyed = f; this.emit('missileDecoyed', { p }); break; }
        }
      }
      if (p.decoyed) tp = p.decoyed.life > 0 ? p.decoyed.pos : p.pos.clone().addScaledVector(p.vel, 1);
    }
    p.speed = Math.min(p.speed, p.speed);
    const sp = Math.min(p.speed, p.vel.length() + 200 * dt);
    const want = _a.subVectors(tp, p.pos);
    const dist = want.length();
    want.normalize();
    // proportional-navigation-ish: lead the target
    if (!p.decoyed && dist > 30) want.addScaledVector(P.vel.clone().normalize(), Math.min(0.6, P.vel.length() / sp * 0.8)).normalize();
    const cur = _b.copy(p.vel).normalize();
    const ang = cur.angleTo(want);
    const maxTurn = p.turn * dt;
    if (ang > 1e-4) cur.lerp(want, Math.min(1, maxTurn / ang)).normalize();
    p.vel.copy(cur).multiplyScalar(sp);
    if (!p.decoyed && cur.dot(_c.subVectors(P.pos, p.pos).normalize()) < -0.2 && dist < 150 && !p.overshot) { p.overshot = true; this.emit('missileEvaded', { p }); p.life = Math.min(p.life, 2.5); }
    if (dist < 2.5 && !p.decoyed) p.life = 0.0001;
  }

  impact(p, hit, dir) {
    const ent = hit.ent;
    if (p.kind === 'repulsor') {
      const body = ent && ent !== 'player' && ent.isHuman;
      this.fx.repulsorImpact(hit.point, hit.normal || dir.clone().negate(), { hitBody: body });
      if (ent && ent.takeHit) {
        this.stats.hits++;
        ent.takeHit({ dmg: p.dmg, impulse: dir.clone().multiplyScalar(11).add(new THREE.Vector3(0, 4, 0)), point: hit.point, source: 'player', weapon: 'repulsor' });
      }
      if (ent && ent.explosiveProp) ent.takeHit({ dmg: 100, source: 'player' });
    } else if (p.kind === 'micro') {
      this.explode(hit.point, { radius: 3.2, dmg: 120, impulse: 14, size: 0.55, kind: 'small', normal: hit.normal, owner: 'player' });
      if (ent && ent.takeHit && !ent.dead) ent.takeHit({ dmg: 60, impulse: dir.clone().multiplyScalar(10), point: hit.point, source: 'player', weapon: 'micro' });
    } else if (p.kind === 'rocket') {
      if (ent && ent.takeHit && !ent.dead) ent.takeHit({ dmg: p.dmg, impulse: dir.clone().multiplyScalar(20), point: hit.point, source: 'player', weapon: 'rocket' });
      this.explode(hit.point, { radius: 8, dmg: 140, impulse: 22, size: 1.6, kind: 'large', normal: hit.normal, owner: 'player' });
    } else if (p.kind === 'rpg') {
      if (ent === 'player') this.player.hit(p.dmg, dir.clone().multiplyScalar(9).add(new THREE.Vector3(0, 3, 0)), 'rpg');
      this.explode(hit.point, { radius: 5, dmg: 80, impulse: 14, size: 0.9, kind: 'medium', normal: hit.normal, owner: 'enemy' });
    } else if (p.kind === 'shell') {
      if (ent === 'player') { this.player.hit(p.dmg, dir.clone().multiplyScalar(26).add(new THREE.Vector3(0, 6, 0)), 'shell'); this.audio.play('armor_hit_heavy', hit.point, { vol: 1.2, noDelay: true }); }
      this.explode(hit.point, { radius: 6, dmg: 100, impulse: 18, size: 1.2, kind: 'medium', normal: hit.normal, owner: 'enemy' });
    } else if (p.kind === 'guided') {
      if (ent === 'player') this.player.hit(p.dmg, dir.clone().multiplyScalar(24).add(new THREE.Vector3(0, 5, 0)), 'missile');
      this.explode(hit.point, { radius: 9, dmg: 60, impulse: 16, size: 1.4, kind: 'medium', normal: hit.normal, owner: 'enemy' });
    }
  }

  kill(i, p, hitSomething) {
    this.projectiles.splice(i, 1);
    p.dead = true;
    if (p.mesh) this.scene.remove(p.mesh);
    if (p.sound) p.sound.stop(0.1);
    if (!hitSomething && (p.kind === 'micro' || p.kind === 'rocket' || p.kind === 'guided')) this.fx.explosion(p.pos, { size: p.kind === 'guided' ? 1 : 0.5, kind: 'small' });
  }
}
