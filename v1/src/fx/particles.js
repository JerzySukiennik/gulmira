// CPU-simulated, GPU-drawn particles: lit soft smoke/dust (alpha) and fire/sparks/glows (additive).
import * as THREE from 'three';
import { DEPTH_GLSL } from '../core/renderer.js';

const MAX_ALPHA = 9000;
const MAX_ADD = 6000;
const _v = new THREE.Vector3();

function makeAtlas() {
  const S = 1024, H = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const noise = (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    const l = (t, p, q) => p + t * (q - p);
    return l(v, l(u, grad(perm[a], x, y), grad(perm[b], x - 1, y)), l(u, grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1)));
  };
  const fbm = (x, y, o) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * noise(x * f, y * f); a *= 0.5; f *= 2.03; } return s; };
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * H, oy = Math.floor(q / 2) * H;
    const sx = rnd() * 100, sy = rnd() * 100;
    for (let y = 0; y < H; y++) for (let x = 0; x < H; x++) {
      const u = (x / H) * 2 - 1, v = (y / H) * 2 - 1;
      const r = Math.hypot(u, v);
      const n = fbm(u * 2.2 + sx, v * 2.2 + sy, 6);
      const n2 = fbm(u * 5 + sx * 2, v * 5 + sy, 4);
      let d = 1 - r * (1.05 - 0.55 * n);
      d = Math.max(0, d);
      const dens = Math.pow(Math.min(1, d * 1.6), 1.5) * (0.75 + 0.5 * n2);
      const nx = -u * 0.6 + n2 * 0.6, ny = -v * 0.6 + fbm(u * 5 + 9, v * 5 + 3, 4) * 0.6;
      const o = ((oy + y) * S + ox + x) * 4;
      img.data[o] = Math.max(0, Math.min(255, 128 + nx * 127));
      img.data[o + 1] = Math.max(0, Math.min(255, 128 + ny * 127));
      img.data[o + 2] = Math.max(0, Math.min(255, (0.5 + n2 * 0.9) * 255));
      img.data[o + 3] = Math.max(0, Math.min(255, dens * 255));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 iPos;
attribute vec4 iCol;
attribute vec4 iMisc;
attribute vec3 iVel;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vMisc;
varying vec3 vWorld;
varying float vViewZ;
varying vec3 vFogWorldPos;
varying float vFogDepth;
uniform float uStretch;
void main() {
  float size = iPos.w;
  float rot = iMisc.x;
  vec3 wp = iPos.xyz;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vec2 corner = position.xy;
  float c = cos(rot), s = sin(rot);
  vec2 rc = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  if (uStretch > 0.5 && dot(iVel, iVel) > 0.01) {
    vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
    vec2 d = vv.xy;
    float l = length(d);
    if (l > 1e-4) {
      d /= l;
      vec2 n = vec2(-d.y, d.x);
      float stretch = 1.0 + l * iMisc.w;
      rc = d * corner.y * size * stretch + n * corner.x * size * 0.35;
      mv.xyz += vec3(rc, 0.0);
    } else mv.xy += rc * size;
  } else {
    mv.xy += rc * size;
  }
  vUv = uv;
  vCol = iCol;
  vMisc = iMisc;
  vWorld = wp;
  vFogWorldPos = wp;
  vViewZ = -mv.z;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform sampler2D tAtlas;
uniform sampler2D tDepth;
uniform vec2 uRes;
${DEPTH_GLSL}
uniform float uAdditive;
uniform vec3 uSunDirP;
uniform vec3 uSunColP;
uniform vec3 uAmbient;
uniform vec3 uGroundAmb;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vMisc;
varying vec3 vWorld;
varying float vViewZ;
void main() {
  #include <logdepthbuf_fragment>
  float frame = vMisc.y;
  vec2 cell = vec2(mod(frame, 2.0), floor(frame / 2.0)) * 0.5;
  vec4 t = texture2D(tAtlas, cell + vUv * 0.5);
  float kind = vMisc.z;
  float a = t.a * vCol.a;
  vec2 suv = gl_FragCoord.xy / uRes;
  float dz = texture2D(tDepth, suv).r;
  float sceneZ = viewDepth(dz);
  float soft = clamp((sceneZ - vViewZ) / max(0.4, vMisc.w * 0.0 + 1.2), 0.0, 1.0);
  a *= soft;
  if (a < 0.003) discard;
  vec3 col;
  if (uAdditive > 0.5) {
    float core = smoothstep(0.2, 1.0, t.a);
    if (kind > 1.5) {
      float r = length(vUv - 0.5) * 2.0;
      float g = pow(max(0.0, 1.0 - r), 2.2);
      a = g * vCol.a * soft;
      col = vCol.rgb * (1.0 + 2.0 * g);
    } else {
      col = vCol.rgb * (0.6 + 1.6 * core) * (0.7 + 0.6 * t.b);
    }
    gl_FragColor = vec4(col * a, a);
  } else {
    vec3 n = normalize(vec3((t.rg - 0.5) * 2.0, 0.6));
    vec3 view = normalize(cameraPosition - vWorld);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), view));
    vec3 up = cross(view, right);
    vec3 wn = normalize(right * n.x + up * n.y + view * n.z);
    float sunD = clamp(dot(wn, uSunDirP) * 0.6 + 0.4, 0.0, 1.0);
    float scatter = pow(max(0.0, dot(-view, uSunDirP)), 6.0) * (1.0 - a) * 1.5;
    vec3 amb = mix(uGroundAmb, uAmbient, wn.y * 0.5 + 0.5);
    col = vCol.rgb * (amb + uSunColP * (sunD + scatter) * vMisc.w) * (0.75 + 0.35 * t.b);
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
  }
}`;

class Pool {
  constructor(max, additive, atmo, renderer) {
    this.max = max;
    this.count = 0;
    this.p = [];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol); g.setAttribute('iMisc', this.aMisc); g.setAttribute('iVel', this.aVel);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geometry = g;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      tAtlas: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uDepthP: { value: new THREE.Vector3() },
      uAdditive: { value: additive ? 1 : 0 }, uStretch: { value: additive ? 1 : 0 },
      uSunDirP: { value: new THREE.Vector3() }, uSunColP: { value: new THREE.Color() },
      uAmbient: { value: new THREE.Color(0.25, 0.28, 0.34) }, uGroundAmb: { value: new THREE.Color(0.16, 0.13, 0.1) },
    }]);
    Object.assign(uniforms, atmo.uniforms);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms,
      transparent: true, depthWrite: false, fog: true,
      defines: additive ? {} : { GUL_ATMO: '' },
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      premultipliedAlpha: false,
    });
    if (additive) { this.material.blendEquation = THREE.AddEquation; this.material.blendSrcAlpha = THREE.ZeroFactor; this.material.blendDstAlpha = THREE.OneFactor; }
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(1);
    this.mesh.renderOrder = additive ? 20 : 10;
    this.additive = additive;
  }
}

export class Particles {
  constructor(scene, atmo, renderer) {
    this.atlas = makeAtlas();
    this.alpha = new Pool(MAX_ALPHA, false, atmo, renderer);
    this.add = new Pool(MAX_ADD, true, atmo, renderer);
    for (const p of [this.alpha, this.add]) {
      p.material.uniforms.tAtlas.value = this.atlas;
      p.material.uniforms.uSunDirP.value.copy(atmo.sunDir);
      p.material.uniforms.uSunColP.value.copy(atmo.sunLightColor).multiplyScalar(1 / Math.PI);
      scene.add(p.mesh);
    }
    this.atmo = atmo;
    this.wind = new THREE.Vector3(1.6, 0, -0.6);
  }

  setFrame(renderer, depthTex, w, h, camera) {
    for (const p of [this.alpha, this.add]) {
      const u = p.material.uniforms;
      u.tDepth.value = depthTex;
      u.uRes.value.set(w, h);
      if (renderer.capabilities.reverseDepthBuffer) u.uDepthP.value.set(1, camera.near, camera.far);
      else u.uDepthP.value.set(0, camera.near, Math.log2(camera.far + 1));
    }
  }

  // kind: 0 smoke/dust (alpha), 1 fire (add), 2 glow (add), 3 spark (add, stretched)
  emit(o) {
    const additive = o.kind >= 1;
    const pool = additive ? this.add : this.alpha;
    if (pool.p.length >= pool.max) pool.p.shift();
    const q = {
      x: o.pos.x, y: o.pos.y, z: o.pos.z,
      vx: o.vel ? o.vel.x : 0, vy: o.vel ? o.vel.y : 0, vz: o.vel ? o.vel.z : 0,
      size: o.size ?? 1, grow: o.grow ?? 0, life: o.life ?? 2, age: 0,
      r: o.color ? o.color[0] : 1, g: o.color ? o.color[1] : 1, b: o.color ? o.color[2] : 1,
      r2: o.color2 ? o.color2[0] : null, g2: o.color2 ? o.color2[1] : 0, b2: o.color2 ? o.color2[2] : 0,
      a: o.alpha ?? 1, fadeIn: o.fadeIn ?? 0.08, rot: o.rot ?? Math.random() * 6.283, rotV: o.rotV ?? (Math.random() - 0.5) * 0.6,
      drag: o.drag ?? 0.5, grav: o.grav ?? 0, buoy: o.buoy ?? 0, kind: o.kind ?? 0, frame: o.frame ?? Math.floor(Math.random() * 4),
      lit: o.lit ?? 1, stretch: o.stretch ?? 0.06, wind: o.wind ?? 1, curve: o.curve ?? 1.2, bounce: o.bounce ?? false, groundY: o.groundY ?? -1e9,
    };
    pool.p.push(q);
    return q;
  }

  update(dt, camera) {
    const cam = camera.position;
    for (const pool of [this.alpha, this.add]) {
      const P = pool.p;
      let w = 0;
      for (let i = 0; i < P.length; i++) {
        const q = P[i];
        q.age += dt;
        if (q.age >= q.life) continue;
        const dr = Math.exp(-q.drag * dt);
        q.vx = q.vx * dr + this.wind.x * q.wind * (1 - dr);
        q.vz = q.vz * dr + this.wind.z * q.wind * (1 - dr);
        q.vy = q.vy * dr - q.grav * dt + q.buoy * dt;
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        if (q.bounce && q.y < q.groundY) { q.y = q.groundY; q.vy = -q.vy * 0.3; q.vx *= 0.6; q.vz *= 0.6; }
        q.rot += q.rotV * dt;
        P[w++] = q;
      }
      P.length = w;
      if (!pool.additive) {
        for (const q of P) q.d = (q.x - cam.x) ** 2 + (q.y - cam.y) ** 2 + (q.z - cam.z) ** 2;
        P.sort((a, b) => b.d - a.d);
      }
      const ap = pool.aPos.array, ac = pool.aCol.array, am = pool.aMisc.array, av = pool.aVel.array;
      const n = Math.min(P.length, pool.max);
      for (let i = 0; i < n; i++) {
        const q = P[i];
        const t = q.age / q.life;
        const size = q.size + q.grow * Math.pow(t, 0.55) * q.life;
        const fin = q.fadeIn > 0 ? Math.min(1, q.age / q.fadeIn) : 1;
        const fout = Math.pow(1 - t, q.curve);
        let r = q.r, g = q.g, b = q.b;
        if (q.r2 !== null) { const k = Math.min(1, t * 1.6); r += (q.r2 - r) * k; g += (q.g2 - g) * k; b += (q.b2 - b) * k; }
        ap[i * 4] = q.x; ap[i * 4 + 1] = q.y; ap[i * 4 + 2] = q.z; ap[i * 4 + 3] = size;
        ac[i * 4] = r; ac[i * 4 + 1] = g; ac[i * 4 + 2] = b; ac[i * 4 + 3] = q.a * fin * fout;
        am[i * 4] = q.rot; am[i * 4 + 1] = q.frame; am[i * 4 + 2] = q.kind; am[i * 4 + 3] = q.kind === 3 ? q.stretch : q.lit;
        av[i * 3] = q.vx; av[i * 3 + 1] = q.vy; av[i * 3 + 2] = q.vz;
      }
      pool.geometry.instanceCount = n;
      for (const a of [pool.aPos, pool.aCol, pool.aMisc]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
      pool.aVel.clearUpdateRanges(); pool.aVel.addUpdateRange(0, n * 3); pool.aVel.needsUpdate = true;
    }
  }
}
