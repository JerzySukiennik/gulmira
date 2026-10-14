// GPU/CPU cost breakdown in headless Chrome: node tools/profile.mjs [spot]
import { chromium } from '/Users/jurek/openclaw/node_modules/playwright-core/index.mjs';

const [spot = 'flight', W = 1440, H = 900] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('http://localhost:8790/?mission=0');
await page.waitForFunction(() => window.__g && window.__g.ui, null, { timeout: 120000 });
const res = await page.evaluate(async (spot) => {
  const g = window.__g, T = g.THREE;
  g.paused = true;
  g.ui.hideAll(); g.player.locked = false; g.hud.visible = true; g.rig.cinematic = null;
  const P = g.player;
  if (spot === 'village') { const p = new T.Vector3(20, g.terrain.heightAt(20, 150) + 25, 150); P.spawn(p, 'hover', null, 0); }
  else { P.spawn(new T.Vector3(-100, g.terrain.heightAt(-100, 4000) + 250, 4000), 'flight', new T.Vector3(0, 0, -250), 0); }
  g.rig.yaw = 0; g.rig.pitch = -0.12; g.rig.inited = false;
  for (let i = 0; i < 60; i++) g.tick(1 / 60);
  const gl = g.R.renderer.getContext(); const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const timeDraw = (n = 8) => { sync(); const t0 = performance.now(); for (let i = 0; i < n; i++) g.draw(1 / 60, i); sync(); return (performance.now() - t0) / n; };
  const timeTick = (n = 20) => { const t0 = performance.now(); for (let i = 0; i < n; i++) g.tick(1 / 60); return (performance.now() - t0) / n; };
  const out = {};
  out.tick = timeTick();
  out.draw = timeDraw();
  const info = g.R.renderer.info; info.autoReset = false; info.reset(); g.draw(1 / 60, 0); out.tris = info.render.triangles; out.calls = info.render.calls; info.autoReset = true;
  for (let k = 0; k < 3; k++) timeDraw(4);
  out.draw = timeDraw(10);
  const toggle = (label, off, on) => { const base = timeDraw(8); off(); timeDraw(2); const t = timeDraw(8); on(); out[label] = +(base - t).toFixed(2); };
  toggle('shadows', () => g.R.skipShadows = true, () => g.R.skipShadows = false);
  toggle('terrain', () => g.terrain.mesh.visible = false, () => g.terrain.mesh.visible = true);
  const inst = []; g.scene.traverse(o => { if (o.isInstancedMesh) inst.push(o); });
  toggle('props', () => inst.forEach(m => m.visible = false), () => inst.forEach(m => m.visible = true));
  toggle('village', () => g.village.group.visible = false, () => g.village.group.visible = true);
  const hum = g.agents.all.map(a => a.h.root);
  toggle('humans', () => hum.forEach(r => r.visible = false), () => hum.forEach(r => r.visible = true));
  toggle('particles', () => { g.particles.alpha.mesh.visible = false; g.particles.add.mesh.visible = false; }, () => { g.particles.alpha.mesh.visible = true; g.particles.add.mesh.visible = true; });
  toggle('motionblur', () => g.R.params.motion = 0, () => g.R.params.motion = 0.55);
  toggle('shafts', () => g.R.params.shafts = 0, () => g.R.params.shafts = 0.9);
  toggle('suit', () => g.suit.visible = false, () => g.suit.visible = true);
  const t0 = performance.now(); for (let i = 0; i < 20; i++) g.props.update(g.camera, true); out.propsUpdateCPU = (performance.now() - t0) / 20;
  const t1 = performance.now(); for (let i = 0; i < 20; i++) g.terrain.update(g.camera); out.terrainUpdateCPU = (performance.now() - t1) / 20;
  out.res = [g.R.width, g.R.height];
  out.terrainInstances = g.terrain.instances;
  return out;
}, spot);
console.log(JSON.stringify(res, null, 1));
await browser.close();
