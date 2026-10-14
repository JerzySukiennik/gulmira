// Weapons cache dressing: camouflage nets on poles, floodlights, sandbag walls.
import * as THREE from 'three';

function camoTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#5c5a43'; g.fillRect(0, 0, 512, 512);
  const cols = ['#6f6a4d', '#4a4834', '#7d7556', '#3e3d2c', '#8a8060'];
  for (let i = 0; i < 900; i++) {
    g.fillStyle = cols[i % cols.length];
    const x = Math.random() * 512, y = Math.random() * 512, r = 6 + Math.random() * 26;
    g.beginPath();
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; const rr = r * (0.6 + Math.random() * 0.6); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.closePath(); g.fill();
  }
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600; i++) { const x = Math.random() * 512, y = Math.random() * 512; g.beginPath(); g.arc(x, y, 1.5 + Math.random() * 5, 0, Math.PI * 2); g.fill(); }
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(40,38,28,0.6)'; g.lineWidth = 1.2;
  for (let i = 0; i < 512; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function sandbagTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#9a8b6c'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${60 + Math.random() * 80},${50 + Math.random() * 60},${30 + Math.random() * 40},0.15)`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  g.strokeStyle = 'rgba(60,50,35,0.35)';
  for (let y = 0; y < 256; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y + Math.random() * 2); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function dressCache({ scene, terrain, world, atmo, center, rng = Math.random }) {
  const group = new THREE.Group();
  const T = terrain;
  const netMat = new THREE.MeshStandardMaterial({ map: camoTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.95 });
  atmo.patch(netMat, { key: 'net' });
  const poleMat = new THREE.MeshStandardMaterial({ color: '#4a4236', roughness: 0.8 });
  atmo.patch(poleMat, { key: 'pole' });
  const metal = new THREE.MeshStandardMaterial({ color: '#3a3c3e', roughness: 0.5, metalness: 0.7 });
  atmo.patch(metal, { key: 'lampmetal' });
  const lens = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color('#fff1d6'), emissiveIntensity: 30 });
  atmo.patch(lens, { key: 'lens' });
  const bagMat = new THREE.MeshStandardMaterial({ map: sandbagTexture(), roughness: 0.95 });
  atmo.patch(bagMat, { key: 'bag' });
  // camouflage nets over the launcher slots
  const nets = [[-40, 45, 26, 18, 0.6], [15, 58, 30, 20, 0.85], [55, 25, 24, 16, 1.2], [-70, -10, 18, 14, 0.2]];
  for (const [dx, dz, w, d, yaw] of nets) {
    const cx = center.x + dx, cz = center.z + dz;
    const geo = new THREE.PlaneGeometry(w, d, 16, 12);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i), lz = p.getZ(i);
      const u = lx / (w / 2), v = lz / (d / 2);
      const sag = 1.2 * (1 - Math.max(Math.abs(u), Math.abs(v)) ** 2) + 0.4 * Math.sin(u * 7) * Math.cos(v * 5);
      const wx = cx + lx * c + lz * s, wz = cz - lx * s + lz * c;
      const edge = Math.max(Math.abs(u), Math.abs(v));
      const h = T.heightAt(wx, wz) + 5.2 - sag * 0.5 - Math.max(0, edge - 0.85) * 18;
      p.setXYZ(i, wx, Math.max(T.heightAt(wx, wz) + 0.2, h), wz);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, netMat);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    for (const [u, v] of [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6], [0, 0]]) {
      const lx = u * w / 2, lz = v * d / 2;
      const wx = cx + lx * c + lz * s, wz = cz - lx * s + lz * c;
      const gy = T.heightAt(wx, wz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 5.6, 6), poleMat);
      pole.position.set(wx, gy + 2.6, wz);
      pole.castShadow = true;
      group.add(pole);
    }
  }
  // floodlights
  const lights = [];
  for (const [dx, dz] of [[-20, 10], [40, -20]]) {
    const x = center.x + dx, z = center.z + dz, gy = T.heightAt(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 8, 8), metal);
    pole.position.set(x, gy + 4, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Group();
    head.position.set(x, gy + 8.1, z);
    head.lookAt(center.x, gy, center.z + 20);
    for (const ox of [-0.35, 0.35]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.3), metal);
      box.position.x = ox;
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.32), lens);
      l.position.set(ox, 0, 0.16);
      head.add(box, l);
    }
    group.add(head);
    lights.push(head.position.clone());
    world.addBox(new THREE.Vector3(x, gy + 4, z), new THREE.Vector3(0.2, 4, 0.2), 0, { kind: 'pole', noWalk: true });
  }
  // sandbag walls
  const bag = new THREE.SphereGeometry(0.5, 10, 6);
  bag.scale(0.62, 0.17, 0.32);
  const walls = [[-95, 30, 14, 0.4], [90, -40, 12, 1.9], [-10, -95, 16, 1.5], [60, 75, 12, 2.6]];
  for (const [dx, dz, len, yaw] of walls) {
    const n = Math.floor(len / 0.62);
    const inst = new THREE.InstancedMesh(bag, bagMat, n * 4);
    let k = 0;
    const cx = center.x + dx, cz = center.z + dz, c = Math.cos(yaw), s = Math.sin(yaw);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let row = 0; row < 4; row++) for (let i = 0; i < n; i++) {
      const lx = (i - n / 2 + (row % 2) * 0.5) * 0.6, lz = 0;
      const wx = cx + lx * c + lz * s, wz = cz - lx * s + lz * c;
      const gy = T.heightAt(wx, wz);
      q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.1, yaw + (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.1));
      m.compose(new THREE.Vector3(wx, gy + 0.08 + row * 0.16, wz), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(k++, m);
    }
    inst.count = k;
    inst.castShadow = true; inst.receiveShadow = true;
    group.add(inst);
    const mid = new THREE.Vector3(cx, T.heightAt(cx, cz) + 0.35, cz);
    world.addBox(mid, new THREE.Vector3(len / 2, 0.35, 0.3), yaw, { kind: 'sandbags' });
  }
  group.traverse(o => { o.updateMatrix(); o.matrixAutoUpdate = false; });
  scene.add(group);
  return { group, lights };
}
