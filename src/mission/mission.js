// The Gulmira mission: intro, approach, liberation, tank, weapons cache, launch intercept, F-22 intercept, debrief.
import * as THREE from 'three';
import { later } from '../core/scheduler.js';
import { dressCache } from '../world/cache.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Mission {
  constructor(G) {
    this.G = G;
    this.phase = 'none';
    this.objective = null;
    this.waypoint = null;
    this.waypointLabel = '';
    this.t = 0;
    this.phaseT = 0;
    this.flags = {};
    this.checkpoint = 'start';
    this.deadT = 0;
    this.evaded = 0;
    this.missionTime = 0;
    this.onComplete = null;
    this.onFail = null;
    this.walkAway = null;
    this.hintCool = {};
  }

  get J() { return this.G.jarvis; }

  say(text, opts = {}) { this.J.say(text, opts); }
  hint(key, text, cool = 25) { this.J.say(text, { key, cooldown: cool, priority: 1 }); }

  setObjective(title, text, sub = '') { this.objective = { title, text, sub }; }

  // ------------------------------------------------------------------ setup
  start() {
    const G = this.G;
    this.setupAASite();
    this.setupVillage();
    this.setupCache();
    this.wireEvents();
    this.enter('intro');
  }

  setupAASite() {
    const G = this.G, S = G.meta.sites.aa;
    const p = new THREE.Vector3(S.x, G.terrain.heightAt(S.x, S.z), S.z);
    this.aaSite = G.vehicles.spawn('zu23', p, { yaw: Math.PI * 0.9, range: 2200 });
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * 6.28 + 0.4;
      const q = new THREE.Vector3(S.x + Math.cos(a) * 9, 0, S.z + Math.sin(a) * 9);
      q.y = G.terrain.heightAt(q.x, q.z);
      const f = G.agents.spawn('fighter', i === 0 ? 'rpg' : 'rifle', q, { state: 'idle', roof: false });
      f.site = 'aa';
    }
  }

  setupVillage() {
    const G = this.G, V = G.village, T = G.terrain, A = G.agents;
    const sq = V.points.square;
    this.villageFighters = [];
    const hostages = V.points.hostage.slice(0, 13);
    for (const hp of hostages) {
      const a = A.spawn('civilian', 'hostage', hp, { state: 'hostage', yaw: Math.atan2(-(sq.x - hp.x), -(sq.z - hp.z)), burqa: Math.random() < 0.3 });
      a.site = 'village';
    }
    for (let i = 0; i < 6; i++) {
      const an = i / 6 * 6.28 + 0.2;
      const p = new THREE.Vector3(sq.x + Math.cos(an) * 15, 0, sq.z + Math.sin(an) * 15);
      p.y = T.heightAt(p.x, p.z);
      const f = A.spawn('fighter', 'guard', p, { state: 'guard' });
      this.villageFighters.push(f);
    }
    const covers = V.points.cover.filter(c => c.pos.distanceTo(sq) < 150 && c.pos.distanceTo(sq) > 20);
    for (let i = 0; i < 17; i++) {
      const c = pick(covers);
      this.villageFighters.push(A.spawn('fighter', 'rifle', c.pos.clone(), { state: 'idle' }));
    }
    const roofs = V.points.roofs.filter(r => r.distanceTo(sq) < 170 && r.distanceTo(sq) > 35);
    for (let i = 0; i < 5; i++) this.villageFighters.push(A.spawn('fighter', 'rpg', pick(roofs).clone(), { state: 'idle', roof: true }));
    for (let i = 0; i < 16; i++) {
      const s = pick(V.points.streets);
      if (s.distanceTo(sq) < 30) continue;
      const a = A.spawn('civilian', 'villager', s.clone(), { state: Math.random() < 0.6 ? 'walk' : 'idle', burqa: Math.random() < 0.25 });
      a.site = 'village';
    }
    this.villageTotal = this.villageFighters.length;
  }

  setupCache() {
    const G = this.G, S = G.meta.sites.cache, T = G.terrain;
    const c = new THREE.Vector3(S.x, T.heightAt(S.x, S.z), S.z);
    this.cacheCenter = c;
    this.cacheDress = dressCache({ scene: G.scene, terrain: T, world: G.world, atmo: G.atmo, center: c });
    this.tels = [];
    const slots = [[-55, 35, 0.5], [-18, 58, 0.7], [24, 50, 0.95], [58, 18, 1.2]];
    for (const [dx, dz, yaw] of slots) {
      const p = new THREE.Vector3(c.x + dx, 0, c.z + dz);
      p.y = T.heightAt(p.x, p.z);
      const v = G.vehicles.spawn('tel', p, { yaw: yaw + Math.PI * 0.75, static: true });
      this.tels.push(v);
    }
    this.cacheAA = [];
    for (const [dx, dz] of [[70, -55], [-85, -25]]) {
      const p = new THREE.Vector3(c.x + dx, 0, c.z + dz);
      p.y = T.heightAt(p.x, p.z);
      const v = G.vehicles.spawn('zu23', p, { yaw: Math.random() * 6.28, range: 1900 });
      v.active = false;
      this.cacheAA.push(v);
    }
    const tp = new THREE.Vector3(c.x - 30, 0, c.z - 40); tp.y = T.heightAt(tp.x, tp.z);
    this.cacheTech = G.vehicles.spawn('technical', tp, { yaw: 2.4, gunner: true });
    this.cacheTech.active = false;
    this.cacheFighters = [];
    for (let i = 0; i < 13; i++) {
      const an = Math.random() * 6.28, r = rnd(20, 120);
      const p = new THREE.Vector3(c.x + Math.cos(an) * r, 0, c.z + Math.sin(an) * r);
      if (!G.agents.nav.freeAt(p.x, p.z) && false) continue;
      p.y = T.heightAt(p.x, p.z);
      const f = G.agents.spawn('fighter', i < 3 ? 'rpg' : 'rifle', p, { state: 'idle' });
      f.site = 'cache';
      this.cacheFighters.push(f);
    }
    this.dressCacheProps(c);
  }

  dressCacheProps(c) {
    const G = this.G, T = G.terrain;
    const blocked = [...this.tels.map(v => [v.pos, 9]), ...this.cacheAA.map(v => [v.pos, 3.5]), [this.cacheTech.pos, 5]];
    const free = (p, clear) => !blocked.some(([q, r]) => Math.hypot(p.x - q.x, p.z - q.z) < r + clear);
    const around = (q, rMin, rMax, clear) => {
      for (let t = 0; t < 40; t++) {
        const an = Math.random() * 6.28, r = rnd(rMin, rMax);
        const p = new THREE.Vector3(q.x + Math.cos(an) * r, 0, q.z + Math.sin(an) * r);
        if (!free(p, clear)) continue;
        p.y = T.heightAt(p.x, p.z);
        blocked.push([p, clear]);
        return p;
      }
      return null;
    };
    const local = (p, yaw, lx, lz) => { const cs = Math.cos(yaw), sn = Math.sin(yaw); const x = p.x + lx * cs + lz * sn, z = p.z - lx * sn + lz * cs; return new THREE.Vector3(x, T.heightAt(x, z), z); };
    const cover = (p, yaw, hx, hy, hz) => G.world.addBox(new THREE.Vector3(p.x, p.y + hy, p.z), new THREE.Vector3(hx, hy, hz), yaw, { kind: 'crates' });
    const sets = { wooden_military_crate: [], old_military_crate: [], Barrel_01: [], portable_generator: [], ammo_box: [], concrete_road_barrier: [] };

    for (let s = 0; s < 10; s++) {
      const p = around(c, 14, 95, 3.2);
      if (!p) continue;
      const yaw = Math.random() * 6.28, cols = 1 + Math.floor(Math.random() * 3), rows = 1 + Math.floor(Math.random() * 2);
      let top = 0;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const q = local(p, yaw, (i - (cols - 1) / 2) * 1.3, (j - (rows - 1) / 2) * 0.8);
        const h = 1 + Math.floor(Math.random() * 3);
        top = Math.max(top, h);
        for (let k = 0; k < h; k++) sets.wooden_military_crate.push({ pos: q.clone().setY(q.y + k * 0.41), yaw: yaw + (Math.random() - 0.5) * 0.06 });
        if (Math.random() < 0.3) sets.ammo_box.push({ pos: q.clone().setY(q.y + h * 0.41), yaw: yaw + Math.random() * 0.4 });
      }
      cover(p, yaw, cols * 0.65, top * 0.205, rows * 0.4);
    }
    for (let i = 0; i < 12; i++) {
      const p = around(c, 10, 80, 1.2);
      if (p) { const yaw = Math.random() * 6.28; sets.old_military_crate.push({ pos: p, yaw }); cover(p, yaw, 0.5, 0.25, 0.35); }
    }
    for (let g = 0; g < 6; g++) {
      const p = around(c, 12, 85, 1.6);
      if (!p) continue;
      const n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) { const a = i * 2.4, r = i === 0 ? 0 : 0.62 * Math.sqrt(i); sets.Barrel_01.push({ pos: local(p, 0, Math.cos(a) * r, Math.sin(a) * r), yaw: Math.random() * 6.28 }); }
      cover(p, 0, 0.9, 0.45, 0.9);
    }
    for (const lp of this.cacheDress.lights) {
      const p = around(lp, 1.6, 2.4, 0.6);
      if (p) sets.portable_generator.push({ pos: p, yaw: Math.atan2(lp.x - p.x, lp.z - p.z), scale: 1.25 });
    }
    for (const v of this.tels.slice(0, 2)) {
      const p = around(v.pos, 9.5, 12, 0.6);
      if (p) sets.portable_generator.push({ pos: p, yaw: Math.random() * 6.28, scale: 1.25 });
    }
    for (const v of this.cacheAA) {
      for (let i = 0; i < 7; i++) {
        const p = around(v.pos, 2.4, 3.6, 0.15);
        if (p) sets.ammo_box.push({ pos: p, yaw: Math.random() * 6.28 });
      }
    }
    let entry = null;
    for (const road of G.meta.roads) for (const [x, z] of road) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d > 110 && d < 175 && (!entry || Math.abs(d - 140) < Math.abs(entry.d - 140))) entry = { x, z, d };
    }
    if (entry) {
      const rx = (entry.x - c.x) / entry.d, rz = (entry.z - c.z) / entry.d;
      const yaw = Math.atan2(rx, rz);
      for (const [off, side] of [[0, -1], [9, 1]]) {
        const base = new THREE.Vector3(entry.x - rx * off, 0, entry.z - rz * off);
        for (let i = 0; i < 4; i++) {
          const along = side * (1.2 + i * 2.1);
          const x = base.x + rz * along, z = base.z - rx * along;
          const p = new THREE.Vector3(x, T.heightAt(x, z), z);
          sets.concrete_road_barrier.push({ pos: p, yaw: yaw + (Math.random() - 0.5) * 0.08, scale: 1.35 });
          cover(p, yaw, 1.05, 0.55, 0.4);
        }
      }
    }
    for (const [name, inst] of Object.entries(sets)) if (inst.length) G.props.addSet(name, inst, { lods: 1, ranges: [1e9], maxDist: 2500 });
  }

  wireEvents() {
    const G = this.G;
    const prevAgents = G.agents.onEvent;
    G.agents.onEvent = (type, d) => {
      if (type === 'death') {
        const a = d.agent;
        if (d.source === 'player') {
          if (a.kind === 'civilian') {
            G.hud.kill('CIVILIAN CASUALTY');
            this.say(pick(['Sir, that was a civilian.', 'Civilian down. Please be careful, sir.', 'That was a non-combatant, sir.']), { key: 'civ', cooldown: 6, priority: 3 });
          } else {
            G.hud.kill('HOSTILE DOWN');
            G.hud.hit();
          }
        }
      }
      if (type === 'alarm' && this.phase === 'approach') this.flags.villageAlarm = true;
      if (type === 'rpgFired') this.hint('rpg', pick(['RPG!', 'Rocket incoming.', 'Incoming RPG, sir.']), 9);
      if (prevAgents) prevAgents(type, d);
    };
    G.vehicles.onEvent = (type, d) => {
      if (type === 'vehicleHit' && d.v.type === 'tank' && d.weapon === 'repulsor') this.hint('tankArmor', "The armour's too thick for repulsors. Use the anti-tank rocket. Press F.", 15);
      if (type === 'tankFired') this.hint('tankFire', pick(['Incoming!', 'Main gun, sir!', 'He is firing.']), 8);
      if (type === 'vehicleDestroyed') this.onVehicleDestroyed(d.v);
      if (type === 'missileIntercepted') this.onIntercepted();
    };
    G.combat.onEvent = (type, d) => {
      if (type === 'missileEvaded' || type === 'missileDecoyed') {
        if (this.phase === 'raptors' && !d.p.counted) { d.p.counted = true; this.evaded++; this.say(type === 'missileDecoyed' ? pick(['Flares took it.', 'Decoyed.', 'It went for the flares.']) : pick(['Missile overshot.', 'Evaded.', 'It missed, sir.']), { key: 'evade', cooldown: 3 }); }
      }
      if (type === 'missileLaunch' && this.phase === 'raptors') this.say(pick(['Missile launch! Deploy flares.', 'Fox two, sir. Flares!', 'They have fired. Break and flare!']), { key: 'fox', cooldown: 4, priority: 3 });
      if (type === 'microLaunch' && d.locked > 0 && !this.flags.microSaid) { this.flags.microSaid = true; this.say('Targets acquired. Civilians excluded.', { priority: 2 }); }
    };
    if (G.jets) G.jets.onEvent = (type, d) => {
      if (type === 'jetHit') this.hint('friendly', 'Sir, those are friendlies. I would advise against shooting at the Air Force.', 12);
      if (type === 'flyby') this.hint('flyby', pick(['That was close.', 'Raptor overhead.', 'He is right on top of us.']), 10);
    };
  }

  // ------------------------------------------------------------------ phases
  enter(phase) {
    const G = this.G;
    this.phase = phase;
    this.phaseT = 0;
    if (phase === 'intro') {
      G.player.locked = true;
      G.hud.visible = false;
      let ang = 2.2;
      G.rig.cinematic = (dt, cam) => {
        ang += dt * 0.12;
        const P = G.player;
        const fwd = P.vel.clone().normalize();
        const side = new THREE.Vector3(Math.cos(ang), 0.12, Math.sin(ang));
        cam.position.copy(P.pos).addScaledVector(side, 9).addScaledVector(fwd, 3);
        cam.lookAt(P.pos.clone().addScaledVector(fwd, 2));
        cam.fov = 40; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      };
      G.hud.showBanner('GULMIRA', 'KUNAR VALLEY  ·  18:47 LOCAL', 6);
      this.say('Approaching the Kunar valley, sir. Gulmira is nine kilometres north.', { priority: 2 });
    }
    if (phase === 'approach') {
      G.player.locked = false;
      G.hud.visible = true;
      G.rig.cinematic = null;
      G.rig.inited = false;
      G.rig.fov = 62;
      this.setObjective('Approach', 'Fly to Gulmira');
      this.waypoint = new THREE.Vector3(G.meta.sites.village.x, G.terrain.heightAt(0, 0) + 30, G.meta.sites.village.z);
      this.waypointLabel = 'Gulmira';
      this.checkpoint = 'start';
      G.audio.playMusic('music_approach', { vol: 0.9 });
      this.say('Hold W to throttle up, shift to boost. Mouse steers.', { priority: 1 });
    }
    if (phase === 'village') {
      this.setObjective('Gulmira', 'Neutralize the Ten Rings fighters');
      this.waypoint = G.village.points.square.clone().add(new THREE.Vector3(0, 2, 0));
      this.waypointLabel = 'Square';
      this.checkpoint = 'village';
      G.hud.showBanner('GULMIRA', 'HOSTILES IN THE VILLAGE', 4);
      this.say("I'm reading heat signatures in the main square. Armed men holding civilians.", { priority: 2 });
    }
    if (phase === 'tank') {
      this.setObjective('Gulmira', 'Destroy the tank');
      const path = [new THREE.Vector3(-40, 0, -330), new THREE.Vector3(-22, 0, -220), new THREE.Vector3(-6, 0, -110), new THREE.Vector3(2, 0, -45)];
      const p = path[0].clone(); p.y = G.terrain.heightAt(p.x, p.z);
      this.tank = G.vehicles.spawn('tank', p, { yaw: Math.PI * 0.95, path: path.slice(1), range: 700 });
      this.waypoint = null;
      this.say("Heavy armour, north side. That's a T-72.", { priority: 3 });
      G.hud.showBanner('ARMOUR', 'T-72 APPROACHING FROM THE NORTH', 4);
      G.audio.playMusic('music_combat', { vol: 1 });
    }
    if (phase === 'cache') {
      this.setObjective('Weapons cache', 'Destroy the missile launchers', '0 / 4');
      this.waypoint = this.cacheCenter.clone().add(new THREE.Vector3(0, 20, 0));
      this.waypointLabel = 'Cache';
      this.checkpoint = 'cache';
      G.hud.showBanner('WEAPONS CACHE LOCATED', 'STARK INDUSTRIES MUNITIONS  ·  2.8 KM NE', 5);
      this.say("I've found the weapons the Ten Rings bought. Our missiles, sir. Two point eight kilometres north-east, in the canyon.", { priority: 2 });
    }
    if (phase === 'intercept') {
      this.setObjective('Weapons cache', 'Intercept the missile');
      G.hud.showBanner('MISSILE LAUNCH', 'INTERCEPT IT', 3);
      this.say('Missile launch! Intercept it before it clears the valley.', { priority: 4, interrupt: true });
    }
    if (phase === 'raptors') {
      this.setObjective('Intercept', 'Evade the F-22s', 'Missiles evaded 0 / 6');
      this.waypoint = null;
      this.checkpoint = 'raptors';
      this.evaded = 0;
      const P = G.player.pos;
      for (let i = 0; i < 2; i++) {
        const sp = new THREE.Vector3(P.x - 6500 - i * 300, Math.max(P.y + 900, 1500), P.z + 5200 + i * 260);
        const v = new THREE.Vector3(P.x - sp.x, 0, P.z - sp.z).normalize().multiplyScalar(300);
        G.jets.spawn(sp, v, i ? 'Raptor 2' : 'Raptor 1');
      }
      G.hud.showBanner('INTERCEPT', 'TWO F-22 RAPTORS INBOUND', 4);
      this.say("Sir, two fighters inbound from the south-west. F-22s out of Bagram. They think we're a hostile aircraft.", { priority: 4 });
      later(7, () => this.say('They have a lock on us. Evade, and use flares. E.', { priority: 3 }));
      G.audio.playMusic('music_chase', { vol: 1 });
    }
    if (phase === 'complete') {
      this.objective = null;
      this.waypoint = null;
      G.jets.egressAll();
      this.say("They're breaking off, sir. Mission complete. Shall I set a course for home?", { priority: 4 });
      G.audio.playMusic('music_victory', { vol: 1, loop: false });
      later(6.5, () => { if (this.onComplete) this.onComplete(this.debrief()); });
    }
  }

  debrief() {
    const S = this.G.combat.stats, A = this.G.agents.counts;
    const time = this.missionTime;
    const acc = S.shots ? S.hits / S.shots : 0;
    const civ = S.civilians;
    let score = 1000 - civ * 150 - Math.max(0, time - 600) * 0.5 + acc * 300 + (this.flags.walkAway ? 150 : 0) + (this.flags.aaDown ? 50 : 0);
    const rank = civ > 0 ? (score > 900 ? 'B' : 'C') : score > 1150 ? 'S' : score > 950 ? 'A' : score > 800 ? 'B' : 'C';
    return { time, kills: S.kills, vehicles: S.vehicles, civilians: civ, hostages: A.civilians - A.civiliansDead, accuracy: acc, missiles: S.missiles, walkAway: !!this.flags.walkAway, rank };
  }

  onVehicleDestroyed(v) {
    const G = this.G;
    if (v === this.aaSite) { this.flags.aaDown = true; this.say('AA gun destroyed.', { priority: 1 }); }
    if (v.type === 'technical') G.hud.kill('TECHNICAL DESTROYED');
    if (v === this.tank) {
      const camF = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
      const toTank = v.pos.clone().sub(G.player.pos).normalize();
      const lookingAway = camF.dot(toTank) < -0.2;
      if (lookingAway && (G.player.mode === 'ground' || G.player.agl < 6) && this.flags.rocketT && this.missionTime - this.flags.rocketT < 6) this.startWalkAway(v);
      else this.say(pick(['Tank destroyed.', 'Armour neutralised.', 'That got his attention.']), { priority: 2 });
      later(this.flags.walkAway ? 4.5 : 3.5, () => this.enter('cache'));
    }
    if (v.type === 'tel') {
      const left = this.tels.filter(t => !t.dead).length;
      this.objective && (this.objective.sub = `${4 - left} / 4`);
      G.hud.kill('LAUNCHER DESTROYED');
      if (left > 0) this.say(pick(['Launcher destroyed.', 'One less.', 'Good. ' + left + ' to go.']), { key: 'tel', cooldown: 4, priority: 2 });
    }
  }

  startWalkAway(v) {
    const G = this.G;
    this.flags.walkAway = true;
    G.timeScale = 0.35;
    G.player.locked = true;
    const P = G.player;
    const away = P.pos.clone().sub(v.pos).setY(0).normalize();
    G.player.yaw = Math.atan2(-away.x, -away.z);
    let t = 0;
    G.rig.cinematic = (dt, cam) => {
      t += dt;
      const side = new THREE.Vector3(-away.z, 0, away.x);
      cam.position.copy(P.pos).addScaledVector(away, 5.5).addScaledVector(side, 1.6).add(new THREE.Vector3(0, 0.6 - t * 0.05, 0));
      cam.lookAt(P.pos.clone().add(new THREE.Vector3(0, 0.6, 0)));
      cam.fov = 38; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    };
    G.forceWalk = away.clone();
    G.hud.showBanner('', 'DID NOT LOOK BACK', 3);
    later(1.6, () => this.say('Very subtle, sir.', { priority: 3 }), { real: true });
    later(2.8, () => { G.timeScale = 1; G.player.locked = false; G.rig.cinematic = null; G.rig.inited = false; G.forceWalk = null; }, { real: true });
  }

  onIntercepted() {
    this.flags.intercepted = true;
    this.say('Target destroyed. Nice shooting, sir.', { priority: 3 });
    this.setObjective('Weapons cache', 'Destroy the missile launchers', `${4 - this.tels.filter(t => !t.dead).length} / 4`);
    this.phase = 'cache';
  }

  // ------------------------------------------------------------------ per-frame
  update(dt) {
    const G = this.G, P = G.player;
    this.t += dt; this.phaseT += dt;
    if (this.phase !== 'intro' && this.phase !== 'complete') this.missionTime += dt;
    if (G.jets) G.jets.update(dt);
    if (this.launchSeq) { if (this.launchSeq.tick(dt)) this.launchSeq = null; }
    // death and respawn
    if (P.mode === 'dead') {
      this.deadT += dt;
      if (this.deadT > 0.2 && !this.flags.deathSaid) { this.flags.deathSaid = true; this.say('Suit failure. Rebooting from the last checkpoint.', { priority: 5, interrupt: true }); }
      if (this.deadT > 3.5) this.respawn();
      return;
    }
    this.deadT = 0; this.flags.deathSaid = false;
    // civilian casualty failure
    if (G.combat.stats.civilians >= 6 && !this.flags.failed) { this.fail('Too many civilian casualties.'); return; }
    const vil = G.meta.sites.village;
    const dVillage = Math.hypot(P.pos.x - vil.x, P.pos.z - vil.z);
    if (this.phase === 'intro') {
      if (this.phaseT > 7 || (this.phaseT > 1 && (G.input.hit('Space') || G.input.btnHit('left')))) this.enter('approach');
      return;
    }
    if (this.phase === 'approach') {
      this.objective.sub = (dVillage / 1000).toFixed(1) + ' km';
      const aa = this.aaSite;
      if (aa && !aa.dead && aa.pos.distanceTo(P.pos) < 2100 && !this.flags.aaSaid) { this.flags.aaSaid = true; this.say('Anti-aircraft gun on the ridge ahead. Stay low or take it out.', { priority: 2 }); }
      if (dVillage < 1600) this.enter('village');
      return;
    }
    if (this.phase === 'village' || this.phase === 'tank') {
      const alive = this.villageFighters.filter(f => !f.dead).length;
      const killed = this.villageTotal - alive;
      if (this.phase === 'village') this.objective.sub = `${killed} / ${this.villageTotal}  ·  civilians lost ${G.combat.stats.civilians}`;
      if (!G.agents.alerted && (dVillage < 420 && P.agl < 120 || dVillage < 250)) { G.agents.alarm(P.pos.clone()); }
      if (G.agents.alerted && !this.flags.vAlarm) {
        this.flags.vAlarm = true;
        this.waypoint = null;
        G.audio.playMusic('music_combat', { vol: 1 });
        later(2.5, () => this.say('Hold the right mouse button to target. I will exclude the civilians.', { priority: 2 }));
        this.techT = 22;
      }
      if (this.techT !== undefined && this.techT > 0) {
        this.techT -= dt;
        if (this.techT <= 0) this.sendTechnicals();
      }
      if (this.phase === 'village' && killed >= Math.ceil(this.villageTotal * 0.65)) this.enter('tank');
      if (this.phase === 'tank' && this.tank && !this.tank.dead) {
        if (!this.flags.tankHint && this.phaseT > 14) { this.flags.tankHint = true; this.say('Anti-tank rocket on your left forearm, sir. F to fire. It will home on armour.', { priority: 2 }); }
      }
      if (G.input.hit('KeyF')) this.flags.rocketT = this.missionTime;
      return;
    }
    if (this.phase === 'cache' || this.phase === 'intercept') {
      const dC = P.pos.distanceTo(this.cacheCenter);
      if (dC < 1500 && !this.flags.cacheAct) {
        this.flags.cacheAct = true;
        for (const v of this.cacheAA) v.active = true;
        this.cacheTech.active = true;
        this.say('AA guns active at the cache.', { priority: 2 });
      }
      if (dC < 700 && !this.flags.cacheAlarm) {
        this.flags.cacheAlarm = true;
        for (const f of this.cacheFighters) f.seen = true;
        G.agents.alarm(this.cacheCenter.clone());
        this.waypoint = null;
      }
      if (this.phase === 'cache') this.objective.sub = `${this.tels.filter(t => t.dead).length} / 4`;
      const left = this.tels.filter(t => !t.dead);
      if (!this.flags.launchStarted && this.flags.cacheAlarm && (4 - left.length >= 2 || this.phaseT > 80) && left.length > 0) {
        this.flags.launchStarted = true;
        const v = left.sort((a, b) => b.pos.distanceTo(P.pos) - a.pos.distanceTo(P.pos))[0];
        this.launchTEL = v;
        this.say("They're raising a launcher, sir! Stop it before it fires.", { priority: 4, interrupt: true });
        this.launchSeq = G.vehicles.launch(v, {
          onLaunched: (m) => { this.launchMissile = m; this.enter('intercept'); },
          onEscaped: () => this.fail('The missile cleared the valley.'),
        });
      }
      if (this.phase === 'intercept' && this.launchMissile) this.objective.sub = Math.max(0, 32 - this.launchMissile.t).toFixed(1) + ' s';
      if (left.length === 0 && (!this.launchMissile || this.launchMissile.dead) && !this.flags.cacheDone) {
        this.flags.cacheDone = true;
        this.say("That's all of them. The cache is gone.", { priority: 3 });
        later(6, () => this.enter('raptors'));
      }
      return;
    }
    if (this.phase === 'raptors') {
      this.objective.sub = `Missiles evaded ${this.evaded} / 6`;
      if (this.evaded >= 6 || this.phaseT > 130) this.enter('complete');
    }
  }

  sendTechnicals() {
    const G = this.G;
    const routes = [
      [new THREE.Vector3(-320, 0, 40), new THREE.Vector3(-200, 0, 30), new THREE.Vector3(-90, 0, 12), new THREE.Vector3(-40, 0, 2)],
      [new THREE.Vector3(310, 0, -52), new THREE.Vector3(210, 0, -40), new THREE.Vector3(110, 0, -24), new THREE.Vector3(50, 0, -12)],
    ];
    this.techs = routes.map((r) => {
      const p = r[0].clone(); p.y = G.terrain.heightAt(p.x, p.z);
      const yaw = Math.atan2(-(r[1].x - r[0].x), -(r[1].z - r[0].z));
      const v = G.vehicles.spawn('technical', p, { yaw, path: r.slice(1), gunner: true, range: 650 });
      this.villageFighters.push(...v.crew);
      this.villageTotal += v.crew.length;
      return v;
    });
    this.say('Two technicals inbound, east and west roads.', { priority: 2 });
  }

  fail(reason) {
    const G = this.G;
    this.flags.failed = true;
    this.say(reason + ' Restarting from the last checkpoint.', { priority: 5, interrupt: true });
    if (this.onFail) this.onFail(reason);
    later(3.5, () => { this.flags.failed = false; G.combat.stats.civilians = Math.min(G.combat.stats.civilians, 3); this.respawn(); }, { real: true });
  }

  respawn() {
    const G = this.G, P = G.player, T = G.terrain;
    let pos, mode = 'hover', yaw = 0, vel = null;
    if (this.checkpoint === 'start') { G.spawnStart(); this.deadT = 0; return; }
    if (this.checkpoint === 'village') { pos = new THREE.Vector3(30, 0, 640); pos.y = T.heightAt(pos.x, pos.z) + 50; yaw = 0; }
    else if (this.checkpoint === 'cache') {
      pos = new THREE.Vector3(600, 0, -500); pos.y = T.heightAt(pos.x, pos.z) + 60; yaw = Math.atan2(-(this.cacheCenter.x - pos.x), -(this.cacheCenter.z - pos.z));
      if (this.launchTEL && this.flags.launchStarted && !this.flags.intercepted) {
        this.flags.launchStarted = false;
        this.launchMissile = null; this.launchSeq = null;
        this.rebuildTEL(this.launchTEL);
        if (this.phase === 'intercept') this.phase = 'cache';
        this.phaseT = 40;
      }
    } else { pos = P.pos.clone(); pos.y = Math.max(pos.y, T.heightAt(pos.x, pos.z) + 300); mode = 'flight'; yaw = P.yaw; vel = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(150); }
    P.spawn(pos, mode, vel, yaw);
    G.rig.yaw = yaw; G.rig.pitch = -0.1; G.rig.inited = false;
    this.deadT = 0;
  }

  rebuildTEL(v) {
    const G = this.G;
    if (v.dead) return;
    G.scene.remove(v.model);
    const nv = G.vehicles.spawn('tel', v.pos.clone(), { yaw: v.yaw, static: true });
    const i = this.tels.indexOf(v);
    this.tels[i] = nv;
    v.dead = true; v.hp = 0;
    const hi = G.combat.hitables.indexOf(v);
    if (hi >= 0) G.combat.hitables.splice(hi, 1);
    if (v.collider) G.world.remove(v.collider);
  }
}
