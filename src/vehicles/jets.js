// F-22 pair: pursuit geometry, g-limited turns, terrain floor, missile shots from the rear hemisphere, extend and re-attack.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);

export class Jets {
  constructor({ scene, terrain, combat, fx, audio, player, builders, M }) {
    Object.assign(this, { scene, terrain, combat, fx, audio, player, builders, M });
    this.list = [];
    this.onEvent = null;
    this.time = 0;
    this.missilesFired = 0;
    this.allowFire = true;
  }

  spawn(pos, vel, name) {
    const model = this.builders.buildF22(this.M);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(model);
    const j = {
      name, model, pos: pos.clone(), vel: vel.clone(), state: 'approach', fireT: rnd(4, 8), extendT: 0, missiles: 6,
      U: model.userData, dead: false, isVehicle: false, radius: 9, bank: 0, flybyCool: 0, sound: null,
      center: (o = new THREE.Vector3()) => o.copy(j.pos),
      raycast: (o, d, maxDist) => {
        _a.subVectors(j.pos, o);
        const t = _a.dot(d);
        if (t < 0 || t > maxDist) return null;
        const p = o.clone().addScaledVector(d, t);
        return p.distanceTo(j.pos) < 5 ? { dist: t, point: p, normal: d.clone().negate() } : null;
      },
      takeHit: () => { if (this.onEvent) this.onEvent('jetHit', { j }); },
    };
    this.combat.addHitable(j);
    this.list.push(j);
    if (this.audio.ready) this.audio.loop('jet_engine_loop', { vol: 1.4, pos: j.pos, ref: 140 }).then(h => { j.sound = h; });
    return j;
  }

  remove(j) {
    this.scene.remove(j.model);
    if (j.sound) j.sound.stop(1);
    const i = this.combat.hitables.indexOf(j);
    if (i >= 0) this.combat.hitables.splice(i, 1);
    this.list.splice(this.list.indexOf(j), 1);
  }

  update(dt) {
    this.time += dt;
    const P = this.player;
    for (const j of this.list.slice()) {
      const speed = j.vel.length();
      const toP = _a.subVectors(P.pos, j.pos);
      const dist = toP.length();
      let want;
      if (j.state === 'approach' || j.state === 'attack') {
        const tLead = Math.min(4, dist / Math.max(speed, 1));
        want = _b.copy(P.pos).addScaledVector(P.vel, tLead * 0.8).sub(j.pos).normalize();
        if (dist < 3500) j.state = 'attack';
        if (j.state === 'attack' && dist < 600) { j.state = 'extend'; j.extendT = rnd(6, 9); j.extendDir = j.vel.clone().normalize().add(new THREE.Vector3(rnd(-0.5, 0.5), 0.15, rnd(-0.5, 0.5))).normalize(); }
      } else if (j.state === 'extend') {
        j.extendT -= dt;
        want = _b.copy(j.extendDir);
        if (j.extendT <= 0) j.state = 'attack';
      } else if (j.state === 'egress') {
        want = _b.copy(j.egressDir);
        if (dist > 12000) { this.remove(j); continue; }
      }
      // terrain floor
      const ground = this.terrain.heightAt(j.pos.x + j.vel.x * 3, j.pos.z + j.vel.z * 3);
      const floor = ground + 160;
      if (j.pos.y < floor + 200) want.y = Math.max(want.y, (floor + 200 - j.pos.y) / 300);
      want.normalize();
      const cur = _c.copy(j.vel).normalize();
      const maxW = 72 / Math.max(speed, 60);
      const ang = cur.angleTo(want);
      const prev = cur.clone();
      if (ang > 1e-4) cur.lerp(want, Math.min(1, maxW * dt / ang)).normalize();
      const targetSpeed = j.state === 'extend' || j.state === 'egress' ? 330 : dist < 2000 ? 250 : 300;
      const ns = speed + THREE.MathUtils.clamp(targetSpeed - speed, -30 * dt, 30 * dt);
      j.vel.copy(cur).multiplyScalar(ns);
      j.pos.addScaledVector(j.vel, dt);
      // orientation with bank into the turn
      const lat = new THREE.Vector3().subVectors(cur, prev).divideScalar(Math.max(dt, 1e-4));
      const right = new THREE.Vector3().crossVectors(cur, new THREE.Vector3(0, 1, 0)).normalize();
      const bankWant = THREE.MathUtils.clamp(lat.dot(right) * 1.3, -1.3, 1.3);
      j.bank += (bankWant - j.bank) * (1 - Math.exp(-dt * 3));
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), cur, new THREE.Vector3(0, 1, 0));
      j.model.quaternion.setFromRotationMatrix(m);
      j.model.rotateZ(-j.bank);
      j.model.position.copy(j.pos);
      j.model.updateMatrixWorld(true);
      if (j.sound) { j.sound.at(j.pos); j.sound.rate(0.9 + ns / 1200, 0.3); }
      // afterburner glow
      if (j.U.nozzles) for (const nz of j.U.nozzles) {
        const wp = j.model.localToWorld(nz.clone());
        this.fx.P.emit({ kind: 2, pos: wp, size: ns > 300 ? 3.2 : 1.8, life: 0.05, color: ns > 300 ? [9, 5, 2.5] : [6, 3.5, 2], alpha: 0.9, drag: 0, fadeIn: 0 });
      }
      // flyby
      j.flybyCool -= dt;
      if (dist < 450 && j.flybyCool <= 0) { j.flybyCool = 6; this.audio.play('jet_flyby', j.pos, { vol: 1.6, ref: 120 }); if (this.onEvent) this.onEvent('flyby', { j }); }
      // missiles
      j.fireT -= dt;
      if (this.allowFire && j.state === 'attack' && j.missiles > 0 && j.fireT <= 0 && dist > 900 && dist < 4200) {
        const aspect = cur.dot(toP.clone().normalize());
        if (aspect > 0.88) {
          j.fireT = rnd(6.5, 10);
          j.missiles--;
          this.missilesFired++;
          const from = j.pos.clone().addScaledVector(cur, 4).add(new THREE.Vector3(0, -1.2, 0));
          const p = this.combat.enemyMissile(from, P, { speed: 560, turn: 2.2 + Math.random() * 0.6, dmg: 32 });
          p.vel.copy(j.vel).addScaledVector(cur, 40);
          this.audio.play('rpg_launch', from, { vol: 1.3, rate: 0.75, ref: 80 });
          if (this.onEvent) this.onEvent('jetFired', { j, p });
        }
      }
    }
  }

  egressAll() {
    for (const j of this.list) { j.state = 'egress'; j.egressDir = new THREE.Vector3(-0.7, 0.25, 0.65).normalize(); }
  }
}
