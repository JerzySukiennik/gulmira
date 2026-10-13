// Stepped run through every mission phase with scripted kills: node tools/flowtest.mjs
import { chromium } from '/Users/jurek/openclaw/node_modules/playwright-core/index.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('pageerror ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 200)); });
await page.goto('http://localhost:8790/');
await page.waitForFunction(() => window.__g && window.__g.ui && window.__g.mission, null, { timeout: 180000 });
const log = await page.evaluate(async () => {
  const g = window.__g, T = g.THREE, m = g.mission, P = g.player, out = [];
  g.paused = true;
  const step = (sec, drawEvery = 20) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { g.tick(1 / 60); if (i % drawEvery === 0) g.draw(1 / 60, i); } };
  const note = (label) => out.push(`${label}: phase=${m.phase} hp=${P.integrity?.toFixed?.(0)} mode=${P.mode}`);
  const hover = (x, z, up = 30) => { const p = new T.Vector3(x, g.terrain.heightAt(x, z) + up, z); P.spawn(p, 'hover', null, 0); g.rig.inited = false; };
  g.ui.hideAll(); g.ui.state = 'playing'; m.start(); P.invulnerable = true;
  step(1); note('start');
  step(7.5); note('after intro');
  const v = g.meta.sites.village;
  hover(v.x + 300, v.z + 900, 60); step(1); note('near village');
  let n = 0;
  for (const a of m.villageFighters) { if (a.dead) continue; a.takeHit({ dmg: 1e6, source: 'player' }); if (++n % 4 === 0) step(0.2); }
  step(1); note('fighters down');
  step(2); note('tank phase');
  if (m.tank && !m.tank.dead) { m.tank.takeHit({ dmg: 1e6, weapon: 'rocket', explosive: true, source: 'player' }); }
  step(5); note('tank destroyed');
  const c = m.cacheCenter;
  hover(c.x - 400, c.z + 300, 80); step(1); note('cache approach');
  hover(c.x - 150, c.z + 100, 60); step(1); note('cache alarm ' + !!m.flags.cacheAlarm);
  for (const t of m.tels.slice(0, 2)) { t.takeHit({ dmg: 1e6, weapon: 'rocket', explosive: true, source: 'player' }); step(0.5); }
  step(1); note('2 TELs down, launch=' + !!m.flags.launchStarted);
  for (let i = 0; i < 140 && m.phase !== 'intercept'; i++) { step(0.1); }
  note('launched');
  step(3);
  if (m.launchMissile && !m.launchMissile.dead) m.launchMissile.takeHit({ dmg: 1e6 });
  step(1); note('intercepted ' + !!m.flags.intercepted);
  for (const t of m.tels) if (!t.dead) { t.takeHit({ dmg: 1e6, weapon: 'rocket', explosive: true, source: 'player' }); step(0.5); }
  for (let i = 0; i < 100 && m.phase !== 'raptors'; i++) { step(0.1); }
  note('raptors');
  hover(c.x - 600, c.z + 600, 300); P.spawn(P.pos.clone(), 'flight', new T.Vector3(-150, 0, 0), 0);
  for (let i = 0; i < 300 && m.evaded < 2; i++) { if (i % 20 === 0) g.combat.fireFlares?.(); step(0.1); }
  note('evaded ' + m.evaded + ' jets ' + (g.jets?.list?.length ?? '?'));
  m.evaded = 6; step(1); note('end');
  out.push('stats ' + JSON.stringify(g.combat.stats));
  return out;
});
console.log(log.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
