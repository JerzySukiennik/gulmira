// Fighters and civilians: navigation, perception, cover, firing, fleeing, hostages, hit-testing and deaths.
import * as THREE from 'three';
import { later } from '../core/scheduler.js';
import { buildHumanGeometry, makeHumanMaterial, buildAK, buildRPG, PALETTES } from './humanModel.js';
import { Human } from './human.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ------------------------------------------------------------------ navigation grid
class NavGrid {
  constructor(world, center, half, cell = 1.0) {
    this.cell = cell; this.half = half; this.cx = center.x; this.cz = center.z;
    this.n = Math.ceil(half * 2 / cell);
    this.block = new Uint8Array(this.n * this.n);
    for (const c of world.colliders) {
      if (c.type !== 'box' || c.data.kind === 'roof') continue;
      const ext = Math.hypot(c.half.x, c.half.z) + 0.6;
      const i0 = this.idx(c.center.x - ext, 0), i1 = this.idx(c.center.x + ext, 0);
      const j0 = this.jdx(c.center.z - ext), j1 = this.jdx(c.center.z + ext);
      for (let j = Math.max(0, j0); j <= Math.min(this.n - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.n - 1, i1); i++) {
        const x = this.cx - half + (i + 0.5) * cell, z = this.cz - half + (j + 0.5) * cell;
        const dx = x - c.center.x, dz = z - c.center.z;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) < c.half.x + 0.38 && Math.abs(lz) < c.half.z + 0.38) this.block[j * this.n + i] = 1;
      }
    }
    this.g = new Float32Array(this.n * this.n);
    this.came = new Int32Array(this.n * this.n);
    this.stamp = new Uint32Array(this.n * this.n);
    this.closed = new Uint32Array(this.n * this.n);
    this.run = 0;
  }
  idx(x) { return Math.floor((x - this.cx + this.half) / this.cell); }
  jdx(z) { return Math.floor((z - this.cz + this.half) / this.cell); }
  free(i, j) { return i >= 0 && j >= 0 && i < this.n && j < this.n && !this.block[j * this.n + i]; }
  freeAt(x, z) { return this.free(this.idx(x), this.jdx(z)); }
  nearestFree(i, j) {
    if (this.free(i, j)) return [i, j];
    for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (this.free(i + di, j + dj)) return [i + di, j + dj];
    return null;
  }
  los(i0, j0, i1, j1) {
    const n = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0));
    for (let k = 1; k < n; k++) { const i = Math.round(i0 + (i1 - i0) * k / n), j = Math.round(j0 + (j1 - j0) * k / n); if (!this.free(i, j)) return false; }
    return true;
  }
  path(from, to, maxExp = 25000) {
    const s = this.nearestFree(this.idx(from.x), this.jdx(from.z)), t = this.nearestFree(this.idx(to.x), this.jdx(to.z));
    if (!s || !t) return null;
    const n = this.n, run = ++this.run;
    const start = s[1] * n + s[0], goal = t[1] * n + t[0];
    const heap = [];
    const push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const h = (k) => { const i = k % n, j = (k / n) | 0; const dx = Math.abs(i - t[0]), dz = Math.abs(j - t[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    this.g[start] = 0; this.stamp[start] = run; this.came[start] = -1;
    push(start, h(start));
    let exp = 0, found = false;
    while (heap.length && exp++ < maxExp) {
      const [, k] = pop();
      if (this.closed[k] === run) continue;
      this.closed[k] = run;
      if (k === goal) { found = true; break; }
      const i = k % n, j = (k / n) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (!this.free(ni, nj)) continue;
        if (di && dj && (!this.free(i + di, j) || !this.free(i, j + dj))) continue;
        const nk = nj * n + ni;
        const ng = this.g[k] + (di && dj ? 1.414 : 1);
        if (this.stamp[nk] !== run || ng < this.g[nk]) { this.stamp[nk] = run; this.g[nk] = ng; this.came[nk] = k; push(nk, ng + h(nk)); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = goal; k !== -1; k = this.came[k]) cells.push(k);
    cells.reverse();
    const pts = [];
    let anchor = 0;
    pts.push(cells[0]);
    for (let q = 2; q < cells.length; q++) {
      const a = cells[anchor], b = cells[q];
      if (!this.los(a % n, (a / n) | 0, b % n, (b / n) | 0)) { anchor = q - 1; pts.push(cells[anchor]); }
    }
    pts.push(cells[cells.length - 1]);
    return pts.map(k => new THREE.Vector3(this.cx - this.half + ((k % n) + 0.5) * this.cell, 0, this.cz - this.half + (((k / n) | 0) + 0.5) * this.cell));
  }
}

// ------------------------------------------------------------------ agent
class Agent {
  constructor(mgr, human, { kind, role, pos, yaw = 0 }) {
    this.mgr = mgr; this.h = human; this.kind = kind; this.role = role;
    this.pos = pos.clone(); this.yaw = yaw; this.vel = new THREE.Vector3();
    this.isHuman = true;
    this.dead = false; this.hp = 100; this.radius = 0.5;
    this.state = 'idle'; this.path = null; this.pathI = 0; this.goal = null;
    this.think = rnd(0, 0.5);
    this.burst = 0; this.fireT = rnd(0.5, 2); this.aimW = 0; this.reactT = rnd(0.4, 1.3);
    this.coverT = rnd(6, 14);
    this.mode = 'idle'; this.speed = 0; this.crouch = false;
    this.lookDir = new THREE.Vector3(0, 0, -1);
    this.seen = false; this.onRoof = false;
    this.id = Agent.next = (Agent.next || 0) + 1;
  }
  center(out = new THREE.Vector3()) {
    if (this.h.rag) return out.copy(this.h.rag.P.chest.p);
    return out.set(this.pos.x, this.pos.y + (this.mode === 'kneel' ? 0.8 : this.mode === 'cower' ? 0.6 : 1.25), this.pos.z);
  }
  raycast(o, d, maxDist) {
    if (this.dead) return null;
    // capsule from feet+0.3 to head
    const top = this.mode === 'kneel' ? 1.2 : this.mode === 'cower' ? 0.9 : 1.75;
    const a = _a.set(this.pos.x, this.pos.y + 0.25, this.pos.z), b = _b.set(this.pos.x, this.pos.y + top, this.pos.z);
    const r = 0.27;
    // closest approach between ray and segment
    const u = d, v = _c.subVectors(b, a), w = new THREE.Vector3().subVectors(o, a);
    const uu = 1, uv = u.dot(v), vv = v.dot(v), uw = u.dot(w), vw = v.dot(w);
    const den = uu * vv - uv * uv;
    let s = den > 1e-8 ? (uv * vw - vv * uw) / den : 0;
    let t = den > 1e-8 ? (uu * vw - uv * uw) / den : 0;
    t = THREE.MathUtils.clamp(t, 0, 1);
    s = (uv * t - uw) / uu;
    if (s < 0 || s > maxDist) return null;
    const pr = o.clone().addScaledVector(d, s), ps = a.clone().addScaledVector(v, t);
    const dist = pr.distanceTo(ps);
    if (dist > r) return null;
    const back = Math.sqrt(r * r - dist * dist);
    const hitS = Math.max(0, s - back);
    const point = o.clone().addScaledVector(d, hitS);
    return { dist: hitS, point, normal: point.clone().sub(ps).normalize() };
  }
  takeHit({ dmg = 100, impulse = null, point = null, source = 'player', explosive = false }) {
    if (this.dead) return;
    this.hp -= dmg;
    if (this.hp > 0) { this.mgr.alarm(this.pos); return; }
    this.die(impulse || new THREE.Vector3(0, 2, 0), point, source);
  }
  die(impulse, point, source) {
    this.dead = true;
    this.state = 'dead';
    this.h.startRagdoll(impulse, point);
    this.mgr.onDeath(this, source);
  }
}

export class Agents {
  constructor({ scene, atmo, terrain, world, village, combat, fx, audio, player }) {
    Object.assign(this, { scene, atmo, terrain, world, village, combat, fx, audio, player });
    this.all = []; this.fighters = []; this.civilians = [];
    this.alerted = false;
    this.alarmPos = new THREE.Vector3();
    this.geoCache = new Map();
    const mk = (c, r = 0.6, m = 0) => { const x = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }); atmo.patch(x, { key: 'wpn' }); return x; };
    this.wmats = { gunmetal: mk('#1e1f22', 0.45, 0.8), wood: mk('#5e331b', 0.6), olive: mk('#4a5236', 0.7) };
    this.nav = new NavGrid(world, village.center, 420, 1.0);
    this.onEvent = null;
    this.time = 0;
    this.counts = { fighters: 0, fightersDead: 0, civilians: 0, civiliansDead: 0 };
  }

  geo(key, opts) {
    if (!this.geoCache.has(key)) this.geoCache.set(key, buildHumanGeometry(opts));
    return this.geoCache.get(key);
  }

  makeHuman(kind, role, opts = {}) {
    const fighter = kind === 'fighter';
    const burqa = !fighter && opts.burqa;
    const head = burqa ? 'none' : fighter ? pick(['turban', 'turban', 'shemagh', 'pakol', 'shemagh']) : pick(['turban', 'pakol', 'cap', 'turban', 'none']);
    const vest = !burqa && (fighter ? Math.random() < 0.8 : Math.random() < 0.4);
    const gear = fighter && Math.random() < 0.75;
    const key = [burqa, head, vest, gear].join('|');
    const geo = this.geo(key, { burqa, headwear: head, vest, gear, beard: burqa ? 0 : 1, build: 1 });
    const cloth = pick(PALETTES.cloth);
    const pal = [pick(PALETTES.skin), cloth, Math.random() < 0.6 ? cloth : pick(PALETTES.cloth), pick(PALETTES.vest), pick(PALETTES.head), pick(PALETTES.hair), '#2c2620', fighter ? '#30312a' : '#3a3026', pick(PALETTES.burqa), '#0a0a0a'];
    if (fighter && Math.random() < 0.5) { pal[1] = pick(['#4f4b44', '#3b3c3a', '#56604f', '#5d5446', '#6f6a5f']); pal[2] = pal[1]; }
    const mat = makeHumanMaterial(this.atmo, pal);
    const weapon = role === 'rpg' ? buildRPG(this.wmats) : fighter ? buildAK(this.wmats) : null;
    return new Human({ geometry: geo, material: mat, weapon, kind: role === 'rpg' ? 'rpg' : kind, scale: 0.96 + Math.random() * 0.08 });
  }

  spawn(kind, role, pos, opts = {}) {
    const h = this.makeHuman(kind, role, opts);
    const a = new Agent(this, h, { kind, role, pos, yaw: opts.yaw ?? Math.random() * 6.28 });
    a.state = opts.state || 'idle';
    a.onRoof = !!opts.roof;
    a.home = pos.clone();
    a.patrol = opts.patrol || null;
    if (a.state === 'hostage') { a.mode = 'kneel'; }
    h.root.position.copy(pos);
    h.root.rotation.y = a.yaw;
    this.scene.add(h.root);
    h.onStep = null;
    this.all.push(a);
    (kind === 'fighter' ? this.fighters : this.civilians).push(a);
    if (kind === 'fighter') this.counts.fighters++; else this.counts.civilians++;
    this.combat.addHitable(a);
    return a;
  }

  alarm(pos) {
    if (!this.alerted) { this.alerted = true; if (this.onEvent) this.onEvent('alarm', { pos }); }
    this.alarmPos.copy(pos);
  }

  onDeath(a, source) {
    if (a.kind === 'fighter') { this.counts.fightersDead++; if (source === 'player') this.combat.stats.kills++; }
    else { this.counts.civiliansDead++; if (source === 'player') this.combat.stats.civilians++; }
    this.alarm(a.pos);
    if (this.onEvent) this.onEvent('death', { agent: a, source });
  }

  hostiles() { return this.fighters.filter(a => !a.dead); }
  liveCivilians() { return this.civilians.filter(a => !a.dead && !a.gone); }

  groundAt(x, z, y) { return this.world.groundAt(x, z, y); }

  canSee(a, target) {
    const eye = _a.set(a.pos.x, a.pos.y + 1.6, a.pos.z);
    const dir = _b.subVectors(target, eye);
    const len = dir.length();
    if (len > 520) return false;
    dir.divideScalar(len);
    return !this.world.raycast(eye, dir, len - 1.2, { terrain: true });
  }

  setPath(a, goal) {
    a.goal = goal.clone();
    a.path = this.nav.path(a.pos, goal);
    a.pathI = 1;
    if (!a.path) { a.path = [a.pos.clone(), goal.clone()]; }
  }

  findCover(a, threat) {
    const pts = this.village.points.cover;
    let best = null, bestS = 1e9;
    for (let k = 0; k < 40; k++) {
      const c = pts[Math.floor(Math.random() * pts.length)];
      const d = c.pos.distanceTo(a.pos);
      if (d > 45 || d < 3) continue;
      const toT = _a.subVectors(threat, c.pos).normalize();
      const facing = -c.normal.dot(toT);
      const dt = c.pos.distanceTo(threat);
      const s = d * 0.6 - facing * 18 + (dt < 25 ? 40 : 0) + Math.abs(dt - 70) * 0.15;
      if (s < bestS) { bestS = s; best = c; }
    }
    return best ? best.pos : null;
  }

  update(dt) {
    this.time += dt;
    const P = this.player;
    const ppos = P.pos;
    const listener = this.audio.listenerPos;
    for (const a of this.all) {
      const h = a.h;
      if (a.gone) continue;
      const shown = a.pos.distanceTo(listener) < 1100;
      if (h.root.visible !== shown) { h.root.visible = shown; h.root.matrixWorldAutoUpdate = shown; }
      const d2p = a.pos.distanceTo(ppos);
      if (a.dead) {
        if (h.rag && h.rag.sleep < 3 && a.pos.distanceTo(listener) < 600) h.updateRagdoll(dt, (x, z) => this.terrain.heightAt(x, z), this.world);
        continue;
      }
      const far = a.pos.distanceTo(listener) > 700;
      a.think -= dt;
      if (a.think <= 0) { a.think = rnd(0.25, 0.6); this.decide(a, d2p); }
      this.move(a, dt);
      if (a.kind === 'fighter') this.fight(a, dt, d2p);
      if (!far) {
        h.root.position.copy(a.pos);
        h.root.rotation.y = a.yaw;
        h.update(dt, { mode: a.mode, speed: a.speed, aimDir: a.lookDir, aimWeight: a.aimW, crouch: a.crouch });
      }
    }
    // separation
    for (let i = 0; i < this.all.length; i++) {
      const a = this.all[i];
      if (a.dead || a.gone || a.mode === 'kneel') continue;
      for (let j = i + 1; j < this.all.length; j++) {
        const b = this.all[j];
        if (b.dead || b.gone) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
        if (d2 < 0.36 && d2 > 1e-6) { const d = Math.sqrt(d2), k = (0.6 - d) / d * 0.5; a.pos.x -= dx * k; a.pos.z -= dz * k; if (b.mode !== 'kneel') { b.pos.x += dx * k; b.pos.z += dz * k; } }
      }
    }
  }

  decide(a, d2p) {
    const P = this.player;
    const ppos = P.pos;
    if (a.kind === 'civilian') {
      if (a.state === 'hostage') {
        const guards = this.fighters.filter(f => !f.dead && f.role === 'guard' && f.pos.distanceTo(a.pos) < 30).length;
        if (this.alerted && guards === 0 && (this.time - (a.freeT ?? (a.freeT = this.time))) > rnd(1.5, 4)) { a.state = 'flee'; this.civFlee(a); }
        return;
      }
      if (a.state === 'idle' || a.state === 'walk') {
        if (this.alerted && (a.pos.distanceTo(this.alarmPos) < 120 || d2p < 80)) { a.state = 'flee'; this.civFlee(a); return; }
        if (a.state === 'walk' && (!a.path || a.pathI >= a.path.length)) {
          const pts = this.village.points.streets;
          this.setPath(a, pick(pts));
        }
        return;
      }
      if (a.state === 'flee') {
        if (!a.path || a.pathI >= a.path.length) {
          if (a.target && a.target.distanceTo(a.pos) < 2.5) { a.gone = true; a.h.root.visible = false; this.combat.hitables.splice(this.combat.hitables.indexOf(a), 1); return; }
          a.state = 'cower'; a.speed = 0; a.cowerT = rnd(6, 12);
        }
        return;
      }
      if (a.state === 'cower') { a.cowerT -= 0.4; if (a.cowerT <= 0 && d2p > 25) { a.state = 'flee'; this.civFlee(a); } return; }
      return;
    }
    // fighters
    if (a.state === 'gunner') return;
    if (!this.alerted) {
      if (d2p < 220 && this.canSee(a, ppos)) a.seen = true;
      if (a.seen) this.alarm(ppos);
      return;
    }
    a.hasLOS = d2p < 480 && this.canSee(a, P.pos);
    if (a.state === 'idle' || a.state === 'guard' || a.state === 'patrol') a.state = 'engage';
    if (a.state === 'engage') {
      a.coverT -= 0.4;
      const closeIn = d2p < 10 && P.mode !== 'flight';
      if (closeIn && Math.random() < 0.35 && !a.onRoof) {
        a.state = 'move';
        const away = _a.subVectors(a.pos, ppos).setY(0).normalize();
        this.setPath(a, a.pos.clone().addScaledVector(away, rnd(18, 35)));
        a.run = true;
        return;
      }
      if (!a.onRoof && (a.coverT <= 0 || (!a.hasLOS && Math.random() < 0.25))) {
        const c = this.findCover(a, ppos);
        if (c) { a.state = 'move'; this.setPath(a, c); a.run = true; a.coverT = rnd(7, 16); }
      }
    } else if (a.state === 'move') {
      if (!a.path || a.pathI >= a.path.length) a.state = 'engage';
    }
  }

  civFlee(a) {
    const P = this.player;
    const doors = this.village.points.doors;
    let best = null, bestS = 1e9;
    for (let k = 0; k < 30; k++) {
      const d = pick(doors);
      const dist = d.pos.distanceTo(a.pos);
      if (dist > 70) continue;
      const away = d.pos.distanceTo(P.pos) - a.pos.distanceTo(P.pos);
      const s = dist - away * 0.7;
      if (s < bestS) { bestS = s; best = d.pos; }
    }
    if (!best) best = a.pos.clone().add(_a.subVectors(a.pos, P.pos).setY(0).normalize().multiplyScalar(40));
    a.target = best.clone();
    this.setPath(a, best);
    a.run = true;
    a.mode = 'flee';
  }

  move(a, dt) {
    let moving = false;
    if (a.path && a.pathI < a.path.length && (a.state === 'move' || a.state === 'flee' || a.state === 'walk')) {
      const wp = a.path[a.pathI];
      const dx = wp.x - a.pos.x, dz = wp.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) a.pathI++;
      else {
        const sp = a.state === 'walk' ? 1.3 : a.kind === 'civilian' ? 3.8 : 4.4;
        a.speed += (sp - a.speed) * (1 - Math.exp(-dt * 6));
        a.pos.x += dx / d * a.speed * dt;
        a.pos.z += dz / d * a.speed * dt;
        const want = Math.atan2(-dx, -dz);
        let dy = want - a.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        a.yaw += dy * (1 - Math.exp(-dt * 8));
        moving = true;
      }
    }
    if (!moving) a.speed *= Math.exp(-dt * 8);
    if (!a.onRoof) a.pos.y = this.terrain.heightAt(a.pos.x, a.pos.z);
    if (a.kind === 'civilian') {
      a.mode = a.state === 'hostage' ? 'kneel' : a.state === 'cower' ? (a.h.mesh.geometry === this.geoCache.get('true|none|false|false') ? 'kneel' : 'cower') : moving ? (a.state === 'walk' ? 'walk' : 'flee') : 'idle';
    }
  }

  fight(a, dt, d2p) {
    const P = this.player;
    if (!this.alerted) {
      // guards point rifles at hostages
      if (a.role === 'guard') {
        const t = this.civilians.find(c => c.state === 'hostage' && !c.dead && c.pos.distanceTo(a.pos) < 12);
        if (t) { a.lookDir.copy(t.center(_a)).sub(a.pos).setY(-0.6).normalize(); a.aimW += (1 - a.aimW) * dt * 3; }
        a.mode = 'idle';
      } else { a.aimW *= Math.exp(-dt * 3); a.mode = a.speed > 0.2 ? 'walk' : 'idle'; }
      return;
    }
    const target = _a.copy(P.pos);
    const toP = _b.subVectors(target, _c.set(a.pos.x, a.pos.y + 1.5, a.pos.z));
    const dist = toP.length();
    toP.divideScalar(dist);
    a.lookDir.copy(toP);
    const moving = a.speed > 0.6;
    const wantYaw = Math.atan2(-toP.x, -toP.z);
    if (!moving) {
      let dy = wantYaw - a.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      a.yaw += dy * (1 - Math.exp(-dt * 4));
    }
    if (a.state === 'gunner') { a.mode = 'aim'; a.aimW += (1 - a.aimW) * (1 - Math.exp(-dt * 4)); a.yaw = a.vehicle ? a.vehicle.yaw + (a.vehicle.U.turret ? a.vehicle.U.turret.rotation.y : 0) : a.yaw; return; }
    const engaged = a.hasLOS && dist < (a.role === 'rpg' ? 420 : 380) && !moving;
    a.aimW += ((engaged ? 1 : 0) - a.aimW) * (1 - Math.exp(-dt * 5));
    a.mode = moving ? 'run' : a.role === 'rpg' ? 'rpg' : 'aim';
    a.crouch = !moving && !a.onRoof && a.role !== 'rpg' && dist > 40 && (a.id % 3 === 0);
    if (!engaged) { a.burst = 0; return; }
    a.reactT -= dt;
    if (a.reactT > 0) return;
    a.fireT -= dt;
    const W = a.h.weapon;
    if (!W) return;
    if (a.role === 'rpg') {
      if (a.fireT <= 0 && dist > 25) {
        a.fireT = rnd(7, 11);
        const muzzle = W.localToWorld(W.userData.muzzle.clone());
        const lead = P.vel.clone().multiplyScalar(Math.min(2.5, dist / 115) * rnd(0.4, 1.0));
        const aim = target.clone().add(lead).add(new THREE.Vector3(rnd(-2, 2), rnd(-1, 2), rnd(-2, 2)).multiplyScalar(dist / 120));
        const dir = aim.sub(muzzle).normalize();
        this.combat.enemyRPG(muzzle, dir, a);
        a.h.fireRecoil();
        if (this.onEvent) this.onEvent('rpgFired', { agent: a });
        if (W.userData.warhead) W.userData.warhead.forEach(m => m.visible = false);
        later(4.5, () => { if (W.userData.warhead) W.userData.warhead.forEach(m => m.visible = true); });
      }
      return;
    }
    if (a.burst <= 0 && a.fireT <= 0) {
      a.burst = Math.floor(rnd(3, 8));
      a.fireT = rnd(0.7, 2.4);
      const muzzle = W.localToWorld(W.userData.muzzle.clone());
      const far = muzzle.distanceTo(this.audio.listenerPos) > 160;
      this.audio.play(far ? 'ak_distant' : 'ak_burst', muzzle, { vol: far ? 0.8 : 0.75, ref: 10 });
      a.shotT = 0;
    }
    if (a.burst > 0) {
      a.shotT = (a.shotT || 0) - dt;
      if (a.shotT <= 0) {
        a.shotT = 0.1;
        a.burst--;
        const muzzle = W.localToWorld(W.userData.muzzle.clone());
        const sp = P.vel.length();
        const spread = 0.012 + dist * 0.00006 + Math.min(0.06, sp * 0.0012) + (a.crouch ? -0.004 : 0);
        const lead = P.vel.clone().multiplyScalar(dist / 720 * rnd(0.2, 1.1));
        const dir = target.clone().add(lead).sub(muzzle).normalize();
        this.combat.enemyBullet(muzzle, dir, { dmg: 0.5, spread, tracer: Math.random() < 0.35, kind: 'ak', shooter: a });
        this.fx.muzzleFlash(muzzle, dir, 1);
        a.h.fireRecoil();
      }
    }
  }
}
