// DOM screens: title, controls, settings, pause, failure flash and the mission debrief.
const SETTINGS_KEY = 'gulmira-settings';

export function loadSettings() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const autoScale = Math.max(0.4, Math.min(1, Math.sqrt(1.35e6 / (innerWidth * innerHeight * dpr * dpr))));
  const def = { scale: Math.round(autoScale * 20) / 20, motion: true, sens: 1, invert: false, volume: 0.9, voice: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (e) { return def; }
}
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { } }

const CSS = `
#ui .scr { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: auto; color: #e9e3d6; font-family: 'Rajdhani', sans-serif; z-index: 5; }
#ui .scr.hidden { display: none; }
#ui .title { background: radial-gradient(120% 90% at 50% 60%, rgba(10,8,6,0.15), rgba(4,4,4,0.82)); flex-direction: column; }
#ui .title h1 { font-weight: 500; letter-spacing: 0.85em; font-size: 54px; margin: 0; padding-left: 0.85em; color: #efe9dc; }
#ui .title .sub { font-family: 'Share Tech Mono', monospace; letter-spacing: 0.35em; font-size: 12px; color: rgba(233,227,214,0.55); margin-top: 14px; }
#ui .menu { margin-top: 46px; display: flex; flex-direction: column; gap: 10px; min-width: 300px; }
#ui button.b { background: rgba(255,255,255,0.03); border: 1px solid rgba(233,227,214,0.22); color: #e9e3d6; font-family: 'Rajdhani', sans-serif; font-weight: 600; letter-spacing: 0.3em; font-size: 14px; padding: 12px 18px; cursor: pointer; transition: background 0.2s, border-color 0.2s; text-align: left; }
#ui button.b:hover { background: rgba(255,184,77,0.09); border-color: rgba(255,184,77,0.7); }
#ui button.b.primary { border-color: rgba(255,184,77,0.75); }
#ui .panel { background: rgba(6,7,8,0.86); border: 1px solid rgba(233,227,214,0.14); padding: 28px 34px; min-width: 460px; max-width: 640px; }
#ui .panel h2 { font-weight: 500; letter-spacing: 0.45em; font-size: 18px; margin: 0 0 18px; }
#ui table.keys { border-collapse: collapse; width: 100%; font-size: 15px; }
#ui table.keys td { padding: 4px 6px; border-bottom: 1px solid rgba(255,255,255,0.05); }
#ui table.keys td:first-child { font-family: 'Share Tech Mono', monospace; color: #ffb84d; width: 150px; font-size: 13px; }
#ui .row { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin: 10px 0; font-size: 15px; }
#ui input[type=range] { width: 200px; accent-color: #ffb84d; }
#ui .stats { display: grid; grid-template-columns: 1fr auto; gap: 6px 24px; font-size: 16px; margin: 6px 0 20px; }
#ui .stats span:nth-child(even) { font-family: 'Share Tech Mono', monospace; text-align: right; }
#ui .rank { font-size: 64px; font-weight: 500; letter-spacing: 0.2em; color: #ffb84d; text-align: center; margin: 4px 0 10px; }
#ui .hint { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); font-family: 'Share Tech Mono', monospace; font-size: 12px; letter-spacing: 0.2em; color: rgba(233,227,214,0.6); pointer-events: none; }
#ui .fade { position: fixed; inset: 0; background: #000; opacity: 0; pointer-events: none; transition: opacity 0.8s; z-index: 4; }
`;

const KEYS = [
  ['MOUSE', 'Look / steer'], ['W A S D', 'Move (ground, hover) / throttle (flight)'], ['SPACE', 'Take off, climb'], ['CTRL / C', 'Descend, land'],
  ['SHIFT + W', 'Fly / boost'], ['S (flight)', 'Air brake to hover'], ['LEFT MOUSE', 'Repulsors'], ['RIGHT MOUSE', 'Hold to lock micro-missiles, release to fire'],
  ['F', 'Forearm anti-tank rocket'], ['E', 'Flares'], ['V', 'Helmet view'], ['ESC', 'Pause'],
];

export class UI {
  constructor(G) {
    this.G = G;
    this.root = document.getElementById('ui');
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.settings = loadSettings();
    this.root.innerHTML = `
      <div class="scr title" id="scr-title">
        <h1>GULMIRA</h1>
        <div class="sub">MARK III  ·  ONE MISSION  ·  KUNAR VALLEY</div>
        <div class="menu">
          <button class="b primary" data-a="start">BEGIN MISSION</button>
          <button class="b" data-a="controls">CONTROLS</button>
          <button class="b" data-a="settings">SETTINGS</button>
        </div>
      </div>
      <div class="scr hidden" id="scr-controls"><div class="panel"><h2>CONTROLS</h2><table class="keys">${KEYS.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table><div class="menu" style="margin-top:22px"><button class="b" data-a="back">BACK</button></div></div></div>
      <div class="scr hidden" id="scr-settings"><div class="panel"><h2>SETTINGS</h2>
        <div class="row"><span>Render resolution</span><input type="range" min="0.3" max="1" step="0.05" id="set-scale"></div>
        <div class="row"><span>Mouse sensitivity</span><input type="range" min="0.3" max="2.5" step="0.05" id="set-sens"></div>
        <div class="row"><span>Invert mouse Y</span><input type="checkbox" id="set-invert"></div>
        <div class="row"><span>Motion blur</span><input type="checkbox" id="set-motion"></div>
        <div class="row"><span>Volume</span><input type="range" min="0" max="1" step="0.05" id="set-volume"></div>
        <div class="row"><span>JARVIS voice</span><input type="checkbox" id="set-voice"></div>
        <div class="menu" style="margin-top:18px"><button class="b" data-a="back">BACK</button></div></div></div>
      <div class="scr hidden" id="scr-pause"><div class="panel"><h2>PAUSED</h2><div class="menu" style="margin-top:0">
        <button class="b primary" data-a="resume">RESUME</button>
        <button class="b" data-a="checkpoint">RESTART CHECKPOINT</button>
        <button class="b" data-a="controls">CONTROLS</button>
        <button class="b" data-a="settings">SETTINGS</button>
        <button class="b" data-a="restart">RESTART MISSION</button></div></div></div>
      <div class="scr hidden" id="scr-debrief"><div class="panel"><h2>MISSION COMPLETE</h2><div class="rank" id="db-rank">A</div><div class="stats" id="db-stats"></div>
        <div class="menu" style="margin-top:0"><button class="b primary" data-a="restart">FLY IT AGAIN</button></div></div></div>
      <div class="hint" id="ui-hint"></div>
      <div class="fade" id="ui-fade"></div>`;
    this.prev = 'scr-title';
    this.root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
      this.G.startAudio && this.G.startAudio();
      this.action(a.dataset.a);
    });
    const bind = (id, key, fn) => {
      const el = document.getElementById(id);
      if (el.type === 'checkbox') el.checked = !!this.settings[key]; else el.value = this.settings[key];
      el.addEventListener('input', () => { this.settings[key] = el.type === 'checkbox' ? el.checked : parseFloat(el.value); saveSettings(this.settings); fn(this.settings[key]); });
    };
    bind('set-scale', 'scale', v => this.G.R.setScale(v));
    bind('set-sens', 'sens', v => { this.G.input.sensitivity = 0.0021 * v; });
    bind('set-invert', 'invert', v => { this.G.input.invertY = v; });
    bind('set-motion', 'motion', v => { this.G.R.params.motion = v ? 0.55 : 0; });
    bind('set-volume', 'volume', v => { if (this.G.audio.master) this.G.audio.master.gain.value = v; });
    bind('set-voice', 'voice', v => { this.G.jarvis.volume = v ? 1 : 0; });
    this.apply();
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'playing') this.pause();
    });
    this.G.input.onLockChange = (locked) => { if (!locked && this.state === 'playing') this.pause(); };
    this.state = 'title';
  }

  apply() {
    const s = this.settings, G = this.G;
    G.R.setScale(s.scale);
    G.input.sensitivity = 0.0021 * s.sens;
    G.input.invertY = s.invert;
    G.R.params.motion = s.motion ? 0.55 : 0;
    G.jarvis.volume = s.voice ? 1 : 0;
  }

  show(id) { for (const el of this.root.querySelectorAll('.scr')) el.classList.toggle('hidden', el.id !== id); }
  hideAll() { for (const el of this.root.querySelectorAll('.scr')) el.classList.add('hidden'); }
  hint(text) { document.getElementById('ui-hint').textContent = text || ''; }

  action(a) {
    const G = this.G;
    if (a === 'start') { this.hideAll(); this.state = 'playing'; G.input.lock(); G.paused = false; if (this.onStart) this.onStart(); }
    if (a === 'controls') { this.prevScreen = this.state === 'paused' ? 'scr-pause' : 'scr-title'; this.show('scr-controls'); }
    if (a === 'settings') { this.prevScreen = this.state === 'paused' ? 'scr-pause' : 'scr-title'; this.show('scr-settings'); }
    if (a === 'back') this.show(this.prevScreen || 'scr-title');
    if (a === 'resume') { this.hideAll(); this.state = 'playing'; G.paused = false; G.input.lock(); this.resumeAudio(); }
    if (a === 'checkpoint') { this.hideAll(); this.state = 'playing'; G.paused = false; G.input.lock(); this.resumeAudio(); G.mission && G.mission.respawn(); }
    if (a === 'restart') { location.reload(); }
  }

  pause() {
    this.state = 'paused';
    this.G.paused = true;
    this.G.input.unlock();
    this.show('scr-pause');
    if (this.G.audio.ctx) this.G.audio.ctx.suspend();
  }

  resumeAudio() { if (this.G.audio.ctx) this.G.audio.ctx.resume(); }

  debrief(d) {
    this.state = 'debrief';
    this.G.input.unlock();
    const mm = Math.floor(d.time / 60), ss = Math.floor(d.time % 60).toString().padStart(2, '0');
    document.getElementById('db-rank').textContent = d.rank;
    document.getElementById('db-stats').innerHTML = [
      ['Mission time', `${mm}:${ss}`], ['Hostiles neutralised', d.kills], ['Vehicles destroyed', d.vehicles], ['Civilian casualties', d.civilians],
      ['Repulsor accuracy', Math.round(d.accuracy * 100) + '%'], ['Micro-missiles fired', d.missiles], ['Walked away from the tank', d.walkAway ? 'Yes' : 'No'],
    ].map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
    this.show('scr-debrief');
  }

  fade(on) { document.getElementById('ui-fade').style.opacity = on ? 1 : 0; }
}
