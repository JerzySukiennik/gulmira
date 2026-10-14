// Scripted still frames from fixed camera spots: node tools/shots.mjs <spot> [spot...]
import { chromium } from '/Users/jurek/openclaw/node_modules/playwright-core/index.mjs';

const spots = process.argv.slice(2);
const OUT = '/Users/jurek/Downloads/Claude/Projects/Gulmira/Niepotrzebne/shots/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('pageerror', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await page.goto('http://localhost:8790/' + (process.env.Q ? '?' + process.env.Q : ''));
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
      tppground: () => { const p = new T.Vector3(40, 0, 120); p.y = g.terrain.heightAt(p.x, p.z) + 1.02; return { tpp: true, pos: p, mode: 'ground', yaw: 0.6 }; },
      tpphover: () => { const p = new T.Vector3(60, 0, 260); p.y = g.terrain.heightAt(p.x, p.z) + 14; return { tpp: true, pos: p, mode: 'hover', yaw: 0.3 }; },
      tppflight: () => { const p = new T.Vector3(-300, 0, 3000); p.y = g.terrain.heightAt(p.x, p.z) + 120; return { tpp: true, pos: p, mode: 'flight', vel: new T.Vector3(0, 0, -110), yaw: 0 }; },
    };
    const [name, ...flags] = spot.split('+');
    const lights = g.atmo.csm.lights, planKeep = g.R.planShadows, terrN = g.atmo.uniforms.uTerr.value.x;
    if (flags.includes('old')) { lights.forEach(l => l.shadow.autoUpdate = true); g.R.planShadows = null; }
    if (flags.includes('nots')) g.atmo.uniforms.uTerr.value.x = 0;
    if (flags.includes('nocsm')) lights.forEach(l => l.castShadow = false);
    const fogKeep = g.atmo.uniforms.uFog.value.clone();
    if (flags.includes('nofog')) g.atmo.uniforms.uFog.value.set(0, fogKeep.y, fogKeep.z, 0);
    const v = views[name]();
    const P = g.player;
    if (v.tpp) {
      P.spawn(v.pos, v.mode, v.vel || null, v.yaw); g.rig.cinematic = null; g.rig.yaw = v.yaw; g.rig.pitch = -0.1; g.rig.inited = false;
      g.hud.visible = flags.includes('hud');
    } else {
      P.spawn(v.cam.clone().add(new T.Vector3(0, 30, 0)), 'hover', null, 0);
      g.rig.cinematic = (dt, cam) => { cam.position.copy(v.cam); cam.lookAt(v.at); cam.fov = 55; cam.updateProjectionMatrix(); cam.updateMatrixWorld(); };
      g.suit.visible = false;
    }
    for (let i = 0; i < 40; i++) g.tick(1 / 60);
    if (flags.includes('scorch')) {
      const f = new T.Vector3(-Math.sin(g.rig.yaw), 0, -Math.cos(g.rig.yaw));
      for (let k = 0; k < 3; k++) { const sp = P.pos.clone().addScaledVector(f, 4 + k * 3); sp.y = g.terrain.heightAt(sp.x, sp.z); g.fx.scorch(sp, g.terrain.normalAt(sp.x, sp.z), 2.5); }
    }
    if (flags.includes('boom')) {
      const f = new T.Vector3(-Math.sin(g.rig.yaw), 0, -Math.cos(g.rig.yaw));
      const bp = P.pos.clone().addScaledVector(f, 18); bp.y = g.terrain.heightAt(bp.x, bp.z);
      g.fx.explosion(bp, { size: 1.4, kind: 'large' });
      for (let i = 0; i < (flags.includes('late') ? 200 : 25); i++) g.tick(1 / 60);
    }
    g.props.update(g.camera, true);
    await g.shot(spot.replace(/\+/g, '-'));
    g.suit.visible = true;
    lights.forEach(l => { l.shadow.autoUpdate = false; l.castShadow = true; }); g.R.planShadows = planKeep; g.atmo.uniforms.uTerr.value.x = terrN; g.atmo.uniforms.uFog.value.copy(fogKeep);
  }, spot);
  console.log('shot', spot);
}
await browser.close();
