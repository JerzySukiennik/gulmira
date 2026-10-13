// CPU sampling profile of the real loop during village combat: node tools/cpuprof.mjs [seconds]
import { chromium } from '/Users/jurek/openclaw/node_modules/playwright-core/index.mjs';

const [sec = 5, W = 1440, H = 900] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('http://localhost:8790/?mission=0&at=village&pop=test');
await page.waitForFunction(() => window.__g && window.__g.ui, null, { timeout: 120000 });
await page.evaluate(() => { const g = window.__g; g.ui.hideAll(); g.ui.state = 'playing'; g.player.locked = false; g.hud.visible = true; g.rig.cinematic = null; g.agents.alarm(g.player.pos.clone()); });
await page.waitForTimeout(3000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
const timing = await page.evaluate(async (sec) => {
  const g = window.__g;
  const acc = {}; const wrap = (obj, name, label) => { const f = obj[name].bind(obj); obj[name] = (...a) => { const t = performance.now(); const r = f(...a); acc[label] = (acc[label] || 0) + performance.now() - t; return r; }; };
  wrap(g.agents, 'update', 'agents'); wrap(g.combat, 'update', 'combat'); wrap(g.fx, 'update', 'fx'); wrap(g.particles, 'update', 'particles');
  wrap(g.props, 'update', 'props'); wrap(g.terrain, 'update', 'terrain'); wrap(g.hud, 'update', 'hudUpdate'); wrap(g.hud, 'draw', 'hudDraw');
  wrap(g.anim, 'update', 'anim'); wrap(g.rig, 'update', 'rig'); wrap(g, 'tick', 'tick'); wrap(g, 'draw', 'draw');
  if (g.vehicles) wrap(g.vehicles, 'update', 'vehicles');
  let frames = 0; const t0 = performance.now();
  await new Promise(res => { const f = () => { frames++; if (performance.now() - t0 < sec * 1000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  const out = { frames, fps: frames / ((performance.now() - t0) / 1000), agents: g.agents.all.length, alive: g.agents.all.filter(a => !a.dead).length, ragdolls: g.agents.all.filter(a => a.h.ragdoll).length };
  for (const k in acc) out[k] = +(acc[k] / frames).toFixed(2);
  return out;
}, +sec);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n]));
const dt = []; for (let i = 0; i < profile.timeDeltas.length; i++) dt.push(profile.timeDeltas[i]);
profile.samples.forEach((id, i) => { const n = byId.get(id); const cf = n.callFrame; const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`; self.set(key, (self.get(key) || 0) + (dt[i] || 0)); });
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(JSON.stringify(timing, null, 1));
console.log([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`).join('\n'));
await browser.close();
