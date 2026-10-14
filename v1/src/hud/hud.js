// Mk III helmet HUD on a 2D canvas: compass, telemetry, reticle, multi-lock targeting, threats, objectives, subtitles.
import * as THREE from 'three';

const C = {
  main: 'rgba(222,240,255,', dim: 'rgba(180,205,225,', warn: 'rgba(255,184,77,', red: 'rgba(255,72,58,', civ: 'rgba(160,215,255,',
};
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class HUD {
  constructor(G) {
    this.G = G;
    this.canvas = document.getElementById('hud');
    this.ctx = this.canvas.getContext('2d');
    this.t = 0;
    this.hitMarker = 0;
    this.killText = [];
    this.banner = null;
    this.glitch = 0;
    this.lag = { x: 0, y: 0 };
    this.lastYaw = 0; this.lastPitch = 0;
    this.lockAnim = new Map();
    this.visible = true;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.dpr = dpr;
    this.W = innerWidth; this.H = innerHeight;
    this.canvas.width = Math.max(1, this.W * dpr); this.canvas.height = Math.max(1, this.H * dpr);
  }

  showBanner(title, sub = '', dur = 4) { this.banner = { title, sub, t: dur, dur }; }
  hit() { this.hitMarker = 0.25; }
  kill(text) { this.killText.push({ text, t: 2.2 }); if (this.killText.length > 4) this.killText.shift(); }

  update(dt) {
    this.t += dt;
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    for (const k of this.killText) k.t -= dt;
    this.killText = this.killText.filter(k => k.t > 0);
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    this.glitch = Math.max(0, this.glitch - dt * 2.5);
    const rig = this.G.rig;
    const dyaw = rig.yaw - this.lastYaw, dp = rig.pitch - this.lastPitch;
    this.lastYaw = rig.yaw; this.lastPitch = rig.pitch;
    const fpp = rig.view === 'fpp';
    const k = fpp ? 260 : 90;
    this.lag.x += (dyaw * k - this.lag.x) * Math.min(1, dt * 10);
    this.lag.y += (-dp * k - this.lag.y) * Math.min(1, dt * 10);
  }

  project(p, out) {
    const cam = this.G.camera;
    _v.copy(p).project(cam);
    out.x = (_v.x * 0.5 + 0.5) * this.W;
    out.y = (-_v.y * 0.5 + 0.5) * this.H;
    out.z = _v.z;
    out.behind = _v.z > 1;
    return out;
  }

  draw() {
    const g = this.ctx, G = this.G, W = this.W, H = this.H;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!this.visible || !G.player) return;
    const P = G.player, rig = G.rig;
    const fpp = rig.view === 'fpp';
    const jx = this.glitch > 0 ? (Math.random() - 0.5) * 12 * this.glitch : 0;
    g.save();
    g.translate(this.lag.x + jx, this.lag.y);
    g.lineCap = 'round';
    const a = fpp ? 0.85 : 0.7;
    this.drawCompass(g, W / 2, 34, a);
    this.drawTelemetry(g, a);
    this.drawStatus(g, W - 150, H - 150, a);
    this.drawWeapons(g, W / 2, H - 46, a);
    this.drawObjective(g, a);
    this.drawWaypoint(g, a);
    this.drawTargets(g, a);
    this.drawThreats(g);
    this.drawReticle(g, W / 2, H / 2, a);
    g.restore();
    if (fpp) this.drawHelmet(g);
    this.drawSubtitle(g);
    this.drawBanner(g);
    if (this.glitch > 0.05) {
      g.globalAlpha = this.glitch * 0.4;
      for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? 'rgba(255,80,60,0.5)' : 'rgba(120,220,255,0.4)'; g.fillRect(0, Math.random() * H, W, 1 + Math.random() * 3); }
      g.globalAlpha = 1;
    }
  }

  text(g, s, x, y, { size = 12, color = C.main, alpha = 0.85, align = 'left', mono = false, weight = 500, spacing = 0 } = {}) {
    g.font = `${weight} ${size}px ${mono ? "'Share Tech Mono', monospace" : "'Rajdhani', sans-serif"}`;
    g.textAlign = align;
    g.fillStyle = color + alpha + ')';
    if (spacing && g.letterSpacing !== undefined) g.letterSpacing = spacing + 'px';
    g.fillText(s, x, y);
    if (spacing && g.letterSpacing !== undefined) g.letterSpacing = '0px';
  }

  drawCompass(g, cx, cy, a) {
    const yaw = this.G.rig.yaw;
    let hd = (-yaw * 180 / Math.PI) % 360; if (hd < 0) hd += 360;
    const span = 110, w = 420;
    g.strokeStyle = C.main + (a * 0.55) + ')';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - w / 2, cy); g.lineTo(cx + w / 2, cy); g.stroke();
    for (let d = Math.ceil((hd - span / 2) / 5) * 5; d <= hd + span / 2; d += 5) {
      const x = cx + (d - hd) / span * w;
      const dd = ((d % 360) + 360) % 360;
      const major = dd % 30 === 0;
      const fade = 1 - Math.abs(x - cx) / (w / 2);
      g.strokeStyle = C.main + (a * fade * 0.8) + ')';
      g.beginPath(); g.moveTo(x, cy); g.lineTo(x, cy + (major ? 9 : dd % 10 === 0 ? 6 : 3)); g.stroke();
      if (major) {
        const lbl = { 0: 'N', 90: 'E', 180: 'S', 270: 'W', 30: '30', 60: '60', 120: '120', 150: '150', 210: '210', 240: '240', 300: '300', 330: '330' }[dd];
        this.text(g, lbl, x, cy + 22, { size: dd % 90 === 0 ? 13 : 10, alpha: a * fade, align: 'center', weight: 600 });
      }
    }
    g.strokeStyle = C.main + a + ')';
    g.strokeRect(cx - 22, cy - 22, 44, 15);
    this.text(g, String(Math.round(hd) % 360).padStart(3, '0'), cx, cy - 10.5, { size: 12, mono: true, align: 'center', alpha: a });
    const wp = this.G.mission && this.G.mission.waypoint;
    if (wp) {
      const P = this.G.player.pos;
      let b = Math.atan2(wp.x - P.x, -(wp.z - P.z)) * 180 / Math.PI; if (b < 0) b += 360;
      let rel = b - hd; while (rel > 180) rel -= 360; while (rel < -180) rel += 360;
      const x = cx + THREE.MathUtils.clamp(rel / span, -0.5, 0.5) * w;
      g.fillStyle = C.warn + a + ')';
      g.beginPath(); g.moveTo(x, cy - 3); g.lineTo(x + 5, cy - 9); g.lineTo(x - 5, cy - 9); g.closePath(); g.fill();
    }
  }

  drawTelemetry(g, a) {
    const P = this.G.player, W = this.W, H = this.H;
    const spd = P.vel.length();
    const mach = spd / 330;
    const x = 64, y = H * 0.5;
    // speed ladder
    g.strokeStyle = C.main + (a * 0.45) + ')';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y - 140); g.lineTo(x, y + 140); g.stroke();
    const kmh = spd * 3.6;
    for (let v = Math.floor((kmh - 280) / 20) * 20; v <= kmh + 280; v += 20) {
      const yy = y - (v - kmh) / 2;
      if (yy < y - 140 || yy > y + 140 || v < 0) continue;
      const fade = 1 - Math.abs(yy - y) / 140;
      g.strokeStyle = C.main + (a * fade * 0.6) + ')';
      g.beginPath(); g.moveTo(x, yy); g.lineTo(x + (v % 100 === 0 ? 10 : 5), yy); g.stroke();
      if (v % 100 === 0) this.text(g, String(v), x + 14, yy + 4, { size: 10, mono: true, alpha: a * fade * 0.8 });
    }
    g.strokeStyle = C.main + a + ')';
    g.strokeRect(x - 52, y - 9, 48, 18);
    this.text(g, Math.round(kmh).toString(), x - 28, y + 5, { size: 13, mono: true, align: 'center', alpha: a });
    this.text(g, 'KM/H', x - 28, y - 14, { size: 9, align: 'center', alpha: a * 0.7, spacing: 1 });
    this.text(g, 'MACH ' + mach.toFixed(2), x - 52, y + 32, { size: 11, mono: true, alpha: a * 0.85 });
    // altitude ladder
    const ax = W - 64;
    const agl = Math.max(0, P.agl), asl = P.pos.y + 1650;
    g.strokeStyle = C.main + (a * 0.45) + ')';
    g.beginPath(); g.moveTo(ax, y - 140); g.lineTo(ax, y + 140); g.stroke();
    for (let v = Math.floor((asl - 140) / 10) * 10; v <= asl + 140; v += 10) {
      const yy = y - (v - asl);
      if (yy < y - 140 || yy > y + 140) continue;
      const fade = 1 - Math.abs(yy - y) / 140;
      g.strokeStyle = C.main + (a * fade * 0.6) + ')';
      g.beginPath(); g.moveTo(ax, yy); g.lineTo(ax - (v % 50 === 0 ? 10 : 5), yy); g.stroke();
      if (v % 50 === 0) this.text(g, String(v), ax - 14, yy + 4, { size: 10, mono: true, alpha: a * fade * 0.8, align: 'right' });
    }
    g.strokeStyle = C.main + a + ')';
    g.strokeRect(ax + 4, y - 9, 56, 18);
    this.text(g, Math.round(asl).toString(), ax + 32, y + 5, { size: 13, mono: true, align: 'center', alpha: a });
    this.text(g, 'ALT M', ax + 32, y - 14, { size: 9, align: 'center', alpha: a * 0.7, spacing: 1 });
    this.text(g, 'AGL ' + Math.round(agl), ax + 4, y + 32, { size: 11, mono: true, alpha: a * 0.85 });
    const vs = P.vel.y;
    this.text(g, (vs >= 0 ? '+' : '') + vs.toFixed(1) + ' V/S', ax + 4, y + 46, { size: 10, mono: true, alpha: a * 0.6 });
    const mode = { ground: 'GROUND', hover: 'HOVER', flight: P.boosting ? 'FLIGHT  BOOST' : 'FLIGHT', landing: 'LANDING', knockdown: 'STABILIZING', dead: 'SUIT FAILURE' }[P.mode] || '';
    this.text(g, mode, x - 52, y + 60, { size: 11, alpha: a * 0.85, weight: 600, spacing: 2, color: P.mode === 'knockdown' ? C.warn : C.main });
  }

  drawStatus(g, cx, cy, a) {
    const P = this.G.player;
    const integ = P.integrity / 100;
    // arc reactor ring with integrity arc
    g.lineWidth = 1;
    g.strokeStyle = C.main + (a * 0.3) + ')';
    g.beginPath(); g.arc(cx, cy, 62, 0, Math.PI * 2); g.stroke();
    const col = integ < 0.3 ? C.red : integ < 0.6 ? C.warn : C.main;
    g.lineWidth = 3;
    g.strokeStyle = col + a + ')';
    g.beginPath(); g.arc(cx, cy, 62, -Math.PI / 2, -Math.PI / 2 + integ * Math.PI * 2); g.stroke();
    g.lineWidth = 1;
    for (let i = 0; i < 36; i++) {
      const an = i / 36 * Math.PI * 2 + this.t * 0.2;
      g.strokeStyle = C.main + (a * 0.25) + ')';
      g.beginPath(); g.moveTo(cx + Math.cos(an) * 70, cy + Math.sin(an) * 70); g.lineTo(cx + Math.cos(an) * (i % 3 ? 73 : 77), cy + Math.sin(an) * (i % 3 ? 73 : 77)); g.stroke();
    }
    // suit silhouette
    g.save();
    g.translate(cx, cy + 4);
    g.scale(0.9, 0.9);
    const part = (path, health) => {
      g.strokeStyle = (health < 0.35 ? C.red : health < 0.65 ? C.warn : C.main) + (a * 0.9) + ')';
      g.fillStyle = (health < 0.35 ? C.red : health < 0.65 ? C.warn : C.main) + (a * 0.12) + ')';
      g.beginPath(); path(); g.fill(); g.stroke();
    };
    const hh = (o) => Math.min(1, integ + o);
    part(() => g.ellipse(0, -44, 7, 9, 0, 0, Math.PI * 2), hh(0.1));
    part(() => { g.moveTo(-15, -32); g.lineTo(15, -32); g.lineTo(11, -4); g.lineTo(-11, -4); g.closePath(); }, hh(0));
    part(() => { g.moveTo(-10, -2); g.lineTo(10, -2); g.lineTo(9, 8); g.lineTo(-9, 8); g.closePath(); }, hh(0.05));
    part(() => { g.moveTo(-19, -31); g.lineTo(-24, -6); g.lineTo(-22, 14); g.lineTo(-17, 14); g.lineTo(-17, -10); g.closePath(); }, hh(0.15));
    part(() => { g.moveTo(19, -31); g.lineTo(24, -6); g.lineTo(22, 14); g.lineTo(17, 14); g.lineTo(17, -10); g.closePath(); }, hh(0.12));
    part(() => { g.moveTo(-9, 10); g.lineTo(-2, 10); g.lineTo(-3, 46); g.lineTo(-10, 46); g.closePath(); }, hh(0.2));
    part(() => { g.moveTo(9, 10); g.lineTo(2, 10); g.lineTo(3, 46); g.lineTo(10, 46); g.closePath(); }, hh(0.18));
    g.fillStyle = 'rgba(200,235,255,' + (0.6 + 0.4 * Math.sin(this.t * 3)) + ')';
    g.beginPath(); g.arc(0, -20, 2.5, 0, Math.PI * 2); g.fill();
    g.restore();
    this.text(g, 'INTEGRITY', cx, cy + 86, { size: 9, align: 'center', alpha: a * 0.7, spacing: 2 });
    this.text(g, Math.round(P.integrity) + '%', cx, cy + 100, { size: 14, align: 'center', mono: true, color: col, alpha: a });
    const pwr = 340 + Math.sin(this.t * 0.7) * 8 + P.thrust * 60;
    this.text(g, 'PWR ' + Math.round(pwr) + '%', cx - 62, cy - 72, { size: 10, mono: true, alpha: a * 0.7 });
    this.text(g, 'MK III', cx + 62, cy - 72, { size: 10, align: 'right', alpha: a * 0.7, weight: 600, spacing: 1 });
  }

  drawWeapons(g, cx, cy, a) {
    const C2 = this.G.combat;
    const items = [
      { key: 'LMB', name: 'REPULSOR', draw: (x, y) => { g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.stroke(); }, active: C2.aimHold.R > 0 || C2.aimHold.L > 0 },
      { key: 'RMB', name: 'MICRO MSL', draw: (x, y) => { for (let i = 0; i < 3; i++) { const an = i * 2.094 - Math.PI / 2; g.beginPath(); g.arc(x + Math.cos(an) * 5, y + Math.sin(an) * 5, 2.2, 0, Math.PI * 2); g.stroke(); } }, active: C2.scanning, count: C2.scanning ? C2.locks.length : null },
      { key: 'F', name: 'AT ROCKET', draw: (x, y) => { g.beginPath(); g.moveTo(x - 7, y + 3); g.lineTo(x + 4, y + 3); g.lineTo(x + 8, y); g.lineTo(x + 4, y - 3); g.lineTo(x - 7, y - 3); g.closePath(); g.stroke(); }, active: this.G.anim.hatch.L > 0.2 },
      { key: 'E', name: 'FLARES', draw: (x, y) => { for (let i = 0; i < 5; i++) { const an = -Math.PI / 2 + (i - 2) * 0.45; g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x + Math.cos(an) * 8, y + 4 + Math.sin(an) * 8); g.stroke(); } }, active: C2.decoys.length > 0 },
    ];
    const gap = 74;
    items.forEach((it, i) => {
      const x = cx + (i - 1.5) * gap, y = cy;
      const act = it.active;
      g.lineWidth = act ? 1.6 : 1;
      g.strokeStyle = (act ? C.warn : C.main) + (a * (act ? 1 : 0.6)) + ')';
      g.beginPath(); g.arc(x, y, 17, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 1.2;
      it.draw(x, y);
      this.text(g, it.name, x, y + 31, { size: 9, align: 'center', alpha: a * 0.75, spacing: 1, weight: 600 });
      this.text(g, it.key, x, y - 23, { size: 8, align: 'center', alpha: a * 0.5, mono: true });
      if (it.count !== null && it.count !== undefined) this.text(g, String(it.count), x + 19, y - 12, { size: 12, mono: true, color: C.red, alpha: 1 });
    });
  }

  drawObjective(g, a) {
    const M = this.G.mission;
    if (!M || !M.objective) return;
    const x = 28, y = 82;
    g.strokeStyle = C.warn + (a * 0.8) + ')';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y - 12); g.lineTo(x, y + 30); g.stroke();
    this.text(g, M.objective.title.toUpperCase(), x + 10, y, { size: 11, alpha: a * 0.7, weight: 600, spacing: 2, color: C.warn });
    this.text(g, M.objective.text, x + 10, y + 18, { size: 16, alpha: a, weight: 500 });
    if (M.objective.sub) this.text(g, M.objective.sub, x + 10, y + 36, { size: 12, alpha: a * 0.75, mono: true });
  }

  drawWaypoint(g, a) {
    const M = this.G.mission;
    if (!M || !M.waypoint) return;
    const p = this.project(M.waypoint, {});
    const d = this.G.player.pos.distanceTo(M.waypoint);
    const W = this.W, H = this.H;
    let x = p.x, y = p.y;
    const off = p.behind || x < 40 || x > W - 40 || y < 60 || y > H - 80;
    if (p.behind) { x = W - x; y = H - y; }
    if (off) { x = THREE.MathUtils.clamp(x, 40, W - 40); y = THREE.MathUtils.clamp(y, 70, H - 90); }
    g.strokeStyle = C.warn + a + ')';
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 9, y); g.lineTo(x, y + 9); g.lineTo(x - 9, y); g.closePath(); g.stroke();
    const label = (M.waypointLabel || '').toUpperCase();
    this.text(g, label, x, y - 16, { size: 10, align: 'center', alpha: a * 0.85, color: C.warn, weight: 600, spacing: 1 });
    this.text(g, d > 1000 ? (d / 1000).toFixed(1) + ' KM' : Math.round(d) + ' M', x, y + 24, { size: 11, align: 'center', mono: true, alpha: a, color: C.warn });
  }

  drawTargets(g, a) {
    const G = this.G, C2 = G.combat, P = G.player;
    const pr = {};
    // hostiles near the crosshair get a subtle bracket
    if (C2.scanning) {
      const R = Math.min(this.W, this.H) * 0.42 * (this.H / Math.max(this.W, 1)) * 1.0;
      const cx = this.W / 2, cy = this.H / 2;
      const rr = this.H * 0.42;
      g.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const s = this.t * 0.9 + i * Math.PI / 2;
        g.strokeStyle = C.red + '0.55)';
        g.beginPath(); g.arc(cx, cy, rr, s, s + 0.9); g.stroke();
        g.strokeStyle = C.main + '0.35)';
        g.beginPath(); g.arc(cx, cy, rr * 0.93, -s * 1.3, -s * 1.3 + 0.5); g.stroke();
      }
      this.text(g, 'TARGETING  ' + C2.locks.length + ' / 12', cx, cy + rr + 22, { size: 11, align: 'center', color: C.red, alpha: 0.9, weight: 600, spacing: 2 });
      void R;
      for (const c of C2.scanCivilians) {
        const p = this.project(c.center(_w), pr);
        if (p.behind) continue;
        g.strokeStyle = C.civ + '0.75)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(p.x - 6, p.y - 22); g.lineTo(p.x, p.y - 16); g.lineTo(p.x + 6, p.y - 22); g.stroke();
        this.text(g, 'NON-HOSTILE', p.x, p.y - 27, { size: 8, align: 'center', color: C.civ, alpha: 0.75, weight: 600, spacing: 1 });
      }
    }
    for (const h of C2.locks) {
      if (h.dead) continue;
      const p = this.project(h.center(_w), pr);
      if (p.behind) continue;
      h.lockT = (h.lockT || 0) + 0.016;
      const k = Math.min(1, h.lockT * 5);
      const r = 26 - k * 12;
      g.strokeStyle = C.red + '0.95)';
      g.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const an = this.t * 2.5 + i * 2.094;
        const x = p.x + Math.cos(an) * r, y = p.y + Math.sin(an) * r;
        g.beginPath();
        g.moveTo(x + Math.cos(an) * 6, y + Math.sin(an) * 6);
        g.lineTo(x + Math.cos(an + 2.6) * 5, y + Math.sin(an + 2.6) * 5);
        g.lineTo(x + Math.cos(an - 2.6) * 5, y + Math.sin(an - 2.6) * 5);
        g.closePath(); g.stroke();
      }
      g.beginPath(); g.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2); g.stroke();
    }
    // vehicle tags
    const vlist = (G.vehicles ? G.vehicles.list : []);
    for (const v of vlist) {
      if (v.dead) continue;
      const d = v.pos.distanceTo(P.pos);
      if (d > 1600) continue;
      const p = this.project(v.center(_w), pr);
      if (p.behind || p.x < 0 || p.x > this.W || p.y < 0 || p.y > this.H) continue;
      const s = THREE.MathUtils.clamp(900 / d, 12, 40);
      g.strokeStyle = C.red + '0.7)';
      g.lineWidth = 1;
      const br = (x, y, dx, dy) => { g.beginPath(); g.moveTo(x + dx * 6, y); g.lineTo(x, y); g.lineTo(x, y + dy * 6); g.stroke(); };
      br(p.x - s, p.y - s, 1, 1); br(p.x + s, p.y - s, -1, 1); br(p.x - s, p.y + s, 1, -1); br(p.x + s, p.y + s, -1, -1);
      const name = { technical: 'TECHNICAL', tank: 'T-72 MBT', tel: 'MISSILE LAUNCHER', zu23: 'AA GUN' }[v.type];
      this.text(g, name, p.x, p.y - s - 6, { size: 9, align: 'center', color: C.red, alpha: 0.8, weight: 600, spacing: 1 });
      const hpk = Math.max(0, v.hp / v.spec.hp);
      g.fillStyle = C.red + '0.6)'; g.fillRect(p.x - s, p.y + s + 4, 2 * s * hpk, 2);
    }
    if (G.jets) for (const j of G.jets.list) {
      const p = this.project(j.pos, pr);
      if (p.behind) continue;
      g.strokeStyle = C.warn + '0.8)';
      g.beginPath(); g.arc(p.x, p.y, 12, 0, Math.PI * 2); g.stroke();
      this.text(g, 'F-22  ' + (j.pos.distanceTo(P.pos) / 1000).toFixed(1) + ' KM', p.x, p.y - 18, { size: 9, align: 'center', color: C.warn, alpha: 0.85, weight: 600 });
    }
  }

  drawThreats(g) {
    const G = this.G, P = G.player;
    const W = this.W, H = this.H;
    let missile = false;
    for (const p of G.combat.projectiles) {
      if (p.owner !== 'enemy' || (p.kind !== 'guided' && p.kind !== 'rpg')) continue;
      const d = p.pos.distanceTo(P.pos);
      if (p.kind === 'rpg' && d > 300) continue;
      if (p.kind === 'guided') missile = true;
      const pr = this.project(p.pos, {});
      let dx = pr.x - W / 2, dy = pr.y - H / 2;
      if (pr.behind) { dx = -dx; dy = -dy; }
      const ang = Math.atan2(dy, dx);
      const onScreen = !pr.behind && pr.x > 0 && pr.x < W && pr.y > 0 && pr.y < H;
      const col = p.kind === 'guided' ? C.red : C.warn;
      if (onScreen) {
        g.strokeStyle = col + '0.95)'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(pr.x, pr.y, 10, 0, Math.PI * 2); g.stroke();
        this.text(g, (p.kind === 'guided' ? 'MSL ' : 'RPG ') + Math.round(d) + 'm', pr.x + 14, pr.y + 4, { size: 10, color: col, alpha: 0.95, mono: true });
      } else {
        const r = Math.min(W, H) * 0.32;
        const x = W / 2 + Math.cos(ang) * r, y = H / 2 + Math.sin(ang) * r;
        g.fillStyle = col + '0.9)';
        g.beginPath();
        g.moveTo(x + Math.cos(ang) * 14, y + Math.sin(ang) * 14);
        g.lineTo(x + Math.cos(ang + 2.5) * 10, y + Math.sin(ang + 2.5) * 10);
        g.lineTo(x + Math.cos(ang - 2.5) * 10, y + Math.sin(ang - 2.5) * 10);
        g.closePath(); g.fill();
        this.text(g, Math.round(d) + 'm', x - Math.cos(ang) * 16, y - Math.sin(ang) * 16 + 4, { size: 10, color: col, alpha: 0.9, mono: true, align: 'center' });
      }
    }
    if (missile && Math.sin(this.t * 14) > 0) this.text(g, 'MISSILE   ·   DEPLOY FLARES  [E]', W / 2, H * 0.27, { size: 15, align: 'center', color: C.red, alpha: 1, weight: 600, spacing: 3 });
    if (P.integrity < 30 && P.mode !== 'dead' && Math.sin(this.t * 6) > -0.2) this.text(g, 'SUIT INTEGRITY CRITICAL', W / 2, H * 0.32, { size: 13, align: 'center', color: C.red, alpha: 0.95, weight: 600, spacing: 3 });
  }

  drawReticle(g, cx, cy, a) {
    const G = this.G;
    g.lineWidth = 1.2;
    g.strokeStyle = C.main + (a * 0.9) + ')';
    g.beginPath(); g.arc(cx, cy, 13, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 4; i++) {
      const an = i * Math.PI / 2 + Math.PI / 4;
      g.beginPath(); g.moveTo(cx + Math.cos(an) * 17, cy + Math.sin(an) * 17); g.lineTo(cx + Math.cos(an) * 23, cy + Math.sin(an) * 23); g.stroke();
    }
    g.fillStyle = C.main + a + ')';
    g.beginPath(); g.arc(cx, cy, 1.4, 0, Math.PI * 2); g.fill();
    if (this.hitMarker > 0) {
      g.strokeStyle = C.main + (this.hitMarker * 4) + ')';
      g.lineWidth = 2;
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { g.beginPath(); g.moveTo(cx + dx * 7, cy + dy * 7); g.lineTo(cx + dx * 14, cy + dy * 14); g.stroke(); }
    }
    let ky = cy + 46;
    for (const k of this.killText) {
      this.text(g, k.text, cx + 30, ky, { size: 11, alpha: Math.min(1, k.t) * 0.9, weight: 600, spacing: 2, color: k.text.includes('CIVILIAN') ? C.red : C.main });
      ky += 15;
    }
    void G;
  }

  drawHelmet(g) {
    const W = this.W, H = this.H;
    const grd = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.7, 'rgba(4,6,8,0.55)');
    grd.addColorStop(1, 'rgba(2,3,4,0.95)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(200,230,255,0.06)';
    g.lineWidth = 1;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(W / 2, H / 2, W * (0.46 + i * 0.02), H * (0.52 + i * 0.02), 0, 0, Math.PI * 2); g.stroke(); }
  }

  drawSubtitle(g) {
    const J = this.G.jarvis;
    if (!J || !J.subtitle) return;
    const W = this.W, H = this.H;
    const s = J.subtitle;
    const alpha = Math.min(1, s.t * 1.5);
    g.font = "500 17px 'Rajdhani', sans-serif";
    const tw = g.measureText(s.text).width;
    g.fillStyle = `rgba(4,8,12,${0.45 * alpha})`;
    g.fillRect(W / 2 - tw / 2 - 16, H - 132, tw + 32, 30);
    this.text(g, s.who, W / 2 - tw / 2 - 8, H - 138, { size: 10, alpha: 0.7 * alpha, weight: 600, spacing: 2, color: C.warn });
    this.text(g, s.text, W / 2, H - 112, { size: 17, alpha: 0.95 * alpha, align: 'center' });
  }

  drawBanner(g) {
    const b = this.banner;
    if (!b) return;
    const W = this.W, H = this.H;
    const k = Math.min(1, (b.dur - b.t) * 2) * Math.min(1, b.t);
    this.text(g, b.title, W / 2, H * 0.2, { size: 26, align: 'center', alpha: 0.95 * k, weight: 500, spacing: 8 });
    if (b.sub) this.text(g, b.sub, W / 2, H * 0.2 + 26, { size: 13, align: 'center', alpha: 0.7 * k, color: C.warn, weight: 600, spacing: 3 });
  }
}
