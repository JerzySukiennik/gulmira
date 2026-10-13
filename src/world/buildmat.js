// World-space triplanar materials for adobe architecture and generic props.
import * as THREE from 'three';
import { textureArray } from '../core/textures.js';

const COMMON_PARS = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray tBAlb;
uniform sampler2DArray tBNrm;
uniform sampler2DArray tBArm;
uniform float uTile;
varying vec3 vBPos;
varying vec3 vBNor;
varying vec4 vBMat;
float bHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float bNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(bHash(i), bHash(i + vec2(1, 0)), u.x), mix(bHash(i + vec2(0, 1)), bHash(i + vec2(1, 1)), u.x), u.y); }
float bFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * bNoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
struct BS { vec3 alb; vec3 nrm; vec3 arm; };
BS triSample(float layer, vec3 p, vec3 n, float tile) {
  vec3 w = pow(abs(n), vec3(6.0));
  w /= (w.x + w.y + w.z);
  vec2 ux = p.zy / tile, uy = p.xz / tile, uz = p.xy / tile;
  BS r;
  vec3 ax = texture(tBAlb, vec3(ux, layer)).rgb, ay = texture(tBAlb, vec3(uy, layer)).rgb, az = texture(tBAlb, vec3(uz, layer)).rgb;
  r.alb = ax * w.x + ay * w.y + az * w.z;
  vec3 mx = texture(tBArm, vec3(ux, layer)).rgb, my = texture(tBArm, vec3(uy, layer)).rgb, mz = texture(tBArm, vec3(uz, layer)).rgb;
  r.arm = mx * w.x + my * w.y + mz * w.z;
  vec3 nx = texture(tBNrm, vec3(ux, layer)).xyz * 2.0 - 1.0;
  vec3 ny = texture(tBNrm, vec3(uy, layer)).xyz * 2.0 - 1.0;
  vec3 nz = texture(tBNrm, vec3(uz, layer)).xyz * 2.0 - 1.0;
  vec3 px = vec3(0.0, -nx.y, nx.x) * sign(n.x);
  vec3 py = vec3(ny.x, 0.0, -ny.y);
  vec3 pz = vec3(nz.x, -nz.y, 0.0) * sign(n.z);
  r.nrm = px * w.x + py * w.y + pz * w.z;
  return r;
}
`;

export async function loadBuildingArrays() {
  const T = 'assets/textures/';
  const layers = ['clay_plaster', 'worn_cracked_plaster', 'rough_plaster_brick_04', 'excavated_soil_wall'];
  const [alb, nrm, arm] = await Promise.all([
    textureArray(layers.map(l => T + l + '/diff.jpg'), 1024, { srgb: true }),
    textureArray(layers.map(l => T + l + '/nor.jpg'), 1024),
    textureArray(layers.map(l => T + l + '/arm.jpg'), 512),
  ]);
  return { alb, nrm, arm };
}

// vertex attribute aBMat: x = base layer weight split (0 clay .. 1 cracked), y = brick exposure, z = mud, w = grime
export function makeAdobeMaterial(atmo, arrays) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, vertexColors: true });
  const u = { tBAlb: { value: arrays.alb }, tBNrm: { value: arrays.nrm }, tBArm: { value: arrays.arm }, uTile: { value: 2.6 } };
  atmo.patch(mat, {
    key: 'adobe',
    extra: (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aBMat;\nvarying vec3 vBPos;\nvarying vec3 vBNor;\nvarying vec4 vBMat;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvBNor = normalize(mat3(modelMatrix) * objectNormal);\nvBMat = aBMat;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + COMMON_PARS)
        .replace('#include <map_fragment>', /* glsl */`
          vec3 bn = normalize(vBNor);
          float big = bFbm(vBPos.xz * 0.35 + vBPos.y * 0.2);
          float spots = bFbm(vBPos.xz * 0.9 + vec2(vBPos.y * 0.7, 3.0));
          BS L0 = triSample(0.0, vBPos, bn, uTile);
          BS L1 = triSample(1.0, vBPos, bn, uTile * 1.7);
          float wb = clamp(vBMat.x * 0.6 + 0.35 + (big - 0.5) * 0.9, 0.0, 1.0);
          L0.nrm *= 0.55;
          BS L;
          L.alb = mix(L0.alb, L1.alb, wb); L.nrm = mix(L0.nrm, L1.nrm, wb); L.arm = mix(L0.arm, L1.arm, wb);
          float brick = smoothstep(0.62, 0.7, spots + vBMat.y * 0.5) * step(0.3, 1.0 - abs(bn.y));
          if (brick > 0.01) { BS B = triSample(2.0, vBPos, bn, uTile * 0.9); L.alb = mix(L.alb, B.alb, brick); L.nrm = mix(L.nrm, B.nrm * 1.3, brick); L.arm = mix(L.arm, B.arm, brick); }
          float mud = clamp(vBMat.z, 0.0, 1.0) * (0.6 + 0.4 * big);
          if (mud > 0.01) { BS M = triSample(3.0, vBPos, bn, uTile * 1.3); L.alb = mix(L.alb, M.alb, mud); L.nrm = mix(L.nrm, M.nrm, mud); L.arm = mix(L.arm, M.arm, mud); }
          vec3 balb = L.alb * vColor.rgb;
          float grimeY = vBMat.w;
          balb *= 1.0 - 0.35 * grimeY * (0.6 + 0.4 * bNoise(vBPos.xz * 3.0 + vBPos.y));
          float streak = bNoise(vec2((vBPos.x + vBPos.z) * 4.0, vBPos.y * 0.25)) * (1.0 - abs(bn.y));
          balb *= 1.0 - 0.12 * smoothstep(0.55, 0.9, streak);
          diffuseColor.rgb = balb;
          float bRough = clamp(L.arm.g * 1.05, 0.6, 1.0);
          float bAO = L.arm.r;
          vec3 bPert = L.nrm;
        `)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = bRough;')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(normalize(bn + bPert * 0.9), 0.0)).xyz);')
        .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= bAO; reflectedLight.indirectSpecular *= bAO;');
    },
  });
  return mat;
}

// Generic triplanar PBR (wood, metal, cloth) from a single Poly Haven set with vertex color tint.
export function makeTriMaterial(atmo, set, { tile = 1.5, rough = 1, metal = 0, key = 'tri', side = THREE.FrontSide } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: metal, vertexColors: true, side });
  const u = { tTA: { value: set.map }, tTN: { value: set.normalMap }, tTR: { value: set.arm }, uTTile: { value: tile } };
  atmo.patch(mat, {
    key: 'tri-' + key,
    extra: (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTPos;\nvarying vec3 vTNor;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTNor = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tTA;\nuniform sampler2D tTN;\nuniform sampler2D tTR;\nuniform float uTTile;\nvarying vec3 vTPos;\nvarying vec3 vTNor;')
        .replace('#include <map_fragment>', /* glsl */`
          vec3 tn = normalize(vTNor);
          vec3 tw = pow(abs(tn), vec3(6.0)); tw /= (tw.x + tw.y + tw.z);
          vec2 tux = vTPos.zy / uTTile, tuy = vTPos.xz / uTTile, tuz = vTPos.xy / uTTile;
          vec3 talb = texture2D(tTA, tux).rgb * tw.x + texture2D(tTA, tuy).rgb * tw.y + texture2D(tTA, tuz).rgb * tw.z;
          vec3 tarm = texture2D(tTR, tux).rgb * tw.x + texture2D(tTR, tuy).rgb * tw.y + texture2D(tTR, tuz).rgb * tw.z;
          vec3 tnx = texture2D(tTN, tux).xyz * 2.0 - 1.0, tny = texture2D(tTN, tuy).xyz * 2.0 - 1.0, tnz = texture2D(tTN, tuz).xyz * 2.0 - 1.0;
          vec3 tpert = vec3(0.0, -tnx.y, tnx.x) * sign(tn.x) * tw.x + vec3(tny.x, 0.0, -tny.y) * tw.y + vec3(tnz.x, -tnz.y, 0.0) * sign(tn.z) * tw.z;
          diffuseColor.rgb = talb * vColor.rgb;
        `)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(tarm.g * roughness, 0.05, 1.0);')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = clamp(tarm.b + metalness, 0.0, 1.0);')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(normalize(tn * (gl_FrontFacing ? 1.0 : -1.0) + tpert * 0.8), 0.0)).xyz);')
        .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= tarm.r; reflectedLight.indirectSpecular *= tarm.r;');
    },
  });
  return mat;
}
