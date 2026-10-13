// Real-loop playtest in headless Chrome (GPU): load, start, measure fps, run a script, capture frames.
// node tools/playtest.mjs [scenario] [width] [height]
import { chromium } from '/Users/jurek/openclaw/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const [scenario = 'approach', W = 1440, H = 900] = process.argv.slice(2);
const OUT = '/Users/jurek/Downloads/Claude/Projects/Gulmira/Niepotrzebne/shots/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 200)); });
const t0 = Date.now();
await page.goto('http://localhost:8790/' + (scenario === 'free' ? '?mission=0&at=village&pop=test' : ''));
await page.waitForFunction(() => window.__g && window.__g.ui, null, { timeout: 120000 });
const loadSec = (Date.now() - t0) / 1000;
await page.waitForTimeout(1500);
const fps = async (sec) => page.evaluate(async (sec) => {
  const ts = [];
  await new Promise(res => { const f = (t) => { ts.push(t); if (ts.length < 2 || t - ts[0] < sec * 1000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  const d = []; for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
  d.sort((a, b) => a - b);
  return { fps: (ts.length - 1) / ((ts[ts.length - 1] - ts[0]) / 1000), p95ms: d[Math.floor(d.length * 0.95)], res: [window.__g.R.width, window.__g.R.height] };
}, sec);
const report = { scenario, loadSec };
report.title = await fps(3);
await page.screenshot({ path: OUT + 'pt-title.jpg', quality: 85, type: 'jpeg' });
if (scenario !== 'title') {
  await page.evaluate(() => { const g = window.__g; g.ui.hideAll(); g.ui.state = 'playing'; if (g.mission) g.mission.start(); else { g.player.locked = false; g.hud.visible = true; g.rig.cinematic = null; } });
  await page.waitForTimeout(scenario === 'approach' ? 9000 : 1500);
  report.play = await fps(4);
  await page.screenshot({ path: OUT + 'pt-play.jpg', quality: 85, type: 'jpeg' });
  if (scenario === 'approach') {
    await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
    await page.waitForTimeout(4000);
    report.boost = await fps(3);
    await page.screenshot({ path: OUT + 'pt-boost.jpg', quality: 85, type: 'jpeg' });
    await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
  }
  if (scenario === 'free') {
    await page.evaluate(() => { const g = window.__g; g.agents.alarm(g.player.pos.clone()); });
    await page.waitForTimeout(3000);
    report.combat = await fps(4);
    await page.screenshot({ path: OUT + 'pt-combat.jpg', quality: 85, type: 'jpeg' });
  }
}
report.errors = errors;
fs.writeFileSync(OUT + 'pt-report.json', JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
