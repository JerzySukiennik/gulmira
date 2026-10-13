// Gulmira: boot, systems wiring and the frame loop.
import * as THREE from 'three';
import { Renderer } from './core/renderer.js';
import { Input } from './core/input.js';
import { Atmosphere } from './world/atmosphere.js';
import { Terrain } from './world/terrain.js';
import { CollisionWorld } from './world/collision.js';
import { buildMk3, SUIT_DETAIL_GLSL } from './suit/mk3.js';
import { SuitAnimator } from './suit/animator.js';
import { Player } from './player/player.js';
import { CameraRig } from './player/camera.js';
import { Particles } from './fx/particles.js';
import { Thrusters } from './fx/thrusters.js';
import { Effects } from './fx/effects.js';
import { Village } from './world/village.js';
import { PropLibrary } from './world/props.js';
import { scatterWorld } from './world/scatter.js';
import { AudioEngine, SuitAudio } from './audio/audio.js';
import { Combat } from './combat/combat.js';
import { Agents } from './ai/agents.js';
import { Jarvis } from './mission/jarvis.js';
import { HUD } from './hud/hud.js';
import { UI } from './ui/ui.js';
import { Mission } from './mission/mission.js';
import { Vehicles } from './vehicles/vehicles.js';
import { Jets } from './vehicles/jets.js';
import { tickScheduler } from './core/scheduler.js';

const loading = document.getElementById('loading');
const setProgress = (p, msg) => {
  loading.querySelector('.ld-bar i').style.width = (p * 100).toFixed(0) + '%';
  if (msg) loading.querySelector('.ld-msg').textContent = msg;
};

async function boot() {
  const canvas = document.getElementById('c');
  const R = new Renderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, R.width / R.height, 0.3, 60000);
  let atmo = null;
  R.onResize = (w, h) => { camera.aspect = w / h; camera.updateProjectionMatrix(); if (atmo) atmo.csm.updateFrustums(); };
  setProgress(0.05, 'Terrain data');
  const meta = await (await fetch('assets/terrain/meta.json')).json();
  atmo = new Atmosphere({ renderer: R.renderer, scene, camera, sunDir: meta.sun });
  const terrain = new Terrain(atmo);
  await terrain.load();
  scene.add(terrain.mesh);
  const world = new CollisionWorld(terrain);
  const input = new Input(canvas);
  setProgress(0.45, 'Gulmira');
  const village = await new Village({ atmo, terrain, world, meta }).build();
  scene.add(village.group);
  setProgress(0.55, 'Rocks and scrub');
  const props = new PropLibrary(atmo, scene);
  const scatter = await scatterWorld({ props, terrain, world, meta, village });
  setProgress(0.75, 'Mark III');
  const suit = buildMk3();
  const suitMats = new Set();
  suit.traverse(o => { if (o.isMesh) suitMats.add(o.material); });
  const D = SUIT_DETAIL_GLSL;
  for (const m of suitMats) {
    const detailed = m.isMeshPhysicalMaterial || m.isMeshStandardMaterial;
    atmo.patch(m, {
      key: 'suit', extra: (sh) => {
        if (detailed) {
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + D.vertPars).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + D.vert);
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + D.fragPars)
            .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + D.frag)
            .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + D.clearcoat);
        }
        sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n gl_FragColor.a = 0.0;');
      },
    });
  }
  scene.add(suit);
  R.sunDir = atmo.sunDir.clone();
  R.planShadows = () => atmo.planShadows();
  const anim = new SuitAnimator(suit);
  const player = new Player({ suit, animator: anim, terrain, world, input });
  const rig = new CameraRig(camera, player, world);
  const particles = new Particles(scene, atmo, R.renderer);
  const thrusters = new Thrusters(suit, anim, particles, terrain, scene);
  const fx = new Effects({ scene, particles, terrain, world, atmo });
  const audio = new AudioEngine();
  const suitAudio = new SuitAudio(audio);
  fx.audio = audio;
  fx.listener = camera.position;
  fx.onShake = (s) => rig.addTrauma(s);
  const combat = new Combat({ scene, world, terrain, fx, audio, player, anim, camera, atmo });
  const agents = new Agents({ scene, atmo, terrain, world, village, combat, fx, audio, player });
  combat.onRepulsor = (side) => thrusters.repulsorFlash(side);

  const G = { THREE, R, scene, camera, atmo, terrain, world, village, props, scatter, input, suit, anim, player, rig, particles, thrusters, fx, audio, suitAudio, combat, agents, meta, paused: false, timeScale: 1, mission: null };
  window.__g = G;

  // start position: in the air south of Gulmira
  const S = meta.sites;
  G.spawnStart = () => {
    const startPos = new THREE.Vector3(-150, 0, 7300);
    startPos.y = terrain.heightAt(startPos.x, startPos.z) + 320;
    const toVillage = new THREE.Vector3(S.village.x - startPos.x, 0, S.village.z - startPos.z).normalize();
    const startYaw = Math.atan2(-toVillage.x, -toVillage.z);
    player.spawn(startPos, 'flight', toVillage.clone().multiplyScalar(110), startYaw);
    rig.yaw = startYaw; rig.pitch = -0.08; rig.inited = false;
  };
  G.spawnStart();
  const params = new URLSearchParams(location.search);
  if (params.get('at') === 'village') {
    const p = new THREE.Vector3(40, 0, 120);
    p.y = terrain.heightAt(p.x, p.z) + 1.02;
    player.spawn(p, 'ground', null, 0);
    rig.yaw = 0; rig.inited = false;
  }

  G.jarvis = new Jarvis();
  G.hud = new HUD(G);
  // vehicles: procedural models from src/vehicles/armor.js
  try {
    const builders = await import('./vehicles/armor.js');
    const mk = (c, r = 0.6, m = 0.2) => { const x = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }); atmo.patch(x, { key: 'veh' }); return x; };
    const paintCache = new Map();
    const M = {
      paint: (hex) => { if (!paintCache.has(hex)) paintCache.set(hex, mk(hex, 0.62, 0.2)); return paintCache.get(hex); },
      glass: mk('#0d1114', 0.06, 0.5), rubber: mk('#141414', 0.9, 0), metal: mk('#7c7f84', 0.45, 0.8), dark: mk('#26282b', 0.5, 0.7),
      chrome: mk('#c8ccd2', 0.15, 1), canvas: mk('#5b5a45', 0.95, 0),
      light: (() => { const x = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color('#ffe6b8'), emissiveIntensity: 4 }); atmo.patch(x, { key: 'vehlight' }); return x; })(),
    };
    G.vehicles = new Vehicles({ scene, terrain, world, combat, fx, audio, player, agents, builders, M, atmo });
    G.jets = new Jets({ scene, terrain, combat, fx, audio, player, builders, M });
    G.vehicleTargets = () => G.vehicles.list.filter(v => !v.dead);
  } catch (e) { console.warn('vehicles unavailable', e); }

  // test population (replaced by the mission script)
  G.populateVillage = () => {
    const sq = village.points.square;
    for (const hp of village.points.hostage.slice(0, 12)) agents.spawn('civilian', 'hostage', hp, { state: 'hostage', yaw: Math.atan2(sq.x - hp.x, sq.z - hp.z) + Math.PI, burqa: Math.random() < 0.3 });
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * 6.28;
      const p = new THREE.Vector3(sq.x + Math.cos(a) * 14, 0, sq.z + Math.sin(a) * 14);
      p.y = terrain.heightAt(p.x, p.z);
      agents.spawn('fighter', 'guard', p, { state: 'guard' });
    }
    const covers = village.points.cover.filter(c => c.pos.distanceTo(sq) < 140);
    for (let i = 0; i < 16; i++) agents.spawn('fighter', 'rifle', covers[Math.floor(Math.random() * covers.length)].pos, { state: 'idle' });
    const roofs = village.points.roofs.filter(r => r.distanceTo(sq) < 160 && r.distanceTo(sq) > 30);
    for (let i = 0; i < 4; i++) agents.spawn('fighter', 'rpg', roofs[Math.floor(Math.random() * roofs.length)], { state: 'idle', roof: true });
    const streets = village.points.streets;
    for (let i = 0; i < 14; i++) agents.spawn('civilian', 'villager', streets[Math.floor(Math.random() * streets.length)], { state: Math.random() < 0.6 ? 'walk' : 'idle', burqa: Math.random() < 0.25 });
  };
  if (params.get('pop') === 'test') G.populateVillage();
  G.ui = new UI(G);
  if (G.vehicles && params.get('mission') !== '0') {
    G.mission = new Mission(G);
    G.mission.onComplete = (d) => G.ui.debrief(d);
  }
  // title backdrop: the suit cruising with a slow orbiting camera
  if (G.mission) {
    player.locked = true;
    G.hud.visible = false;
    let ang = 1.2;
    rig.cinematic = (dt, cam) => {
      ang += dt * 0.08;
      const fwd = player.vel.clone().normalize();
      cam.position.copy(player.pos).add(new THREE.Vector3(Math.cos(ang) * 11, 2.5, Math.sin(ang) * 11));
      cam.lookAt(player.pos.clone().addScaledVector(fwd, 2));
      cam.fov = 42; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    };
    G.ui.onStart = () => { G.mission.start(); };
  } else {
    G.ui.onStart = () => { player.locked = false; G.hud.visible = true; };
  }

  setProgress(0.9, 'Compiling shaders');
  R.renderer.compile(scene, camera);

  // footsteps, landings and other suit sounds
  anim.onStep = (side, walk, run) => {
    rig.addTrauma(0.06 + run * 0.06);
    const p = anim.sole(side, new THREE.Vector3());
    audio.play('step', p, { vol: 0.55 + run * 0.4, ref: 4, noDelay: true });
    for (let i = 0; i < 4; i++) particles.emit({ kind: 0, pos: p.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 0.8, (Math.random() - 0.5) * 1.5), size: 0.3, grow: 0.9, life: 1.4, drag: 2, color: [0.5, 0.43, 0.34], alpha: 0.35, lit: 1 });
  };

  const handlePlayerEvents = () => {
    for (const e of player.events) {
      if (e.type === 'heroLanding') {
        rig.addTrauma(0.75);
        rig.landCam = rig.landDur = 2.2;
        audio.play('metal_heavy', player.pos, { vol: 1.2, noDelay: true });
        audio.play('explosion_small', player.pos, { vol: 0.5, noDelay: true, rate: 0.7 });
        const gy = player.groundY;
        for (let i = 0; i < 70; i++) {
          const a = Math.random() * 6.283;
          particles.emit({ kind: 0, pos: new THREE.Vector3(player.pos.x + Math.cos(a) * 0.6, gy + 0.2, player.pos.z + Math.sin(a) * 0.6), vel: new THREE.Vector3(Math.cos(a), 0.15 + Math.random() * 0.3, Math.sin(a)).multiplyScalar(8 + Math.random() * 14), size: 0.6 + Math.random() * 0.6, grow: 2.2, life: 1.8 + Math.random() * 2, drag: 2.4, color: [0.55, 0.47, 0.36], alpha: 0.5, lit: 1 });
        }
        fx.scorch(new THREE.Vector3(player.pos.x, gy, player.pos.z), terrain.normalAt(player.pos.x, player.pos.z), 3.5);
      }
      if (e.type === 'crash') { rig.addTrauma(0.95); audio.play('metal_heavy', player.pos, { vol: 1.3, noDelay: true }); audio.play('rubble', player.pos, { vol: 1, noDelay: true }); fx.explosion(player.pos.clone().setY(player.groundY), { size: 0.6, kind: 'small', silent: true }); }
      if (e.type === 'land') { rig.addTrauma(0.15); audio.play('gravel_land', player.pos, { vol: 0.9, noDelay: true }); }
      if (e.type === 'takeoff') { audio.play('servo_fast', player.pos, { vol: 0.5, noDelay: true }); player.takeoffKick = 0; }
      if (e.type === 'boost') { audio.play('sonic_boom', player.pos, { vol: 0.25, noDelay: true, rate: 1.3 }); }
      if (e.type === 'hit') {
        if (e.kind === 'rpg' || e.kind === 'shell' || e.kind === 'missile' || e.kind === 'explosion') { rig.addTrauma(0.6); audio.play('armor_hit_heavy', player.pos, { vol: 1, noDelay: true }); R.flash = 0.35; }
        else { rig.addTrauma(0.03); }
        R.damage = Math.min(1, R.damage + e.damage * 0.03);
      }
    }
    player.events.length = 0;
  };

  input.wantLock = true;
  const STEP = 1 / 120;
  let acc = 0;
  let last = performance.now();
  let fireCooldown = 0;
  G.tick = (dt) => {
    const mouse = input.consumeMouse();
    if (input.hit('KeyV')) rig.view = rig.view === 'tpp' ? 'fpp' : 'tpp';
    // weapons
    const canFight = !['landing', 'knockdown', 'dead'].includes(player.mode) && !player.locked;
    fireCooldown -= dt;
    if (canFight && input.btn('left') && fireCooldown <= 0) { combat.fireRepulsor(); fireCooldown = 0.2; }
    if (canFight && input.btn('right')) { combat.scanning = true; rig.zoom += (1 - rig.zoom) * Math.min(1, dt * 8); }
    else rig.zoom += (0 - rig.zoom) * Math.min(1, dt * 8);
    if (combat.scanning) {
      combat.updateScan(dt, agents.hostiles().concat(G.vehicleTargets ? G.vehicleTargets() : []), agents.liveCivilians());
      if (!input.btn('right')) { combat.scanning = false; if (canFight) combat.launchMicroMissiles(); else combat.locks = []; }
    }
    if (canFight && input.hit('KeyF')) combat.fireRocket(G.vehicleTargets ? G.vehicleTargets() : []);
    if (canFight && input.hit('KeyE')) combat.fireFlares();
    acc += dt * G.timeScale;
    let steps = 0;
    while (acc >= STEP && steps < 8) {
      player.update(STEP, rig.yaw, rig.pitch, rig.forward);
      acc -= STEP; steps++;
    }
    handlePlayerEvents();
    const sdt = dt * G.timeScale;
    tickScheduler(dt, sdt);
    player.aimDir.copy(rig.forward);
    combat.update(sdt, {});
    anim.update(sdt, player.animState());
    suit.updateMatrixWorld(true);
    rig.update(dt, mouse);
    suit.visible = rig.view === 'tpp';
    agents.update(sdt);
    if (G.vehicles) G.vehicles.update(sdt);
    if (G.mission && G.mission.phase !== 'none') G.mission.update(sdt);
    else if (G.jets) G.jets.update(sdt);
    G.jarvis.update(dt);
    player.autoWalk = G.forceWalk || null;
    thrusters.update(sdt, player);
    G.moteAcc = (G.moteAcc || 0) + sdt * 14;
    while (G.moteAcc > 1) {
      G.moteAcc -= 1;
      const cp = camera.position;
      const mp = new THREE.Vector3(cp.x + (Math.random() - 0.5) * 24, cp.y + (Math.random() - 0.5) * 10, cp.z + (Math.random() - 0.5) * 24);
      if (mp.y - terrain.heightAt(mp.x, mp.z) > 25) continue;
      particles.emit({ kind: 2, pos: mp, vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.3) * 0.2, (Math.random() - 0.5) * 0.3), size: 0.025 + Math.random() * 0.03, life: 3 + Math.random() * 3, drag: 0.2, color: [1.6, 1.3, 1.0], alpha: 0.35, fadeIn: 1, curve: 1, wind: 0.6 });
    }
    fx.update(sdt);
    particles.update(sdt, camera);
    atmo.update(sdt);
    terrain.update(camera);
    props.update(camera);
    audio.setListener(camera);
    suitAudio.update(dt, player, rig.view === 'fpp');
    if (G.ambVillage) {
      const dv = Math.hypot(player.pos.x - meta.sites.village.x, player.pos.z - meta.sites.village.z);
      G.ambVillage.set(agents.alerted ? 0.05 : Math.max(0, 1 - dv / 500) * 0.6, 0.5);
      G.ambWind.set(0.25 + Math.min(0.3, player.agl / 600), 0.5);
    }
    R.flash *= Math.exp(-dt * 6);
    R.damage = Math.max(0, R.damage - dt * 0.4 + (player.integrity < 30 ? dt * 0.3 : 0));
    if (G.hud) G.hud.update(dt);
    input.endFrame();
  };
  G.draw = (dt, t) => {
    R.render(scene, camera, dt, t, (depth) => particles.setFrame(R.renderer, depth, R.width, R.height, camera));
    if (G.hud) G.hud.draw();
  };
  G.shot = (name = 'shot', w = 1280, h = 720) => new Promise(res => {
    R.renderer.setSize(w, h, false);
    R.width = w; R.height = h;
    const keep = R.onResize; R.onResize = null;
    R.sceneRT.setSize(w, h); R.mips.forEach((m, i) => m.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))));
    R.finalMat.uniforms.uRes.value.set(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix(); atmo.csm.updateFrustums();
    terrain.update(camera);
    props.update(camera, true);
    particles.update(0, camera);
    R.aeReset = true;
    R.render(scene, camera, 0, performance.now() / 1000, (depth) => particles.setFrame(R.renderer, depth, R.width, R.height, camera));
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const o2 = out.getContext('2d');
    o2.drawImage(canvas, 0, 0, w, h);
    if (G.hud && G.hud.visible) {
      const H = G.hud, sw = H.W, sh = H.H, sd = H.dpr;
      H.W = w; H.H = h; H.dpr = 1; H.canvas.width = w; H.canvas.height = h;
      H.draw();
      o2.drawImage(H.canvas, 0, 0);
      H.W = sw; H.H = sh; H.dpr = sd; H.resize();
    }
    out.toBlob(b => {
      fetch('/shot?name=' + name, { method: 'POST', body: b }).then(() => { R.onResize = keep; R.resize(); res(name); });
    }, 'image/jpeg', 0.92);
  });
  G.startAudio = async () => {
    if (!audio.ready && !G.audioStarting) {
      G.audioStarting = true;
      await audio.init(); await suitAudio.start();
      G.ambWind = await audio.loop('desert_wind_loop', { vol: 0.35, bus: 'amb' });
      G.ambVillage = await audio.loop('village_ambience_loop', { vol: 0, bus: 'amb' });
    }
    audio.resume();
  };
  canvas.addEventListener('mousedown', () => G.startAudio());
  addEventListener('keydown', () => G.startAudio(), { once: true });
  const frame = (now) => {
    const dt = Math.min(1 / 20, (now - last) / 1000);
    last = now;
    if (!G.paused) G.tick(dt);
    G.draw(dt, now / 1000);
    requestAnimationFrame(frame);
  };
  setProgress(1, 'Ready');
  loading.classList.add('done');
  requestAnimationFrame(frame);
}

boot().catch(err => {
  console.error(err);
  loading.querySelector('.ld-msg').textContent = 'Error: ' + err.message;
});
