// GPU cost per scene category for one camera spot (draw-to-readPixels timing): node tools/gpuprof.mjs [ground|hover|flight] [scale]
import { chromium } from '/Users/jurek/openclaw/node_modules/playwright-core/index.mjs';

const [spot = 'ground', scale = 1, extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('http://localhost:8790/?mission=0&at=village&pop=test' + (extra ? '&' + extra : ''));
await page.waitForFunction(() => window.__g && window.__g.ui, null, { timeout: 180000 });
const r = await page.evaluate(async ({ spot, scale }) => {
  const g = window.__g, T = g.THREE, P = g.player;
  g.paused = true; g.ui.hideAll(); P.locked = false; g.hud.visible = false; g.rig.cinematic = null;
  g.R.setScale(+scale);
  if (spot === 'hover') P.spawn(new T.Vector3(20, g.terrain.heightAt(20, 150) + 25, 150), 'hover', null, 0);
  if (spot === 'flight') P.spawn(new T.Vector3(-100, g.terrain.heightAt(-100, 4000) + 250, 4000), 'flight', new T.Vector3(0, 0, -250), 0);
  g.rig.yaw = 0; g.rig.pitch = -0.1; g.rig.inited = false;
  g.agents.alarm(P.pos.clone());
  for (let i = 0; i < 90; i++) g.tick(1 / 60);
  const gl = g.R.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const px = new Uint8Array(4);
  const timeDraw = async (n = 12) => {
    const qs = [];
    for (let i = 0; i < n; i++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); g.draw(1 / 60, i); gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = [];
    for (const q of qs) {
      for (let k = 0; k < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise(r => setTimeout(r, 10));
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) ms.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
    ms.sort((a, b) => a - b);
    return ms[Math.floor(ms.length / 2)] || 0;
  };
  const med = (f) => f();
  for (let k = 0; k < 2; k++) await timeDraw(6);
  const out = { res: [g.R.width, g.R.height] };
  out.base = +(await timeDraw()).toFixed(1);
  const inst = []; g.scene.traverse(o => { if (o.isInstancedMesh) inst.push(o); });
  const hum = g.agents.all.map(a => a.h.root);
  const cats = {
    shadows: [() => g.R.skipShadows = true, () => g.R.skipShadows = false],
    terrain: [() => g.terrain.mesh.visible = false, () => g.terrain.mesh.visible = true],
    props: [() => inst.forEach(m => m.userData.v = m.visible) || inst.forEach(m => m.visible = false), () => inst.forEach(m => m.visible = m.userData.v)],
    village: [() => g.village.group.visible = false, () => g.village.group.visible = true],
    humans: [() => hum.forEach(h => h.visible = false), () => hum.forEach(h => h.visible = true)],
    suit: [() => g.suit.visible = false, () => g.suit.visible = true],
    sky: [() => g.atmo.dome.visible = false, () => g.atmo.dome.visible = true],
    post: [() => { g.R.params.motion = 0; g.R.params.shafts = 0; }, () => { g.R.params.motion = 0.55; g.R.params.shafts = 0.9; }],
  };
  for (const [k, [off, on]] of Object.entries(cats)) {
    off(); await timeDraw(4); const t = await timeDraw(); on(); await timeDraw(4); const b = await timeDraw();
    out[k] = +(b - t).toFixed(1);
  }
  const info = g.R.renderer.info; info.autoReset = false; info.reset(); g.draw(1 / 60, 0); out.tris = info.render.triangles; out.calls = info.render.calls; info.autoReset = true;
  return out;
}, { spot, scale });
console.log(JSON.stringify(r));
await browser.close();
