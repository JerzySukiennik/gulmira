// Scripted still frames from fixed camera spots: node tools/shots.mjs <spot> [spot...]
import { chromium } from '/Users/jurek/openclaw/node_modules/playwright-core/index.mjs';

const spots = process.argv.slice(2);
const OUT = '/Users/jurek/Downloads/Claude/Projects/Gulmira/Niepotrzebne/shots/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('pageerror', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await page.goto('http://localhost:8790/');
await page.waitForFunction(() => window.__g && window.__g.ui && window.__g.mission, null, { timeout: 180000 });
for (const spot of spots) {
  await page.evaluate(async (spot) => {
    const g = window.__g, T = g.THREE, m = g.mission;
    if (!m.cacheCenter) { m.start(); await new Promise(r => setTimeout(r, 5000)); }
    g.ui.hideAll(); g.hud.visible = false; g.player.locked = false; g.R.setScale(1);
    const site = (s) => new T.Vector3(s.x, g.terrain.heightAt(s.x, s.z), s.z);
    const S = g.meta.sites;
    const views = {
      cache: () => { const c = m.cacheCenter; return { cam: c.clone().add(new T.Vector3(-150, 70, 140)), at: c.clone().add(new T.Vector3(0, 0, 20)) }; },
      cacheground: () => { const c = m.cacheCenter; return { cam: c.clone().add(new T.Vector3(-30, 2.2, -70)), at: c.clone().add(new T.Vector3(10, 1, 20)) }; },
      cacheentry: () => { const c = m.cacheCenter; let e = null; for (const r of g.meta.roads) for (const [x, z] of r) { const d = Math.hypot(x - c.x, z - c.z); if (d > 110 && d < 175 && (!e || Math.abs(d - 140) < Math.abs(e.d - 140))) e = { x, z, d }; } const rx = (e.x - c.x) / e.d, rz = (e.z - c.z) / e.d; const cam = new T.Vector3(e.x + rx * 22, 0, e.z + rz * 22); cam.y = g.terrain.heightAt(cam.x, cam.z) + 2.5; return { cam, at: c.clone().setY(c.y + 2) }; },
      village: () => { const v = site(S.village); return { cam: v.clone().add(new T.Vector3(-180, 90, 220)), at: v }; },
    };
    const [name, ...flags] = spot.split('+');
    const lights = g.atmo.csm.lights, planKeep = g.R.planShadows, terrN = g.atmo.uniforms.uTerr.value.x;
    if (flags.includes('old')) { lights.forEach(l => l.shadow.autoUpdate = true); g.R.planShadows = null; }
    if (flags.includes('nots')) g.atmo.uniforms.uTerr.value.x = 0;
    if (flags.includes('nocsm')) lights.forEach(l => l.castShadow = false);
    const v = views[name]();
    const P = g.player; P.spawn(v.cam.clone().add(new T.Vector3(0, 30, 0)), 'hover', null, 0);
    g.rig.cinematic = (dt, cam) => { cam.position.copy(v.cam); cam.lookAt(v.at); cam.fov = 55; cam.updateProjectionMatrix(); cam.updateMatrixWorld(); };
    g.suit.visible = false;
    for (let i = 0; i < 40; i++) g.tick(1 / 60);
    g.props.update(g.camera, true);
    await g.shot(spot.replace(/\+/g, '-'));
    g.suit.visible = true;
    lights.forEach(l => { l.shadow.autoUpdate = false; l.castShadow = true; }); g.R.planShadows = planKeep; g.atmo.uniforms.uTerr.value.x = terrN;
  }, spot);
  console.log('shot', spot);
}
await browser.close();
