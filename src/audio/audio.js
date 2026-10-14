// WebAudio engine: positional one-shots with air absorption and speed-of-sound delay, loops, music, ducking.
import * as THREE from 'three';

const SOUND_SPEED = 343;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.entries = new Map();
    this.variants = new Map();
    this.listenerPos = new THREE.Vector3();
    this.ready = false;
    this.muted = false;
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.25;
    this.master = c.createGain(); this.master.gain.value = 0.9;
    this.master.connect(this.comp); this.comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = 0.6; this.amb.connect(this.master);
    this.ui = c.createGain(); this.ui.gain.value = 0.5; this.ui.connect(this.master);
    this.suitBus = c.createGain(); this.suitBus.connect(this.sfx);
    // short convolution reverb for outdoor slap
    this.verb = c.createConvolver();
    this.verb.buffer = this.makeIR(2.6);
    this.verbSend = c.createGain(); this.verbSend.gain.value = 0.22;
    this.verbSend.connect(this.verb); this.verb.connect(this.master);
    const [a, b] = await Promise.all([fetch('assets/audio/manifest.json').then(r => r.json()), fetch('assets/audio/mz/manifest.json').then(r => r.json())]);
    for (const [k, v] of Object.entries(a.sfx)) this.entries.set(k, v);
    for (const [k, v] of Object.entries(a.music || {})) this.entries.set(k, { ...v, music: true });
    for (const [k, v] of Object.entries(b.sfx)) this.entries.set(k, v);
    this.entries.set('faceplate_close', { file: 'assets/audio/mz/faceplate_close.mp3' });
    for (const k of this.entries.keys()) {
      const m = k.match(/^(.*)_(\d+)$/);
      if (m) { if (!this.variants.has(m[1])) this.variants.set(m[1], []); this.variants.get(m[1]).push(k); }
    }
    this.variants.set('step', [...this.entries.keys()].filter(k => k.startsWith('step_')));
    this.variants.set('repulsor_fire', ['repulsor_fire_a', 'repulsor_fire_b', 'repulsor_fire_c', 'jurek_repulsor_01', 'jurek_repulsor_02', 'jurek_repulsor_03', 'jurek_repulsor_04']);
    this.variants.set('metal_hit', ['metal_a', 'metal_b', 'metal_c', 'metal_d']);
    this.ready = true;
    this.preload();
  }

  makeIR(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const t = i / c.sampleRate;
        const early = t < 0.25 && Math.random() < 0.004 ? (Math.random() - 0.5) * 0.9 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2) * 0.35 + early) * (t < 0.02 ? t / 0.02 : 1);
      }
    }
    return buf;
  }

  async preload() {
    const names = [...this.entries.keys()].filter(k => !this.entries.get(k).music);
    for (let i = 0; i < names.length; i += 8) await Promise.all(names.slice(i, i + 8).map(n => this.buffer(n).catch(() => null)));
  }

  async buffer(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    const e = this.entries.get(name);
    if (!e) throw new Error('no sound ' + name);
    const p = fetch(e.file).then(r => r.arrayBuffer()).then(ab => this.ctx.decodeAudioData(ab));
    this.buffers.set(name, p);
    return p;
  }

  resolve(name) {
    if (this.entries.has(name)) return name;
    const v = this.variants.get(name);
    if (v && v.length) return v[Math.floor(Math.random() * v.length)];
    return null;
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }

  setListener(camera) {
    this.listenerPos.copy(camera.position);
    if (!this.ctx) return;
    const L = this.ctx.listener, p = camera.position;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.setTargetAtTime(u.x, t, 0.02); L.upY.setTargetAtTime(u.y, t, 0.02); L.upZ.setTargetAtTime(u.z, t, 0.02);
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }

  // positional or 2D one-shot
  async play(name, pos = null, { vol = 1, rate = 1, ref = 12, bus = 'sfx', noDelay = false, detune = 0.06, verb = 0.25 } = {}) {
    if (!this.ready || this.muted) return null;
    const key = this.resolve(name);
    if (!key) return null;
    let buf;
    try { buf = await this.buffer(key); } catch (e) { return null; }
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * detune);
    const e = this.entries.get(key);
    const g = c.createGain();
    const norm = e && e.lufs ? Math.pow(10, (-16 - e.lufs) / 20) : 1;
    g.gain.value = vol * Math.min(4, norm);
    let node = src;
    let delay = 0;
    if (pos) {
      const d = pos.distanceTo(this.listenerPos);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(700, 20000 * Math.exp(-d / 900));
      const pan = c.createPanner();
      pan.panningModel = d < 120 ? 'HRTF' : 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = ref; pan.rolloffFactor = 1; pan.maxDistance = 20000;
      pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z;
      node.connect(lp); lp.connect(pan); node = pan;
      if (!noDelay) delay = Math.min(6, d / SOUND_SPEED);
      const s2 = c.createGain(); s2.gain.value = verb * Math.min(1, 0.3 + d / 600);
      pan.connect(s2); s2.connect(this.verbSend);
    }
    node.connect(g);
    g.connect(this[bus] || this.sfx);
    src.start(c.currentTime + delay);
    return { src, gain: g };
  }

  async loop(name, { vol = 0, bus = 'sfx', pos = null, ref = 20, rate = 1 } = {}) {
    if (!this.ready) return null;
    const key = this.resolve(name);
    if (!key) return null;
    let buf;
    try { buf = await this.buffer(key); } catch (e) { return null; }
    const c = this.ctx, e = this.entries.get(key);
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    if (e && e.loopEnd) { src.loopStart = e.loopStart || 0.03; src.loopEnd = e.loopEnd; }
    src.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = vol;
    let pan = null;
    if (pos) {
      pan = c.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = ref; pan.rolloffFactor = 1;
      pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z;
      src.connect(pan); pan.connect(g);
    } else src.connect(g);
    g.connect(this[bus] || this.sfx);
    src.start(c.currentTime + Math.random() * 0.05, (e && e.loopStart) || 0);
    const h = {
      src, g, pan,
      set: (v, tc = 0.08) => g.gain.setTargetAtTime(Math.max(0, v), c.currentTime, tc),
      rate: (r, tc = 0.1) => src.playbackRate.setTargetAtTime(r, c.currentTime, tc),
      at: (p) => { if (pan) { pan.positionX.setTargetAtTime(p.x, c.currentTime, 0.03); pan.positionY.setTargetAtTime(p.y, c.currentTime, 0.03); pan.positionZ.setTargetAtTime(p.z, c.currentTime, 0.03); } },
      stop: (fade = 0.3) => { g.gain.setTargetAtTime(0, c.currentTime, fade / 3); setTimeout(() => { try { src.stop(); } catch (e) { } }, fade * 1000 + 50); },
    };
    return h;
  }

  async playMusic(name, { vol = 1, fade = 2.5, loop = true } = {}) {
    if (!this.ready) return;
    if (this.currentMusic && this.currentMusic.name === name) return;
    const old = this.currentMusic;
    if (old) old.h.stop(fade);
    const h = await this.loop(name, { vol: 0, bus: 'music' });
    if (!h) return;
    if (!loop) h.src.loop = false;
    h.set(vol, fade / 3);
    this.currentMusic = { name, h };
  }

  stopMusic(fade = 2) { if (this.currentMusic) { this.currentMusic.h.stop(fade); this.currentMusic = null; } }

  duck(amount = 0.4, dur = 1.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setTargetAtTime(0.32 * amount, t, 0.1);
    this.music.gain.setTargetAtTime(0.32, t + dur, 0.6);
  }
}

// Suit engine: layered thrusters, airflow and footsteps, all driven by the flight state.
export class SuitAudio {
  constructor(audio) {
    this.a = audio;
    this.layers = {};
    this.started = false;
  }
  async start() {
    if (this.started || !this.a.ready) return;
    this.started = true;
    const L = this.layers;
    for (const n of ['thruster_idle', 'thruster_mid', 'thruster_whine', 'thruster_hot', 'thruster_sub', 'wind_low', 'wind_high', 'wind_gust', 'reactor']) {
      L[n] = await this.a.loop(n, { vol: 0, bus: 'suitBus' });
    }
  }
  update(dt, player, fpp) {
    if (!this.started) return;
    const L = this.layers;
    const m = player.mode;
    const th = m === 'hover' || m === 'flight' ? player.thrust : m === 'landing' ? Math.max(0, 0.8 - player.landT * 2) : 0;
    const sp = player.vel.length();
    const sk = Math.min(1, sp / 280);
    const boost = player.boosting ? 1 : 0;
    const set = (n, v, r) => { if (L[n]) { L[n].set(v, 0.12); if (r) L[n].rate(r, 0.2); } };
    set('thruster_idle', th > 0 ? 0.25 + 0.2 * (1 - th) : 0.0, 0.9 + th * 0.2);
    set('thruster_mid', th * 0.45 + boost * 0.15, 0.85 + th * 0.35 + boost * 0.1);
    set('thruster_whine', th * 0.12 + sk * 0.12, 0.9 + sk * 0.5);
    set('thruster_hot', Math.max(0, th - 0.5) * 0.5 + boost * 0.3, 1 + boost * 0.1);
    set('thruster_sub', th * 0.5 + boost * 0.3, 1);
    set('wind_low', Math.min(0.5, sp / 120) * 0.6, 0.9 + sk * 0.4);
    set('wind_high', Math.max(0, sk - 0.25) * 0.75, 0.8 + sk * 0.6);
    set('wind_gust', Math.max(0, sk - 0.5) * 0.6, 1);
    set('reactor', fpp ? 0.18 : 0.04, 1);
    this.a.suitBus.gain.setTargetAtTime(fpp ? 0.85 : 1.0, this.a.ctx.currentTime, 0.2);
  }
}
