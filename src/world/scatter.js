// Scatters scanned granite boulders, cliffs, stones and desert scrub over the baked terrain.
import * as THREE from 'three';

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const BOULDERS = ['namaqualand_boulder_02', 'namaqualand_boulder_03', 'namaqualand_boulder_04', 'namaqualand_boulder_05', 'namaqualand_boulder_06'];
const PILES = ['namaqualand_boulders_01'];
const STONES = ['rock_07', 'rock_09', 'namaqualand_stones_01', 'namaqualand_rocks_01'];
const CLIFFS = ['namaqualand_cliff_01', 'namaqualand_cliff_02', 'rock_face_01', 'rock_face_02'];
const SCRUB = ['wild_rooibos_bush', 'dry_branches_medium_01', 'dead_quiver_branch_01'];

export async function scatterWorld({ props, terrain, world, meta, village }) {
  const rng = mulberry32(777);
  const T = terrain;
  const V = new THREE.Vector2(meta.sites.village.x, meta.sites.village.z);
  const roads = meta.roads;
  const nearRoad = (x, z, w) => {
    for (const r of roads) for (let i = 0; i < r.length - 1; i++) {
      const [ax, az] = r[i], [bx, bz] = r[i + 1];
      if (Math.min(ax, bx) - w > x || Math.max(ax, bx) + w < x || Math.min(az, bz) - w > z || Math.max(az, bz) + w < z) continue;
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      let t = ((x - ax) * vx + (z - az) * vz) / l2; t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - ax - vx * t, z - az - vz * t) < w) return true;
    }
    return false;
  };
  const inVillage = (x, z, m = 0) => Math.hypot(x - V.x, z - V.y) < meta.sites.village.r + m;
  const inCache = (x, z, m = 0) => Math.hypot(x - meta.sites.cache.x, z - meta.sites.cache.z) < meta.sites.cache.r + m;
  const slopeAt = (x, z) => 1 - T.normalAt(x, z, new THREE.Vector3(), 2).y;

  const sizeOf = {};
  const loadSizes = (names, lods) => Promise.all(names.map(async n => { const m = await props.loadModel(n, lods); if (m) sizeOf[n] = m.box.getSize(new THREE.Vector3()); }));
  await Promise.all([loadSizes(BOULDERS, 3), loadSizes(PILES, 3), loadSizes(STONES, 2), loadSizes(CLIFFS, 2), loadSizes(SCRUB, 2)]);
  const lists = {};
  const put = (name, pos, size, opts = {}) => {
    const sz = sizeOf[name];
    if (!sz) return null;
    const dim = Math.max(sz.x, sz.z);
    const scale = size / dim;
    (lists[name] ||= []).push({ pos, yaw: rng() * Math.PI * 2, scale, tiltX: (rng() - 0.5) * (opts.tilt ?? 0.3), tiltZ: (rng() - 0.5) * (opts.tilt ?? 0.3), sy: opts.sy ?? (0.8 + rng() * 0.45) });
    return scale;
  };

  // granite knobs: piled boulders
  for (const [kx, kz, rk, hk] of meta.knobs) {
    if (Math.hypot(kx - V.x, kz - V.y + 1500) > 8000) continue;
    if (inVillage(kx, kz, 60)) continue;
    const n = Math.min(34, Math.round(rk * hk / 120) + 3);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.pow(rng(), 0.7) * rk * 0.95;
      const x = kx + Math.cos(a) * r, z = kz + Math.sin(a) * r;
      if (nearRoad(x, z, 9)) continue;
      const crest = 1 - r / rk;
      const size = 2.2 + Math.pow(rng(), 1.6) * (5 + 9 * crest) * Math.min(1.4, hk / 30);
      const name = rng() < 0.15 ? PILES[0] : BOULDERS[Math.floor(rng() * BOULDERS.length)];
      const y = T.heightAt(x, z) - size * (0.12 + rng() * 0.15);
      put(name, new THREE.Vector3(x, y, z), size);
      if (size > 3.5 && Math.hypot(x - V.x, z - V.y) < 4500) world.addSphere(new THREE.Vector3(x, y + size * 0.32, z), size * 0.42, { kind: 'rock' });
    }
  }
  // loose boulders and stones on the valley floor
  for (let i = 0; i < 5200; i++) {
    const r = Math.pow(rng(), 0.6) * 7000, a = rng() * Math.PI * 2;
    const x = V.x + Math.cos(a) * r * 0.75, z = V.y + Math.sin(a) * r + 1800;
    if (Math.abs(x) > 9800 || Math.abs(z) > 9800) continue;
    if (inVillage(x, z, -20) || inCache(x, z, -20) || nearRoad(x, z, 6)) continue;
    const sl = slopeAt(x, z);
    const big = rng() < 0.18;
    const size = big ? 1.4 + rng() * 2.6 : 0.35 + rng() * 1.1;
    const name = big ? BOULDERS[Math.floor(rng() * BOULDERS.length)] : STONES[Math.floor(rng() * STONES.length)];
    put(name, new THREE.Vector3(x, T.heightAt(x, z) - size * 0.2, z), size * (1 + sl));
  }
  // scrub
  for (let i = 0; i < 6500; i++) {
    const r = Math.pow(rng(), 0.55) * 6000, a = rng() * Math.PI * 2;
    const x = V.x + Math.cos(a) * r * 0.8, z = V.y + Math.sin(a) * r + 1500;
    if (Math.abs(x) > 9800 || Math.abs(z) > 9800) continue;
    if (inVillage(x, z, -60) || nearRoad(x, z, 4) || inCache(x, z)) continue;
    if (slopeAt(x, z) > 0.35) continue;
    const name = SCRUB[rng() < 0.6 ? 0 : rng() < 0.5 ? 1 : 2];
    const size = name === SCRUB[0] ? 0.8 + rng() * 1.3 : 1.0 + rng() * 1.6;
    put(name, new THREE.Vector3(x, T.heightAt(x, z) - 0.05, z), size, { tilt: 0.15, sy: 0.7 + rng() * 0.6 });
  }
  // canyon / cache cliffs on steep walls
  const C = meta.canyon;
  for (let i = 0; i < 260; i++) {
    const seg = Math.floor(rng() * (C.length - 1));
    const t = rng();
    const cx = C[seg][0] + (C[seg + 1][0] - C[seg][0]) * t, cz = C[seg][1] + (C[seg + 1][1] - C[seg][1]) * t;
    const a = rng() * Math.PI * 2, r = 50 + rng() * 120;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const sl = slopeAt(x, z);
    if (sl < 0.35) continue;
    const n = T.normalAt(x, z, new THREE.Vector3(), 3);
    const size = 10 + rng() * 22;
    const name = CLIFFS[Math.floor(rng() * CLIFFS.length)];
    const sc = put(name, new THREE.Vector3(x, T.heightAt(x, z) - size * 0.25, z), size, { tilt: 0.2 });
    if (sc) lists[name][lists[name].length - 1].yaw = Math.atan2(n.x, n.z);
  }
  // village props
  const vp = {};
  for (const p of village.props) (vp[p.model] ||= []).push({ pos: p.pos, yaw: p.yaw, scale: p.scale || 1 });

  const jobs = [];
  for (const [name, inst] of Object.entries(lists)) {
    const lods = BOULDERS.includes(name) || PILES.includes(name) || name.includes('cliff') ? 3 : 2;
    const ranges = SCRUB.includes(name) ? [45, 320] : STONES.includes(name) ? [35, 260] : [65, 380, 3000];
    const maxDist = SCRUB.includes(name) ? 1100 : STONES.includes(name) ? 650 : 5000;
    jobs.push(props.addSet(name, inst, { lods, ranges, maxDist, castShadow: true }));
  }
  for (const [name, inst] of Object.entries(vp)) {
    const tree = name === 'dead_tree_trunk' || name === 'searsia_burchellii';
    jobs.push(props.addSet(name, inst, { lods: name === 'dead_tree_trunk' ? 2 : 1, ranges: [tree ? 90 : 60], maxDist: tree ? 900 : 420 }));
  }
  await Promise.all(jobs);
  return { counts: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length])) };
}
