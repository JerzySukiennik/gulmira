// Instanced prop/scan library with distance LODs. Models come from assets/models/game/<name>_lod<k>.glb.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const loader = new GLTFLoader();
const _q = new THREE.Quaternion(), _s = new THREE.Vector3();

function mergeByMaterial(parts) {
  const groups = new Map();
  for (const p of parts) {
    if (!groups.has(p.material)) groups.set(p.material, []);
    groups.get(p.material).push(p.geometry);
  }
  const out = [];
  for (const [material, geoms] of groups) {
    if (geoms.length === 1) { out.push({ geometry: geoms[0], material }); continue; }
    const keys = Object.keys(geoms[0].attributes).sort().join();
    const indexed = geoms[0].index !== null;
    const compatible = geoms.every(g => Object.keys(g.attributes).sort().join() === keys && (g.index !== null) === indexed);
    const merged = compatible ? mergeGeometries(geoms, false) : null;
    if (merged) out.push({ geometry: merged, material });
    else for (const g of geoms) out.push({ geometry: g, material });
  }
  return out;
}

export class PropLibrary {
  constructor(atmo, scene) {
    this.atmo = atmo;
    this.scene = scene;
    this.models = new Map();
    this.pending = new Map();
    this.sets = [];
    this.patched = new WeakSet();
  }

  async loadModel(name, lods = 1) {
    if (this.models.has(name)) return this.models.get(name);
    if (this.pending.has(name)) return this.pending.get(name);
    const job = this.loadModelInner(name, lods);
    this.pending.set(name, job);
    return job;
  }

  async loadModelInner(name, lods) {
    const levels = [];
    const files = await Promise.all([...Array(lods).keys()].map(k => loader.loadAsync(`assets/models/game/${name}_lod${k}.glb`).catch(() => null)));
    for (let k = 0; k < lods; k++) {
      try {
        const gltf = files[k];
        if (!gltf) throw new Error('missing');
        const parts = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse(o => {
          if (!o.isMesh) return;
          const g = o.geometry.clone();
          g.morphAttributes = {};
          g.morphTargetsRelative = false;
          g.applyMatrix4(o.matrixWorld);
          const mat = o.material;
          if (!this.patched.has(mat)) {
            mat.side = THREE.FrontSide;
            if (mat.map) mat.map.anisotropy = 8;
            if (mat.transparent || mat.alphaTest > 0) { mat.alphaTest = 0.5; mat.transparent = false; mat.side = THREE.DoubleSide; }
            this.atmo.patch(mat, { key: 'prop' });
            this.patched.add(mat);
          }
          parts.push({ geometry: g, material: mat });
        });
        const merged = mergeByMaterial(parts);
        const box = new THREE.Box3();
        for (const p of merged) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
        levels.push({ parts: merged, box });
      } catch (e) {
        if (k === 0) { console.warn('prop missing', name); this.models.set(name, null); return null; }
        break;
      }
    }
    const model = { name, levels, box: levels[0].box, radius: levels[0].box.getSize(new THREE.Vector3()).length() / 2 };
    this.models.set(name, model);
    return model;
  }

  // instances: [{pos, yaw, scale, tilt?}]; ranges: LOD switch distances
  async addSet(name, instances, { lods = 1, ranges = [80, 400, 2500], castShadow = true, maxDist = 4000 } = {}) {
    const model = await this.loadModel(name, lods);
    if (!model || !instances.length) return null;
    const n = instances.length;
    const set = { model, instances, ranges, maxDist, meshes: [], buffers: [], matrices: new Float32Array(n * 16) };
    const m = new THREE.Matrix4();
    instances.forEach((inst, i) => {
      _q.setFromEuler(new THREE.Euler(inst.tiltX || 0, inst.yaw || 0, inst.tiltZ || 0, 'YXZ'));
      const sc = inst.scale || 1;
      _s.set(sc * (inst.sx || 1), sc * (inst.sy || 1), sc * (inst.sz || 1));
      m.compose(inst.pos, _q, _s).toArray(set.matrices, i * 16);
      inst.radius = model.radius * sc;
    });
    model.levels.forEach((lvl, li) => {
      const buf = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16).setUsage(THREE.DynamicDrawUsage);
      const meshes = lvl.parts.map(p => {
        const im = new THREE.InstancedMesh(p.geometry, p.material, 0);
        im.instanceMatrix = buf;
        im.castShadow = castShadow && li === 0;
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.visible = false;
        this.scene.add(im);
        return im;
      });
      set.meshes.push(meshes);
      set.buffers.push(buf);
    });
    this.sets.push(set);
    set.dirty = true;
    return set;
  }

  update(camera, force = false) {
    const cam = camera.position;
    this._pm = this._pm || new THREE.Matrix4();
    this._fr = this._fr || new THREE.Frustum();
    this._sp = this._sp || new THREE.Sphere();
    this._pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const moved = !this.lastPM || !this.lastPM.equals(this._pm);
    if (!moved && !force && !this.sets.some(s => s.dirty)) return;
    this.lastPM = (this.lastPM || new THREE.Matrix4()).copy(this._pm);
    this._fr.setFromProjectionMatrix(this._pm);
    const fr = this._fr, sp = this._sp;
    for (const set of this.sets) {
      set.dirty = false;
      const nL = set.meshes.length;
      const counts = new Array(nL).fill(0);
      const src = set.matrices;
      for (let i = 0; i < set.instances.length; i++) {
        const inst = set.instances[i];
        if (inst.hidden) continue;
        const d = inst.pos.distanceTo(cam) - inst.radius;
        if (d > set.maxDist) continue;
        sp.center.copy(inst.pos); sp.radius = inst.radius * 1.2 + (d < 900 ? 70 : 2);
        if (d > 30 && !fr.intersectsSphere(sp)) continue;
        let li = 0;
        while (li < nL - 1 && d > set.ranges[li]) li++;
        const dst = set.buffers[li].array, k = counts[li]++ * 16, s = i * 16;
        for (let j = 0; j < 16; j++) dst[k + j] = src[s + j];
      }
      for (let li = 0; li < nL; li++) {
        const c = counts[li], buf = set.buffers[li];
        for (const im of set.meshes[li]) { im.count = c; im.visible = c > 0; }
        if (c > 0) { buf.clearUpdateRanges(); buf.addUpdateRange(0, c * 16); buf.needsUpdate = true; }
      }
    }
  }
}
