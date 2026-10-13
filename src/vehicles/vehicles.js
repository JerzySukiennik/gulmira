// Ground vehicles and emplacements: driving on roads, turret aiming, weapons, damage and wrecks.
import * as THREE from 'three';
import { later } from '../core/scheduler.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const rnd = (a, b) => a + Math.random() * (b - a);
const UP = new THREE.Vector3(0, 1, 0);

const SPEC = {
  technical: { hp: 120, radius: 3, armor: { repulsor: 0.5, micro: 1, rocket: 1, explosion: 0.7 }, speed: 12 },
  tank: { hp: 150, radius: 4.5, armor: { repulsor: 0.04, micro: 0.25, rocket: 1, explosion: 0.15 }, speed: 7 },
  tel: { hp: 140, radius: 6, armor: { repulsor: 0.35, micro: 0.8, rocket: 1, explosion: 0.5 }, speed: 6 },
  zu23: { hp: 70, radius: 2.2, armor: { repulsor: 1, micro: 1, rocket: 1, explosion: 1 }, speed: 0 },
};

class Vehicle {
  constructor(mgr, type, model, { pos, yaw = 0, path = null, crew = null }) {
    this.mgr = mgr; this.type = type; this.model = model;
    this.spec = SPEC[type];
    this.isVehicle = true; this.dead = false; this.hp = this.spec.hp; this.radius = this.spec.radius;
    this.pos = pos.clone(); this.yaw = yaw; this.speed = 0;
    this.path = path; this.pathI = 0;
    this.state = path ? 'drive' : 'parked';
    this.U = model.userData;
    this.half = this.U.halfExtents ? this.U.halfExtents.clone() : (this.U.size ? this.U.size.clone().multiplyScalar(0.5) : new THREE.Vector3(1, 1, 2));
    this.fireT = rnd(2, 4); this.burst = 0; this.shotT = 0;
    this.turretYaw = 0; this.gunPitch = 0;
    this.crew = crew;
    this.engine = null;
    this.alignQ = new THREE.Quaternion();
    this.lastHitT = -99;
  }
  center(out = new THREE.Vector3()) { return out.copy(this.pos).add(_c.set(0, this.half.y, 0)); }
  raycast(o, d, maxDist) {
    if (this.dead && this.type !== 'tel') return null;
    const inv = _q.copy(this.model.quaternion).invert();
    const lo = _a.subVectors(o, this.model.position).applyQuaternion(inv);
    lo.y -= this.half.y;
    const ld = _b.copy(d).applyQuaternion(inv);
    let tmin = 0, tmax = maxDist, axis = -1, sgn = 1;
    const h = this.half;
    for (let k = 0; k < 3; k++) {
      const oa = k === 0 ? lo.x : k === 1 ? lo.y : lo.z, da = k === 0 ? ld.x : k === 1 ? ld.y : ld.z, ha = (k === 0 ? h.x : k === 1 ? h.y : h.z) * 0.92;
      if (Math.abs(da) < 1e-9) { if (oa < -ha || oa > ha) return null; continue; }
      let t1 = (-ha - oa) / da, t2 = (ha - oa) / da, s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = k; sgn = s; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    if (axis < 0) return null;
    const n = new THREE.Vector3(axis === 0 ? sgn : 0, axis === 1 ? sgn : 0, axis === 2 ? sgn : 0).applyQuaternion(this.model.quaternion);
    return { dist: tmin, point: o.clone().addScaledVector(d, tmin), normal: n };
  }
  takeHit({ dmg = 50, weapon = 'repulsor', explosive = false, source = 'player', point = null }) {
    if (this.dead) return;
    const key = explosive && weapon !== 'rocket' && weapon !== 'micro' ? 'explosion' : weapon;
    const k = this.spec.armor[key] ?? 1;
    this.hp -= dmg * k;
    this.lastHitT = this.mgr.time;
    if (point && !explosive) this.mgr.fx.bulletImpact(point, new THREE.Vector3(0, 1, 0), 'armor');
    if (this.mgr.onEvent) this.mgr.onEvent('vehicleHit', { v: this, weapon, effective: k > 0.2 });
    if (this.hp <= 0) this.destroy(source);
    else if (this.state === 'parked' || this.state === 'drive') this.alert = true;
  }
  destroy(source) {
    if (this.dead) return;
    this.dead = true;
    this.state = 'destroyed';
    const M = this.mgr;
    const c = this.center(new THREE.Vector3());
    M.combat.explode(c, { radius: this.type === 'tank' ? 10 : 9, dmg: 120, impulse: 20, size: this.type === 'zu23' ? 1.2 : 2.2, kind: 'vehicle', owner: source === 'player' ? 'player' : 'enemy' });
    later(0.45, () => M.fx.explosion(c.clone().add(new THREE.Vector3(rnd(-1, 1), 1, rnd(-1, 1))), { size: 1.3, kind: 'vehicle' }));
    if (this.type === 'tank') later(0.9, () => this.cookOff());
    M.fx.addFire(c.clone().add(new THREE.Vector3(0, this.half.y * 0.5, 0)), this.type === 'zu23' ? 0.7 : 1.4, 90, 0.06);
    this.model.traverse(o => { if (o.isMesh) { if (o.material === M.M.glass) o.visible = false; else o.material = M.burnt; } });
    if (this.U.parts) for (const p of this.U.parts) if (Math.random() < 0.6 && p !== this.U.turret) this.fling(p, 1);
    if (this.engine) { this.engine.stop(0.5); this.engine = null; }
    if (this.crew) for (const a of this.crew) if (!a.dead) a.die(new THREE.Vector3(rnd(-6, 6), rnd(6, 10), rnd(-6, 6)), c, source);
    M.combat.stats.vehicles++;
    if (M.onEvent) M.onEvent('vehicleDestroyed', { v: this, source });
    if (this.collider) { M.world.remove(this.collider); }
  }
  cookOff() {
    const T = this.U.turret;
    if (!T) return;
    this.fling(T, 2.2);
    const c = this.center(new THREE.Vector3());
    this.mgr.fx.explosion(c.add(new THREE.Vector3(0, 2, 0)), { size: 2, kind: 'vehicle' });
    for (let i = 0; i < 60; i++) this.mgr.fx.P.emit({ kind: 1, pos: c.clone(), vel: new THREE.Vector3(rnd(-3, 3), rnd(15, 32), rnd(-3, 3)), size: rnd(1, 2), grow: 2, life: rnd(0.6, 1.4), drag: 1.5, buoy: 2, color: [7, 4, 1.5], color2: [1.4, 0.3, 0.05], alpha: 0.9, curve: 1.5 });
  }
  fling(obj, power) {
    const M = this.mgr;
    obj.updateWorldMatrix(true, false);
    const wp = obj.getWorldPosition(new THREE.Vector3()), wq = obj.getWorldQuaternion(new THREE.Quaternion()), ws = obj.getWorldScale(new THREE.Vector3());
    obj.parent.remove(obj);
    obj.position.copy(wp); obj.quaternion.copy(wq); obj.scale.copy(ws);
    M.scene.add(obj);
    M.debris.push({ obj, vel: new THREE.Vector3(rnd(-4, 4), rnd(8, 16) * power, rnd(-4, 4)), spin: new THREE.Vector3(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)).multiplyScalar(power), t: 0 });
  }
}

export class Vehicles {
  constructor({ scene, terrain, world, combat, fx, audio, player, agents, builders, M, atmo }) {
    Object.assign(this, { scene, terrain, world, combat, fx, audio, player, agents, builders, M, atmo });
    this.list = [];
    this.debris = [];
    this.time = 0;
    this.burnt = new THREE.MeshStandardMaterial({ color: '#16130f', roughness: 0.95, metalness: 0.2 });
    atmo.patch(this.burnt, { key: 'burnt' });
    this.onEvent = null;
    this.flak = [];
  }

  spawn(type, pos, opts = {}) {
    const build = { technical: this.builders.buildTechnical, tank: this.builders.buildTank, tel: this.builders.buildTEL, zu23: this.builders.buildZU23 }[type];
    const model = build(this.M);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material && !o.material.userData.gulPatched) this.atmo.patch(o.material, { key: 'vehx' }); } });
    this.scene.add(model);
    const v = new Vehicle(this, type, model, { pos, yaw: opts.yaw || 0, path: opts.path || null, crew: opts.crew || null });
    v.speedMax = opts.speed ?? v.spec.speed;
    v.combatRange = opts.range ?? (type === 'tank' ? 900 : type === 'zu23' ? 1800 : 600);
    v.active = opts.active ?? true;
    this.place(v, 0);
    if (type === 'zu23' || type === 'tel' || opts.static) {
      v.collider = this.world.addBox(v.center(new THREE.Vector3()), v.half.clone(), v.yaw, { kind: 'vehicle' });
    }
    if (opts.gunner) {
      const gp = v.U.gunnerPos ? v.U.gunnerPos.clone() : new THREE.Vector3(0, 1.0, 1.2);
      const a = this.agents.spawn('fighter', 'gunner', v.pos.clone(), { state: 'gunner' });
      a.vehicle = v; a.seat = gp; a.onRoof = true;
      v.crew = [a];
    }
    this.combat.addHitable(v);
    this.list.push(v);
    if ((type === 'technical' || type === 'tank') && this.audio.ready) {
      this.audio.loop(type === 'tank' ? 'tank_engine_loop' : 'truck_engine_loop', { vol: 0.9, pos: v.pos, ref: type === 'tank' ? 18 : 10 }).then(h => { v.engine = h; if (v.dead && h) h.stop(0.1); });
    }
    return v;
  }

  place(v, dt) {
    const T = this.terrain;
    const fwd = _a.set(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
    const right = _b.set(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
    const L = v.half.z * 0.8, W = v.half.x * 0.8;
    const hf = T.heightAt(v.pos.x + fwd.x * L, v.pos.z + fwd.z * L), hb = T.heightAt(v.pos.x - fwd.x * L, v.pos.z - fwd.z * L);
    const hr = T.heightAt(v.pos.x + right.x * W, v.pos.z + right.z * W), hl = T.heightAt(v.pos.x - right.x * W, v.pos.z - right.z * W);
    v.pos.y = (hf + hb + hr + hl) / 4;
    const pitch = Math.atan2(hf - hb, 2 * L), roll = Math.atan2(hr - hl, 2 * W);
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, v.yaw, -roll, 'YXZ'));
    if (dt === 0) v.alignQ.copy(target); else v.alignQ.slerp(target, 1 - Math.exp(-dt * 6));
    v.model.position.copy(v.pos);
    v.model.quaternion.copy(v.alignQ);
  }

  update(dt) {
    this.time += dt;
    const P = this.player;
    for (const v of this.list) {
      if (v.dead) continue;
      if (v.engine) v.engine.at(v.pos);
      // drive along the path
      if (v.active && v.state === 'drive' && v.path && v.pathI < v.path.length) {
        const wp = v.path[v.pathI];
        const dx = wp.x - v.pos.x, dz = wp.z - v.pos.z, d = Math.hypot(dx, dz);
        if (d < 4) v.pathI++;
        else {
          const want = Math.atan2(-dx, -dz);
          let dy = want - v.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
          v.yaw += THREE.MathUtils.clamp(dy, -dt * 0.9, dt * 0.9);
          const slow = 1 - Math.min(0.7, Math.abs(dy));
          v.speed += (v.speedMax * slow - v.speed) * (1 - Math.exp(-dt * 0.8));
        }
        if (v.pathI >= v.path.length) v.state = 'combat';
      } else v.speed *= Math.exp(-dt * 1.5);
      if (v.speed > 0.05) {
        v.pos.x += -Math.sin(v.yaw) * v.speed * dt;
        v.pos.z += -Math.cos(v.yaw) * v.speed * dt;
        if (v.U.wheels) for (const w of v.U.wheels) w.rotation.x -= v.speed * dt / 0.4;
      }
      this.place(v, dt);
      if (v.engine) v.engine.rate(0.8 + Math.min(0.6, v.speed / 15), 0.3);
      // crew follows
      if (v.crew) for (const a of v.crew) {
        if (a.dead || !a.seat) continue;
        const wp = a.seat.clone().applyQuaternion(v.model.quaternion).add(v.model.position);
        a.pos.copy(wp);
      }
      if (v.active && v.type !== 'tel') this.weapons(v, dt);
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const D = this.debris[i];
      D.t += dt;
      D.vel.y -= 9.81 * dt;
      D.obj.position.addScaledVector(D.vel, dt);
      D.obj.rotateX(D.spin.x * dt); D.obj.rotateY(D.spin.y * dt); D.obj.rotateZ(D.spin.z * dt);
      const gy = this.terrain.heightAt(D.obj.position.x, D.obj.position.z) + 0.3;
      if (D.obj.position.y < gy) {
        D.obj.position.y = gy;
        if (D.vel.y < -6) { this.fx.explosion(D.obj.position.clone(), { size: 0.4, kind: 'small', silent: true }); this.audio.play('metal_heavy', D.obj.position, { vol: 0.8 }); }
        D.vel.multiplyScalar(0.35); D.vel.y = Math.abs(D.vel.y) * 0.3; D.spin.multiplyScalar(0.4);
        if (D.vel.length() < 0.5) this.debris.splice(i, 1);
      }
    }
    for (let i = this.flak.length - 1; i >= 0; i--) {
      const f = this.flak[i];
      f.t -= dt;
      if (f.t > 0) continue;
      this.flak.splice(i, 1);
      this.fx.P.emit({ kind: 2, pos: f.pos.clone(), size: 3, life: 0.08, color: [9, 6, 3], alpha: 1, drag: 0, fadeIn: 0 });
      for (let k = 0; k < 6; k++) this.fx.P.emit({ kind: 0, pos: f.pos.clone(), vel: new THREE.Vector3(rnd(-2, 2), rnd(-1, 2), rnd(-2, 2)), size: rnd(1, 1.8), grow: 1.2, life: rnd(3, 6), drag: 1.2, color: [0.08, 0.075, 0.07], alpha: 0.75, lit: 0.6, fadeIn: 0.05 });
      this.audio.play('explosion_small', f.pos, { vol: 0.35, ref: 20 });
      const d = f.pos.distanceTo(P.pos);
      if (d < 9) { P.hit(3.5 * (1 - d / 9) + 0.5, P.pos.clone().sub(f.pos).normalize().multiplyScalar(3), 'flak'); this.fx.shake(f.pos, 0.3, 30); }
    }
  }

  aimTurret(v, target, dt, rate = 1.2) {
    const T = v.U.turret, G = v.U.gun;
    if (!T) return 1;
    v.model.updateMatrixWorld(true);
    const local = T.parent.worldToLocal(target.clone());
    const yaw = Math.atan2(-(local.x - T.position.x), -(local.z - T.position.z));
    let dy = yaw - T.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    T.rotation.y += THREE.MathUtils.clamp(dy, -rate * dt, rate * dt);
    let err = Math.abs(dy);
    if (G) {
      T.updateMatrixWorld(true);
      const gl = T.worldToLocal(target.clone()).sub(G.position);
      const pitch = Math.atan2(gl.y, Math.hypot(gl.x, gl.z));
      const lim = v.type === 'zu23' ? [-0.1, 1.5] : v.type === 'technical' ? [-0.3, 1.2] : [-0.1, 0.32];
      const pc = THREE.MathUtils.clamp(pitch, lim[0], lim[1]);
      G.rotation.x += THREE.MathUtils.clamp(pc - G.rotation.x, -rate * dt, rate * dt);
      err += Math.abs(pc - G.rotation.x);
    }
    return err;
  }

  muzzle(v, i = 0) {
    const G = v.U.gun || v.model;
    const m = v.U.muzzles && v.U.muzzles[i] ? v.U.muzzles[i].clone() : new THREE.Vector3(0, 1, -3);
    G.updateMatrixWorld(true);
    return G.localToWorld(m);
  }

  weapons(v, dt) {
    const P = this.player;
    const d = v.pos.distanceTo(P.pos);
    if (d > v.combatRange || P.mode === 'dead') return;
    const gunnerOK = !v.crew || v.crew.some(a => !a.dead);
    if (!gunnerOK) return;
    const lead = P.vel.clone().multiplyScalar(d / (v.type === 'tank' ? 900 : 700));
    const target = P.pos.clone().add(lead);
    const err = this.aimTurret(v, target, dt, v.type === 'tank' ? 0.45 : v.type === 'zu23' ? 1.4 : 1.6);
    const mz = this.muzzle(v);
    const dir = target.clone().sub(mz).normalize();
    const blocked = this.world.raycast(mz, dir, Math.max(1, mz.distanceTo(P.pos) - 3), { terrain: true });
    if (blocked) return;
    v.fireT -= dt;
    if (v.type === 'tank') {
      if (v.fireT <= 0 && err < 0.05) {
        v.fireT = rnd(6, 9);
        this.combat.enemyShell(mz, dir.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(0.004 + P.vel.length() * 0.0003)).normalize(), v);
        this.fx.explosion(mz.clone().addScaledVector(dir, 1.5), { size: 0.7, kind: 'small', silent: true });
        this.audio.play('tank_cannon', mz, { vol: 1.3, ref: 25 });
        if (v.U.gun) v.U.gun.position.z += 0.4;
        if (this.onEvent) this.onEvent('tankFired', { v });
      }
      if (v.U.gun) v.U.gun.position.z *= Math.exp(-dt * 3);
      return;
    }
    if (v.type === 'technical') {
      if (v.burst <= 0 && v.fireT <= 0 && err < 0.12) { v.burst = Math.floor(rnd(6, 14)); v.fireT = rnd(1.2, 2.8); this.audio.play('hmg_burst', mz, { vol: 1, ref: 14 }); }
      if (v.burst > 0) {
        v.shotT -= dt;
        if (v.shotT <= 0) {
          v.shotT = 0.11; v.burst--;
          this.combat.enemyBullet(mz, dir, { dmg: 1.4, spread: 0.014 + d * 0.00005 + P.vel.length() * 0.001, tracer: Math.random() < 0.5, kind: 'hmg' });
          this.fx.muzzleFlash(mz, dir, 1.8);
        }
      }
      return;
    }
    if (v.type === 'zu23') {
      if (v.burst <= 0 && v.fireT <= 0 && err < 0.15 && P.agl > 20) { v.burst = Math.floor(rnd(10, 22)); v.fireT = rnd(1.5, 3.5); this.audio.play('aa_gun_burst', mz, { vol: 1.1, ref: 25 }); }
      if (v.burst > 0) {
        v.shotT -= dt;
        if (v.shotT <= 0) {
          v.shotT = 0.06; v.burst--;
          const i = v.burst % 2;
          const m2 = this.muzzle(v, i);
          const spread = 0.02 + P.vel.length() * 0.00012;
          const dd = dir.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(spread)).normalize();
          this.fx.tracer(m2, dd, 950, [9, 4, 1.5]);
          this.fx.muzzleFlash(m2, dd, 1.5);
          const t = d / 950;
          const burstPos = m2.clone().addScaledVector(dd, d + rnd(-25, 25));
          this.flak.push({ pos: burstPos, t });
        }
      }
    }
  }

  // TEL launch sequence: raise the erector, ignite, fly the missile; returns the missile hitable
  launch(v, { onLaunched, onEscaped, flightTime = 32 } = {}) {
    const E = v.U.erector, Ms = v.U.missile;
    if (!E || !Ms || v.dead) return null;
    v.launching = true;
    const sign = v.U.erectorSign || -1;
    const st = { t: 0, phase: 'raise', missile: null };
    const tick = (dt) => {
      if (v.dead && st.phase === 'raise') { st.phase = 'aborted'; return true; }
      st.t += dt;
      if (st.phase === 'raise') {
        E.rotation.x = sign * Math.min(Math.PI / 2, st.t / 9 * Math.PI / 2);
        if (st.t > 10.5) {
          st.phase = 'fly';
          v.model.updateMatrixWorld(true);
          const wp = Ms.getWorldPosition(new THREE.Vector3()), wq = Ms.getWorldQuaternion(new THREE.Quaternion());
          Ms.parent.remove(Ms);
          Ms.position.copy(wp); Ms.quaternion.copy(wq);
          this.scene.add(Ms);
          const mis = {
            isVehicle: false, dead: false, radius: 6, hp: 40, obj: Ms, vel: new THREE.Vector3(0, 2, 0), t: 0,
            center: (o = new THREE.Vector3()) => o.copy(Ms.position),
            raycast: (o, d, maxDist) => {
              _a.subVectors(Ms.position, o);
              const t = _a.dot(d);
              if (t < 0 || t > maxDist) return null;
              const p = o.clone().addScaledVector(d, t);
              const dd = p.distanceTo(Ms.position);
              return dd < 5.5 ? { dist: t, point: p, normal: d.clone().negate() } : null;
            },
            takeHit: ({ dmg = 50 }) => { mis.hp -= dmg; if (mis.hp <= 0 && !mis.dead) { mis.dead = true; this.combat.explode(Ms.position.clone(), { radius: 25, dmg: 200, size: 3.2, kind: 'vehicle', owner: 'player' }); this.scene.remove(Ms); if (st.sound) st.sound.stop(0.2); if (this.onEvent) this.onEvent('missileIntercepted', { v }); } },
          };
          st.missile = mis;
          this.combat.addHitable(mis);
          this.fx.explosion(v.pos.clone().add(new THREE.Vector3(0, 1, 0)), { size: 1.5, kind: 'large', silent: true });
          this.audio.play('rpg_launch', wp, { vol: 1.5, rate: 0.5, ref: 60 });
          this.audio.loop('rocket_loop', { vol: 1.6, pos: wp, ref: 80, rate: 0.6 }).then(h => { st.sound = h; if (mis.dead && h) h.stop(0.1); });
          if (onLaunched) onLaunched(mis);
        }
      } else if (st.phase === 'fly') {
        const mis = st.missile;
        if (mis.dead) return true;
        mis.t += dt;
        const acc = Math.min(45, 10 + mis.t * 6);
        const pitchOver = THREE.MathUtils.smoothstep(mis.t, 6, 18);
        const dir = new THREE.Vector3(0.55 * pitchOver, 1 - pitchOver * 0.55, -0.6 * pitchOver).normalize();
        mis.vel.addScaledVector(dir, acc * dt);
        Ms.position.addScaledVector(mis.vel, dt);
        Ms.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), mis.vel.clone().normalize());
        if (st.sound) st.sound.at(Ms.position);
        const back = mis.vel.clone().normalize().multiplyScalar(-6);
        for (let k = 0; k < 3; k++) this.fx.missileTrail(Ms.position.clone().add(back), mis.vel, 3.2);
        this.fx.P.emit({ kind: 2, pos: Ms.position.clone().add(back), size: 9, life: 0.06, color: [9, 7, 4], alpha: 1, drag: 0, fadeIn: 0 });
        if (mis.t > flightTime) { mis.dead = true; this.scene.remove(Ms); if (st.sound) st.sound.stop(1); if (onEscaped) onEscaped(); return true; }
      }
      return st.phase === 'aborted';
    };
    return { st, tick };
  }
}
