// Terrain: baked eroded heightfield rendered with CDLOD (morphing quadtree patches), PBR splatting,
// and CPU queries that match the GPU surface (bicubic heights + identical micro-relief noise).
import * as THREE from 'three';
import { fetchGzip, textureArray, imageTexture, tex } from '../core/textures.js';

const LEAF = 32;
const DIM = 16;
const LEVELS = 12;
const ROOT = LEAF * (1 << (LEVELS - 1));
const RANGE0 = 90;

const HASH_GLSL = /* glsl */`
uint tHashU(uvec2 p) { p = p * uvec2(1597334673u, 3812015801u); uint n = (p.x ^ p.y) * 1597334673u; return n; }
float tVal(vec2 x) {
  vec2 i = floor(x), f = x - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  uvec2 b = uvec2(ivec2(i) + 65536);
  float a = float(tHashU(b)) / 4294967295.0;
  float c = float(tHashU(b + uvec2(1u, 0u))) / 4294967295.0;
  float d = float(tHashU(b + uvec2(0u, 1u))) / 4294967295.0;
  float e = float(tHashU(b + uvec2(1u, 1u))) / 4294967295.0;
  return mix(mix(a, c, u.x), mix(d, e, u.x), u.y);
}
float tMicro(vec2 p) { return (tVal(p * 0.31) - 0.5) * 0.55 + (tVal(p * 0.83 + 17.0) - 0.5) * 0.18; }
`;

function tHashU(x, y) {
  const px = Math.imul(x, 1597334673) >>> 0;
  const py = Math.imul(y, 3812015801 | 0) >>> 0;
  return Math.imul((px ^ py) >>> 0, 1597334673) >>> 0;
}
function tVal(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const bx = (ix + 65536) >>> 0, by = (iy + 65536) >>> 0;
  const a = tHashU(bx, by) / 4294967295, c = tHashU(bx + 1, by) / 4294967295;
  const d = tHashU(bx, by + 1) / 4294967295, e = tHashU(bx + 1, by + 1) / 4294967295;
  return (a + (c - a) * ux) + ((d + (e - d) * ux) - (a + (c - a) * ux)) * uy;
}
function tMicro(x, z) { return (tVal(x * 0.31, z * 0.31) - 0.5) * 0.55 + (tVal(x * 0.83 + 17, z * 0.83 + 17) - 0.5) * 0.18; }

const VERT_PARS = /* glsl */`
uniform sampler2D tHeight;
uniform vec4 uTerrV;
uniform vec2 uMorph[${LEVELS}];
attribute vec4 aNode;
varying vec2 vTerrXZ;
varying float vTerrDist;
${HASH_GLSL}
int tFold(int i, int n) { int p = 2 * (n - 1); i = i - p * int(floor(float(i) / float(p))); if (i > n - 1) i = p - i; return clamp(i, 0, n - 1); }
float tTex(int x, int y) { int n = int(uTerrV.x); return texelFetch(tHeight, ivec2(tFold(x, n), tFold(y, n)), 0).r; }
float tCubic(float a, float b, float c, float d, float t) { return b + 0.5 * t * (c - a + t * (2.0 * a - 5.0 * b + 4.0 * c - d + t * (3.0 * (b - c) + d - a))); }
float terrHeight(vec2 xz) {
  vec2 u = (xz + uTerrV.z) / uTerrV.y;
  vec2 fi = floor(u);
  vec2 f = u - fi;
  int ix = int(fi.x), iy = int(fi.y);
  float r[4];
  for (int j = 0; j < 4; j++) {
    int y = iy + j - 1;
    r[j] = tCubic(tTex(ix - 1, y), tTex(ix, y), tTex(ix + 1, y), tTex(ix + 2, y), f.x);
  }
  return tCubic(r[0], r[1], r[2], r[3], f.y) + tMicro(xz);
}
`;

const VERT_BEGIN = /* glsl */`
vec2 tg = position.xz;
float tSpacing = aNode.z / ${DIM.toFixed(1)};
vec2 twp = aNode.xy + tg * tSpacing;
float th0 = terrHeight(twp);
float tdist = distance(vec3(twp.x, th0, twp.y), cameraPosition);
vec2 tmr = uMorph[int(aNode.w)];
float tk = clamp((tdist - tmr.x) / (tmr.y - tmr.x), 0.0, 1.0);
vec2 tfrac = fract(tg * 0.5) * 2.0;
twp -= tfrac * tSpacing * tk;
float th = terrHeight(twp);
vTerrXZ = twp;
vTerrDist = tdist;
vec3 transformed = vec3(twp.x, th, twp.y);
`;

const FRAG_PARS = /* glsl */`
precision highp sampler2DArray;
uniform sampler2D tHeight;
uniform sampler2D tSplat;
uniform sampler2D tTNormal;
uniform sampler2DArray tAlb;
uniform sampler2DArray tNrm;
uniform sampler2DArray tArm;
uniform sampler2D tMacro;
uniform vec4 uTerrV;
uniform vec4 uVillage;
varying vec2 vTerrXZ;
varying float vTerrDist;
float fHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float fNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1, 0)), u.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), u.x), u.y);
}
float fFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * fNoise(p); p = p * 2.07 + 13.1; a *= 0.5; } return s; }
float fTex(ivec2 p) { int n = int(uTerrV.x); p = clamp(p, ivec2(0), ivec2(n - 1)); return texelFetch(tHeight, p, 0).r; }
float fHeight(vec2 xz) {
  vec2 u = (xz + uTerrV.z) / uTerrV.y;
  vec2 fi = floor(u); vec2 f = u - fi; ivec2 i = ivec2(fi);
  return mix(mix(fTex(i), fTex(i + ivec2(1, 0)), f.x), mix(fTex(i + ivec2(0, 1)), fTex(i + ivec2(1, 1)), f.x), f.y);
}
struct TL { vec3 alb; vec3 nrm; vec3 arm; };
vec3 gT; vec3 gB; float gFar;
TL farLayer(float layer) {
  TL t;
  t.alb = textureLod(tAlb, vec3(0.5, 0.5, layer), 12.0).rgb;
  t.nrm = vec3(0.0);
  t.arm = textureLod(tArm, vec3(0.5, 0.5, layer), 12.0).rgb;
  return t;
}
TL sampleLayer(float layer, vec2 uv, float rot) {
  float c = cos(rot), s = sin(rot);
  vec2 ruv = mat2(c, -s, s, c) * uv;
  TL t;
  t.alb = texture(tAlb, vec3(ruv, layer)).rgb;
  vec3 n = texture(tNrm, vec3(ruv, layer)).xyz * 2.0 - 1.0;
  n.xy = mat2(c, s, -s, c) * n.xy;
  t.nrm = n;
  t.arm = texture(tArm, vec3(ruv, layer)).rgb;
  return t;
}
vec2 hexHash(ivec2 p) {
  vec2 q = vec2(p);
  q = vec2(dot(q, vec2(127.1, 311.7)), dot(q, vec2(269.5, 183.3)));
  return fract(sin(q) * 43758.5453);
}
TL hexSampleX(float layer, vec2 uv, float rotAmt, float detile) {
  vec2 st = uv * 2.0 * 1.7320508;
  vec2 sk = mat2(1.0, 0.0, -0.57735027, 1.15470054) * st;
  ivec2 base = ivec2(floor(sk));
  vec3 tmp = vec3(fract(sk), 0.0);
  tmp.z = 1.0 - tmp.x - tmp.y;
  float s = step(0.0, -tmp.z);
  float s2 = 2.0 * s - 1.0;
  float w1 = -tmp.z * s2, w2 = s - tmp.y * s2, w3 = s - tmp.x * s2;
  ivec2 v1 = base + ivec2(int(s), int(s));
  ivec2 v2 = base + ivec2(int(s), int(1.0 - s));
  ivec2 v3 = base + ivec2(int(1.0 - s), int(s));
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec3 alb[3]; vec3 nrm[3]; vec3 arm[3];
  ivec2 vs[3]; vs[0] = v1; vs[1] = v2; vs[2] = v3;
  for (int i = 0; i < 3; i++) {
    vec2 h = hexHash(vs[i]);
    float a = h.x * 6.2831853 * rotAmt;
    float c = cos(a), sn = sin(a);
    mat2 R = mat2(c, -sn, sn, c);
    vec2 u2 = R * uv + h * 7.31;
    vec3 tc = vec3(u2, layer);
    alb[i] = textureGrad(tAlb, tc, R * dx, R * dy).rgb;
    if (detile > 0.0) alb[i] *= textureLod(tAlb, vec3(0.5, 0.5, layer), 12.0).rgb / max(textureLod(tAlb, tc, 8.0).rgb, vec3(0.02));
    vec3 n = textureGrad(tNrm, tc, R * dx, R * dy).xyz * 2.0 - 1.0;
    n.xy = mat2(c, sn, -sn, c) * n.xy;
    nrm[i] = n;
    arm[i] = textureGrad(tArm, tc, R * dx, R * dy).rgb;
  }
  vec3 W = vec3(w1, w2, w3);
  vec3 lum = vec3(dot(alb[0], vec3(0.33)), dot(alb[1], vec3(0.33)), dot(alb[2], vec3(0.33)));
  W = W * (0.6 + lum);
  W = pow(W, vec3(7.0));
  W /= (W.x + W.y + W.z);
  TL r;
  r.alb = alb[0] * W.x + alb[1] * W.y + alb[2] * W.z;
  r.nrm = nrm[0] * W.x + nrm[1] * W.y + nrm[2] * W.z;
  r.arm = arm[0] * W.x + arm[1] * W.y + arm[2] * W.z;
  return r;
}
TL hexSample(float layer, vec2 uv) { return hexSampleX(layer, uv, 1.0, 0.0); }
TL sampleLayer2(float layer, vec2 xz, float tile, float var) {
  if (gFar > 0.999) return farLayer(layer);
  TL a = hexSample(layer, xz / tile);
  vec3 n = normalize(a.nrm);
  a.nrm = gT * n.x - gB * n.y;
  return a;
}
TL triLayer(float layer, vec3 wp, vec3 n, float tile) {
  if (gFar > 0.999) return farLayer(layer);
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  TL x = hexSampleX(layer, wp.zy / tile, 0.0, 1.0);
  TL y = hexSampleX(layer, wp.xz / tile, 1.0, 1.0);
  TL z = hexSampleX(layer, wp.xy / tile, 0.0, 1.0);
  TL r;
  r.alb = x.alb * w.x + y.alb * w.y + z.alb * w.z;
  r.arm = x.arm * w.x + y.arm * w.y + z.arm * w.z;
  vec3 nx = vec3(0.0, -x.nrm.y, x.nrm.x);
  vec3 ny = vec3(y.nrm.x, 0.0, -y.nrm.y);
  vec3 nz = vec3(z.nrm.x, -z.nrm.y, 0.0);
  r.nrm = nx * w.x + ny * w.y + nz * w.z;
  return r;
}
TL blendH(TL a, TL b, float w, float sharp) {
  float ha = a.arm.r + 0.25 * dot(a.alb, vec3(0.33));
  float hb = b.arm.r + 0.25 * dot(b.alb, vec3(0.33));
  float t = clamp((hb + w * 2.0 - 1.0 - ha) * sharp + 0.5, 0.0, 1.0);
  t = mix(w, t, step(0.001, w) * step(w, 0.999));
  TL r;
  r.alb = mix(a.alb, b.alb, t);
  r.nrm = mix(a.nrm, b.nrm, t);
  r.arm = mix(a.arm, b.arm, t);
  return r;
}
`;

const FRAG_MAP = /* glsl */`
vec2 wxz = vTerrXZ;
vec2 nuv = (wxz + uTerrV.z) / uTerrV.y + 0.5;
vec3 nTex = texture2D(tTNormal, nuv / uTerrV.x).xyz * 2.0 - 1.0;
nTex.y = nTex.y * 0.5 + 0.5;
vec3 nGeo = normalize(vec3(nTex.x, nTex.y, nTex.z));
gT = normalize(vec3(1.0, 0.0, 0.0) - nGeo * nGeo.x);
gB = normalize(cross(gT, nGeo));
vec3 wpos = vec3(wxz.x, vFogWorldPos.y, wxz.y);
vec4 sp = texture2D(tSplat, (wxz + uTerrV.z) / (uTerrV.y * uTerrV.x));
float slope = 1.0 - nGeo.y;
float n1 = fFbm(wxz * 0.013);
float n2 = fFbm(wxz * 0.11 + 7.0);
float n3 = fFbm(wxz * 0.6 + 3.0);
float vd = length(wxz - uVillage.xy);
float wSand = clamp(sp.r * 1.25 + (1.0 - smoothstep(0.02, 0.12, slope)) * (n1 - 0.35) * 0.9, 0.0, 1.0);
float wGrav = clamp(sp.a * 0.9 + (n2 - 0.55) * 0.6, 0.0, 1.0) * (1.0 - smoothstep(0.3, 0.5, slope));
float wRock = smoothstep(0.16, 0.36, slope + (n2 - 0.5) * 0.16 + sp.g * 0.18);
float wCliff = smoothstep(0.42, 0.7, slope + (n1 - 0.5) * 0.12);
float wRoad = smoothstep(0.2, 0.75, sp.b + (n3 - 0.5) * 0.25);
float wMud = (1.0 - smoothstep(uVillage.z * 0.55, uVillage.z, vd + (n2 - 0.5) * 90.0)) * smoothstep(0.35, 0.6, n2 + 0.2);
float far = smoothstep(500.0, 2200.0, vTerrDist);
gFar = far;
TL L = sampleLayer2(1.0, wxz, 4.0, n2);
if (wSand > 0.01) L = blendH(L, sampleLayer2(0.0, wxz, 3.2, n3), wSand, 3.0);
if (wGrav > 0.01) L = blendH(L, sampleLayer2(5.0, wxz, 2.6, n1), wGrav * 0.8, 3.0);
if (wMud > 0.01) L = blendH(L, sampleLayer2(4.0, wxz, 3.0, n3), wMud, 4.0);
if (wRoad > 0.01) L = blendH(L, sampleLayer2(4.0, wxz, 3.0, n1), wRoad, 5.0);
if (wRock > 0.01) L = blendH(L, sampleLayer2(2.0, wxz, 7.0, n1), wRock, 4.0);
if (wCliff > 0.01) {
  TL C = triLayer(3.0, wpos, nGeo, 14.0);
  float warp = fNoise(wxz * 0.006) * 6.0 + fNoise(wxz * 0.03) * 0.8;
  vec2 sp1 = vec2(wpos.y / 7.0 + warp, dot(wxz, vec2(0.0021, 0.0017)));
  float strata = 0.62 * fNoise(sp1) + 0.38 * fNoise(sp1 * vec2(2.7, 1.3) + 5.1);
  float sc = 1.0 - smoothstep(900.0, 3500.0, vTerrDist) * 0.6;
  C.alb *= mix(1.0, mix(0.72, 1.22, strata), sc) * mix(vec3(1.0), mix(vec3(1.07, 0.95, 0.85), vec3(0.93, 0.97, 1.03), fNoise(sp1 * 0.5 + 9.0)), sc);
  L = blendH(L, C, wCliff, 3.0);
}
vec3 macro = texture2D(tMacro, wxz / 520.0).rgb;
vec3 macro2 = texture2D(tMacro, wxz / 2100.0 + 0.31).rgb;
vec3 macroTint = (macro / max(vec3(0.001), vec3(dot(macro, vec3(0.333))))) ;
float macroLum = dot(macro2, vec3(0.333)) / 0.38;
vec3 alb = L.alb * mix(vec3(1.0), macroTint, 0.35) * mix(1.0, macroLum, 0.35);
alb = mix(alb, macro * 1.05, far * 0.55);
alb *= mix(1.0, 0.82, sp.a * (1.0 - wRoad) * 0.6);
alb *= 1.0 - 0.18 * sp.g * (1.0 - wSand);
alb = mix(vec3(dot(alb, vec3(0.3, 0.59, 0.11))), alb, 0.8);
vec3 terrAlb = alb;
float terrRough = clamp(L.arm.g * 1.05, 0.55, 1.0);
float terrAO = mix(L.arm.r, 1.0, far);
vec3 terrN = normalize(nGeo + L.nrm * (1.0 - far) * 1.1);
diffuseColor.rgb = terrAlb;
`;

export class Terrain {
  constructor(atmo) {
    this.atmo = atmo;
    this.ranges = [];
    for (let l = 0; l < LEVELS; l++) this.ranges.push(RANGE0 * Math.pow(2, l));
  }

  async load(base = 'assets/terrain/') {
    this.meta = await (await fetch(base + 'meta.json')).json();
    const { N, cell, size } = this.meta;
    this.N = N; this.cell = cell; this.size = size; this.half = size / 2;
    const dec = (buf, lo, hi) => {
      const u = new Uint16Array(buf);
      const out = new Float32Array(N * N);
      const sc = (hi - lo) / 65535;
      for (let j = 0; j < N; j++) {
        let p = 0;
        const row = j * N;
        for (let i = 0; i < N; i++) { p = (p + u[row + i]) & 0xffff; out[row + i] = lo + p * sc; }
      }
      return out;
    };
    const [hb, sb] = await Promise.all([fetchGzip(base + this.meta.height.file), fetchGzip(base + this.meta.shadow.file)]);
    this.H = dec(hb, this.meta.height.lo, this.meta.height.hi);
    this.S = dec(sb, this.meta.shadow.lo, this.meta.shadow.hi);
    const mk = (arr) => {
      const t = new THREE.DataTexture(arr, N, N, THREE.RedFormat, THREE.FloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    this.heightTex = mk(this.H);
    {
      const nrm = new Uint8Array(N * N * 4);
      const H = this.H, c2 = 2 * cell;
      for (let j = 0; j < N; j++) {
        const jm = Math.max(0, j - 1) * N, jp = Math.min(N - 1, j + 1) * N, row = j * N;
        for (let i = 0; i < N; i++) {
          const im = Math.max(0, i - 1), ip = Math.min(N - 1, i + 1);
          const dx = (H[row + im] - H[row + ip]) / c2, dz = (H[jm + i] - H[jp + i]) / c2;
          const l = Math.sqrt(dx * dx + 1 + dz * dz);
          const o = (row + i) * 4;
          nrm[o] = Math.round((dx / l * 0.5 + 0.5) * 255);
          nrm[o + 1] = Math.round((1 / l) * 255);
          nrm[o + 2] = Math.round((dz / l * 0.5 + 0.5) * 255);
          nrm[o + 3] = 255;
        }
      }
      const nt = new THREE.DataTexture(nrm, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      nt.minFilter = THREE.LinearMipmapLinearFilter; nt.magFilter = THREE.LinearFilter; nt.generateMipmaps = true;
      nt.wrapS = nt.wrapT = THREE.ClampToEdgeWrapping;
      nt.needsUpdate = true;
      this.normalTex = nt;
    }
    this.shadowTex = mk(this.S);
    this.splatTex = await imageTexture(base + this.meta.splat);
    this.atmo.setTerrainShadow(this.shadowTex, N, cell, this.half);
    const T = 'assets/textures/';
    const layers = ['gravelly_sand', 'dry_ground_rocks', 'tiger_rock', 'cliff_side', 'rocky_trail_02', 'sandy_gravel_02'];
    const [alb, nrm, arm] = await Promise.all([
      textureArray(layers.map(l => T + l + '/diff.jpg'), 2048, { srgb: true }),
      textureArray(layers.map(l => T + l + '/nor.jpg'), 2048),
      textureArray(layers.map(l => T + l + '/arm.jpg'), 1024),
    ]);
    this.layers = { alb, nrm, arm };
    this.macroTex = tex(T + 'rocky_terrain_02/diff.jpg', { srgb: true });
    this.buildMinMax();
    this.buildMesh();
  }

  fold(i) { const n = this.N, p = 2 * (n - 1); i %= p; if (i < 0) i += p; if (i > n - 1) i = p - i; return Math.max(0, Math.min(n - 1, i)); }
  texel(i, j) { return this.H[this.fold(j) * this.N + this.fold(i)]; }

  baseHeight(x, z) {
    const u = (x + this.half) / this.cell, v = (z + this.half) / this.cell;
    const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
    const c = (a, b, cc, d, t) => b + 0.5 * t * (cc - a + t * (2 * a - 5 * b + 4 * cc - d + t * (3 * (b - cc) + d - a)));
    const r = [0, 0, 0, 0];
    for (let j = 0; j < 4; j++) {
      const y = iy + j - 1;
      r[j] = c(this.texel(ix - 1, y), this.texel(ix, y), this.texel(ix + 1, y), this.texel(ix + 2, y), fx);
    }
    return c(r[0], r[1], r[2], r[3], fy);
  }

  heightAt(x, z) { return this.baseHeight(x, z) + tMicro(x, z); }

  normalAt(x, z, out = new THREE.Vector3(), e = 1.0) {
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  shadowHeightAt(x, z) {
    const u = (x + this.half) / this.cell, v = (z + this.half) / this.cell;
    if (u < 1 || v < 1 || u > this.N - 2 || v > this.N - 2) return -1e9;
    const i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, k = j * this.N + i, S = this.S;
    return S[k] * (1 - fx) * (1 - fy) + S[k + 1] * fx * (1 - fy) + S[k + this.N] * (1 - fx) * fy + S[k + this.N + 1] * fx * fy;
  }

  sunVisibility(x, y, z) {
    const s = this.shadowHeightAt(x, z);
    const d = y - s;
    const soft = 2.0 + 0.004 * Math.max(0, s - y);
    const t = Math.min(1, Math.max(0, (d + 1 + soft) / soft));
    return t * t * (3 - 2 * t);
  }

  raycast(origin, dir, maxDist = 20000, out = new THREE.Vector3()) {
    let t = 0, prevT = 0;
    let prevD = origin.y - this.heightAt(origin.x, origin.z);
    if (prevD < 0) return null;
    while (t < maxDist) {
      const step = Math.max(0.5, Math.min(40, prevD * 0.5));
      t += step;
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      const d = y - this.heightAt(x, z);
      if (d < 0) {
        let a = prevT, b = t;
        for (let i = 0; i < 12; i++) {
          const m = (a + b) * 0.5;
          const dm = origin.y + dir.y * m - this.heightAt(origin.x + dir.x * m, origin.z + dir.z * m);
          if (dm < 0) b = m; else a = m;
        }
        out.copy(dir).multiplyScalar(b).add(origin);
        out.t = b;
        return out;
      }
      prevT = t; prevD = d;
    }
    return null;
  }

  buildMinMax() {
    const cells = ROOT / LEAF;
    this.mm = [];
    let mn = new Float32Array(cells * cells), mx = new Float32Array(cells * cells);
    const tpc = LEAF / this.cell;
    const gLo = this.meta.height.lo - 2, gHi = this.meta.height.hi + 2;
    for (let cj = 0; cj < cells; cj++) for (let ci = 0; ci < cells; ci++) {
      const x0 = -ROOT / 2 + ci * LEAF, z0 = -ROOT / 2 + cj * LEAF;
      if (x0 + LEAF < -this.half || x0 > this.half || z0 + LEAF < -this.half || z0 > this.half) { mn[cj * cells + ci] = gLo; mx[cj * cells + ci] = gHi; continue; }
      const i0 = Math.floor((x0 + this.half) / this.cell) - 2, j0 = Math.floor((z0 + this.half) / this.cell) - 2;
      let lo = 1e9, hi = -1e9;
      for (let j = j0; j <= j0 + tpc + 4; j += 1) for (let i = i0; i <= i0 + tpc + 4; i += 1) {
        const h = this.texel(i, j);
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
      mn[cj * cells + ci] = lo - 1.5; mx[cj * cells + ci] = hi + 1.5;
    }
    this.mm.push({ n: cells, mn, mx });
    let n = cells;
    while (n > 1) {
      const n2 = n / 2, a = new Float32Array(n2 * n2), b = new Float32Array(n2 * n2);
      for (let j = 0; j < n2; j++) for (let i = 0; i < n2; i++) {
        const k = 2 * j * n + 2 * i;
        a[j * n2 + i] = Math.min(mn[k], mn[k + 1], mn[k + n], mn[k + n + 1]);
        b[j * n2 + i] = Math.max(mx[k], mx[k + 1], mx[k + n], mx[k + n + 1]);
      }
      this.mm.push({ n: n2, mn: a, mx: b });
      mn = a; mx = b; n = n2;
    }
  }

  buildMesh() {
    const g = new THREE.InstancedBufferGeometry();
    const verts = [], idx = [];
    for (let j = 0; j <= DIM; j++) for (let i = 0; i <= DIM; i++) verts.push(i, 0, j);
    for (let j = 0; j < DIM; j++) for (let i = 0; i < DIM; i++) {
      const a = j * (DIM + 1) + i, b = a + 1, c = a + DIM + 1, d = c + 1;
      if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(verts.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    this.maxInst = 4096;
    this.nodeAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.maxInst * 4), 4);
    this.nodeAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aNode', this.nodeAttr);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e7, -1e7, -1e7), new THREE.Vector3(1e7, 1e7, 1e7));
    this.geometry = g;

    const morph = [];
    for (let l = 0; l < LEVELS; l++) {
      const end = this.ranges[l] * 0.96;
      const prev = l === 0 ? 0 : this.ranges[l - 1];
      morph.push(new THREE.Vector2(prev + (end - prev) * 0.62, end));
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    const tu = {
      tHeight: { value: this.heightTex },
      tSplat: { value: this.splatTex },
      tTNormal: { value: this.normalTex },
      tAlb: { value: this.layers.alb },
      tNrm: { value: this.layers.nrm },
      tArm: { value: this.layers.arm },
      tMacro: { value: this.macroTex },
      uTerrV: { value: new THREE.Vector4(this.N, this.cell, this.half, 0) },
      uMorph: { value: morph },
      uVillage: { value: new THREE.Vector4(this.meta.sites.village.x, this.meta.sites.village.z, this.meta.sites.village.r, 0) },
    };
    this.uniforms = tu;
    this.atmo.patch(mat, {
      key: 'terrain',
      extra: (shader) => {
        Object.assign(shader.uniforms, tu);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n' + VERT_PARS)
          .replace('#include <begin_vertex>', VERT_BEGIN)
          .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
          .replace('#include <map_fragment>', FRAG_MAP)
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = terrRough;')
          .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
          .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(terrN, 0.0)).xyz);')
          .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= terrAO; reflectedLight.indirectSpecular *= terrAO * terrAO;');
      },
    });
    this.material = mat;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.frustum = new THREE.Frustum();
    this.box = new THREE.Box3();
    this.pm = new THREE.Matrix4();
  }

  nodeBox(x0, z0, size, level) {
    const lvl = this.mm[level];
    const n = lvl.n;
    const i = Math.floor((x0 + ROOT / 2) / size), j = Math.floor((z0 + ROOT / 2) / size);
    const k = Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i));
    this.box.min.set(x0, lvl.mn[k], z0);
    this.box.max.set(x0 + size, lvl.mx[k], z0 + size);
    return this.box;
  }

  update(camera) {
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    const cam = camera.position;
    const arr = this.nodeAttr.array;
    let count = 0;
    const add = (x, z, size, level) => {
      if (count >= this.maxInst) return;
      const o = count * 4;
      arr[o] = x; arr[o + 1] = z; arr[o + 2] = size; arr[o + 3] = level;
      count++;
    };
    const sphereHits = (box, r) => {
      const dx = Math.max(box.min.x - cam.x, 0, cam.x - box.max.x);
      const dy = Math.max(box.min.y - cam.y, 0, cam.y - box.max.y);
      const dz = Math.max(box.min.z - cam.z, 0, cam.z - box.max.z);
      return dx * dx + dy * dy + dz * dz <= r * r;
    };
    const select = (x0, z0, size, level) => {
      const box = this.nodeBox(x0, z0, size, level);
      if (!sphereHits(box, this.ranges[level])) return false;
      if (!this.frustum.intersectsBox(box)) return true;
      const h = size / 2;
      if (level === 0) {
        add(x0, z0, h, 0); add(x0 + h, z0, h, 0); add(x0, z0 + h, h, 0); add(x0 + h, z0 + h, h, 0);
        return true;
      }
      if (!sphereHits(box, this.ranges[level - 1])) {
        add(x0, z0, h, level); add(x0 + h, z0, h, level); add(x0, z0 + h, h, level); add(x0 + h, z0 + h, h, level);
        return true;
      }
      const kids = [[x0, z0], [x0 + h, z0], [x0, z0 + h], [x0 + h, z0 + h]];
      for (const [cx, cz] of kids) if (!select(cx, cz, h, level - 1)) add(cx, cz, h, level);
      return true;
    };
    select(-ROOT / 2, -ROOT / 2, ROOT, LEVELS - 1);
    this.geometry.instanceCount = count;
    this.nodeAttr.needsUpdate = true;
    this.nodeAttr.clearUpdateRanges();
    this.nodeAttr.addUpdateRange(0, count * 4);
    this.instances = count;
  }
}
