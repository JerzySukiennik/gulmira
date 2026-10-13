// Atmosphere: physically based sky LUT, sky dome with clouds, sun + cascaded shadows, IBL, and the
// material patch that gives every lit surface aerial perspective and baked mountain shadows.
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';

const KM = 1000;
const RE = 6360, RA = 6460, HR = 7.994, HM = 1.2;
const BR = [5.802e-3, 13.558e-3, 33.1e-3];
const BO = [0.650e-3, 1.881e-3, 0.085e-3];

const NOISE_GLSL = /* glsl */`
float gHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
}
float gFbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * gNoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}`;

const LUT_FRAG = /* glsl */`
precision highp float;
uniform vec3 uSunDir;
uniform float uSunI;
uniform float uMie;
uniform float uViewH;
uniform float uGround;
uniform vec3 uGroundCol;
varying vec2 vUv;
const float PI = 3.14159265;
const float Re = ${RE.toFixed(1)}, Ra = ${RA.toFixed(1)}, Hr = ${HR}, Hm = ${HM};
const vec3 bR = vec3(${BR.join(',')});
const vec3 bO = vec3(${BO.join(',')});
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float L = length(ro);
  float b = dot(ro, rd);
  float c = (L - r) * (L + r);
  float d = b * b - c;
  if (d < 0.0) return vec2(-1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
float ozone(float h) { return max(0.0, 1.0 - abs(h - 25.0) / 15.0); }
vec3 dirFromUV(vec2 uv) {
  float phi = (uv.x - 0.5) * 2.0 * PI;
  float v = uv.y * 2.0 - 1.0;
  float el = sign(v) * v * v * PI * 0.5;
  return vec3(cos(el) * sin(phi), sin(el), -cos(el) * cos(phi));
}
void main() {
  vec3 rd = dirFromUV(vUv);
  vec3 ro = vec3(0.0, Re + uViewH, 0.0);
  vec2 ta = raySphere(ro, rd, Ra);
  float tmax = ta.y;
  vec2 tg = raySphere(ro, rd, Re);
  bool hitG = tg.x > 0.0;
  if (hitG) tmax = tg.x;
  const int NS = 40;
  float dt = tmax / float(NS);
  vec3 bM = vec3(uMie);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0, odO = 0.0;
  for (int i = 0; i < NS; i++) {
    vec3 p = ro + rd * (dt * (float(i) + 0.5));
    float h = length(p) - Re;
    float dr = exp(-h / Hr) * dt, dm = exp(-h / Hm) * dt, dO = ozone(h) * dt;
    odR += dr; odM += dm; odO += dO;
    vec2 tlg = raySphere(p, uSunDir, Re);
    if (tlg.x > 0.0) continue;
    float tl1 = raySphere(p, uSunDir, Ra).y;
    const int NL = 10;
    float dl = tl1 / float(NL);
    float lR = 0.0, lM = 0.0, lO = 0.0;
    for (int j = 0; j < NL; j++) {
      vec3 q = p + uSunDir * (dl * (float(j) + 0.5));
      float hq = length(q) - Re;
      lR += exp(-hq / Hr) * dl; lM += exp(-hq / Hm) * dl; lO += ozone(hq) * dl;
    }
    vec3 tau = bR * (odR + lR) + bM * 1.11 * (odM + lM) + bO * (odO + lO);
    vec3 att = exp(-tau);
    sumR += att * dr; sumM += att * dm;
  }
  float mu = dot(rd, uSunDir);
  float pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = 0.78;
  float pM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 col = uSunI * (sumR * bR * pR + sumM * bM * pM);
  if (hitG && uGround > 0.5) {
    vec3 tauV = bR * odR + bM * 1.11 * odM + bO * odO;
    col += uGroundCol * exp(-tauV);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const DOME_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const DOME_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tSkyLUT;
uniform vec3 uSunDir;
uniform vec3 uSunDisk;
uniform vec3 uSunCol;
uniform vec3 uCloudAmb;
uniform float uTime;
uniform float uExposureHint;
varying vec3 vDir;
${NOISE_GLSL}
vec2 skyUV(vec3 d) {
  float phi = atan(d.x, -d.z);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float v = sign(el) * sqrt(abs(el) / 1.5707963);
  return vec2(phi / 6.2831853 + 0.5, v * 0.5 + 0.5);
}
float hg(float mu, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * mu, 1.5)); }
void main() {
  vec3 d = normalize(vDir);
  vec3 dl = d;
  dl.y = max(dl.y, 0.004);
  vec3 col = texture2D(tSkyLUT, skyUV(normalize(dl))).rgb;
  float mu = dot(d, uSunDir);
  float sunR = 0.00475;
  float cosR = cos(sunR);
  if (mu > cosR) {
    float r = acos(clamp(mu, -1.0, 1.0)) / sunR;
    float limb = 1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - r * r)));
    col += uSunDisk * limb;
  }
  col += uSunCol * 0.15 * smoothstep(cosR - 0.004, cosR, mu);
  if (d.y > 0.0) {
    float t = 6.5 / max(d.y, 0.02);
    vec2 uv = d.xz * t;
    vec2 wind = vec2(0.012, 0.004) * uTime;
    float cum = gFbm(uv * 0.11 + wind, 6);
    float cov = smoothstep(0.52, 0.78, cum);
    float cir = gFbm(vec2(uv.x * 0.05, uv.y * 0.22) + wind * 0.5 + 3.0, 5);
    float cirr = smoothstep(0.55, 0.85, cir) * 0.45;
    float dens = clamp(cov + cirr, 0.0, 1.0);
    float horizonFade = smoothstep(0.015, 0.16, d.y);
    dens *= horizonFade;
    float thick = gFbm(uv * 0.23 + wind * 1.3 + 5.0, 4);
    float ph = hg(mu, 0.5) * 2.1 + 0.32;
    vec3 lit = uSunCol * ph * (0.55 + 0.6 * (1.0 - thick)) + uCloudAmb * (0.6 + 0.4 * thick);
    vec3 cloud = mix(lit, col, 0.25 + 0.6 * (1.0 - horizonFade));
    col = mix(col, cloud, dens * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function hgPhase(mu, g) { const g2 = g * g; return (1 - g2) / (4 * Math.PI * Math.pow(1 + g2 - 2 * g * mu, 1.5)); }

export class Atmosphere {
  constructor({ renderer, scene, camera, sunDir, viewHeight = 1.6 }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sunDir = new THREE.Vector3(...sunDir).normalize();
    this.viewHeightKm = viewHeight;
    this.mie = 0.026;
    this.sunI = 22;
    this.time = 0;
    this.uniforms = {
      tSkyLUT: { value: null },
      uSunDir: { value: this.sunDir.clone() },
      uSunCol: { value: new THREE.Color() },
      uDustCol: { value: new THREE.Color() },
      uFog: { value: new THREE.Vector4(0.00013, 1 / 800, 0, 0.000016) },
      tTerrShadow: { value: null },
      uTerr: { value: new THREE.Vector4(1, 1, 0, 0) },
      uTime: { value: 0 },
    };
    this.computeSun();
    this.buildLUT();
    this.buildDome();
    this.buildLights();
    this.buildEnv();
    scene.fog = new THREE.Fog(0x9a8f86, 1, 30000);
  }

  sunTransmittance(dir) {
    const ro = [0, RE + this.viewHeightKm, 0];
    const ray = (o, d, r) => {
      const L = Math.hypot(...o);
      const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
      const c = (L - r) * (L + r);
      const disc = b * b - c;
      if (disc < 0) return [1e9, -1e9];
      const s = Math.sqrt(disc);
      return [-b - s, -b + s];
    };
    const tl = ray(ro, dir, RA)[1];
    const n = 200, dl = tl / n;
    let r = 0, m = 0, o = 0;
    for (let j = 0; j < n; j++) {
      const t = dl * (j + 0.5);
      const q = [ro[0] + dir[0] * t, ro[1] + dir[1] * t, ro[2] + dir[2] * t];
      const h = Math.hypot(...q) - RE;
      r += Math.exp(-h / HR) * dl; m += Math.exp(-h / HM) * dl; o += Math.max(0, 1 - Math.abs(h - 25) / 15) * dl;
    }
    return [0, 1, 2].map(i => Math.exp(-(BR[i] * r + this.mie * 1.11 * m + BO[i] * o)));
  }

  computeSun() {
    const T = this.sunTransmittance(this.sunDir.toArray());
    this.sunTrans = new THREE.Vector3(...T);
    const peak = Math.max(...T);
    this.sunColor = new THREE.Color(T[0] / peak, T[1] / peak, T[2] / peak);
    this.sunLux = peak;
    const k = this.sunI * 0.22;
    this.uniforms.uSunCol.value.setRGB(T[0] * k, T[1] * k, T[2] * k);
    this.uniforms.uSunDir.value.copy(this.sunDir);
  }

  buildLUT() {
    const make = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false, wrapS: THREE.RepeatWrapping });
    this.lutRT = make(1024, 512);
    this.envRT = make(1024, 512);
    this.envRT.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.lutMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: LUT_FRAG,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uSunI: { value: this.sunI },
        uMie: { value: this.mie },
        uViewH: { value: this.viewHeightKm },
        uGround: { value: 0 },
        uGroundCol: { value: new THREE.Vector3() },
      },
      depthTest: false, depthWrite: false,
    });
    this.lutQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMat);
    this.lutQuad.frustumCulled = false;
    this.lutScene = new THREE.Scene();
    this.lutScene.add(this.lutQuad);
    this.lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.renderLUT();
    this.uniforms.tSkyLUT.value = this.lutRT.texture;
  }

  renderLUT() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const sunH = Math.max(0, this.sunDir.y);
    const albedo = [0.34, 0.27, 0.2];
    const T = this.sunTrans;
    const irr = this.sunI;
    const sky = [1.1, 1.35, 1.9];
    this.lutMat.uniforms.uGroundCol.value.set(
      albedo[0] / Math.PI * (T.x * irr * sunH + sky[0]),
      albedo[1] / Math.PI * (T.y * irr * sunH + sky[1]),
      albedo[2] / Math.PI * (T.z * irr * sunH + sky[2]));
    this.lutMat.uniforms.uGround.value = 0;
    r.setRenderTarget(this.lutRT); r.render(this.lutScene, this.lutCam);
    this.lutMat.uniforms.uGround.value = 1;
    r.setRenderTarget(this.envRT); r.render(this.lutScene, this.lutCam);
    r.setRenderTarget(prev);
  }

  buildDome() {
    const T = this.sunTrans;
    const disk = 20000;
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      uniforms: {
        tSkyLUT: this.uniforms.tSkyLUT,
        uSunDir: this.uniforms.uSunDir,
        uSunDisk: { value: new THREE.Vector3(T.x * disk, T.y * disk, T.z * disk) },
        uSunCol: this.uniforms.uSunCol,
        uCloudAmb: { value: new THREE.Vector3(0.35, 0.42, 0.55) },
        uTime: this.uniforms.uTime,
        uExposureHint: { value: 1 },
      },
      side: THREE.BackSide, depthWrite: false, depthTest: true,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.scene.add(this.dome);
  }

  buildLights() {
    const T = this.sunTrans;
    this.csm = new CSM({
      camera: this.camera,
      parent: this.scene,
      cascades: 3,
      maxFar: 650,
      mode: 'practical',
      shadowMapSize: 4096,
      shadowBias: -0.00018,
      lightDirection: this.sunDir.clone().negate(),
      lightIntensity: 1,
      lightNear: 1,
      lightFar: 2200,
      lightMargin: 450,
    });
    this.csm.fade = true;
    for (const l of this.csm.lights) {
      l.color.setRGB(T.x, T.y, T.z).multiplyScalar(this.sunI);
      l.shadow.normalBias = 0.07;
      l.shadow.radius = 1;
      l.shadow.autoUpdate = false;
      l.userData.camPos = null;
      l.userData.camDir = new THREE.Vector3();
    }
    this.shadowFrame = 0;
    this.sunLightColor = this.csm.lights[0].color.clone();
    const terrShadowLine = 'getDirectionalLightInfo( directionalLight, directLight );';
    const patched = THREE.ShaderChunk.lights_fragment_begin.split(terrShadowLine).join(terrShadowLine + '\n#ifdef GUL_TSHADOW\ndirectLight.color *= gulSunVis;\n#endif');
    THREE.ShaderChunk.lights_fragment_begin = '#ifdef GUL_TSHADOW\nfloat gulSunVis = gulTerrainShadow( vFogWorldPos );\n#endif\n' + patched;
    THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth;\n varying vec3 vFogWorldPos;\n#endif';
    THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n vFogWorldPos = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );\n#endif';
    THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
 uniform vec3 fogColor;
 varying float vFogDepth;
 varying vec3 vFogWorldPos;
 #ifdef GUL_ATMO
  uniform sampler2D tSkyLUT;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uDustCol;
  uniform vec4 uFog;
  uniform sampler2D tTerrShadow;
  uniform vec4 uTerr;
  vec2 gulSkyUV(vec3 d) {
    float phi = atan(d.x, -d.z);
    float el = asin(clamp(d.y, -1.0, 1.0));
    float v = sign(el) * sqrt(abs(el) / 1.5707963);
    return vec2(phi / 6.2831853 + 0.5, v * 0.5 + 0.5);
  }
  float gulTerrainShadow(vec3 wp) {
    vec2 u = (wp.xz + uTerr.z) / uTerr.y;
    float n = uTerr.x;
    if (u.x < 1.0 || u.y < 1.0 || u.x > n - 2.0 || u.y > n - 2.0) return 1.0;
    ivec2 i = ivec2(floor(u));
    vec2 f = fract(u);
    float a = texelFetch(tTerrShadow, i, 0).r;
    float b = texelFetch(tTerrShadow, i + ivec2(1, 0), 0).r;
    float c = texelFetch(tTerrShadow, i + ivec2(0, 1), 0).r;
    float d = texelFetch(tTerrShadow, i + ivec2(1, 1), 0).r;
    float s = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    float soft = 2.0 + uTerr.w * max(0.0, s - wp.y);
    return smoothstep(-1.0 - soft, -1.0, wp.y - s);
  }
  float gulHG(float mu, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * mu, 1.5)); }
  vec3 gulAtmosphere(vec3 col, vec3 wp) {
    vec3 rd = wp - cameraPosition;
    float dist = length(rd);
    rd /= max(dist, 1e-3);
    float b = uFog.y;
    float h0 = cameraPosition.y - uFog.z;
    float dy = rd.y * dist * b;
    float fall = abs(dy) > 1e-4 ? (1.0 - exp(-dy)) / dy : 1.0;
    float od = uFog.x * exp(-b * h0) * dist * fall + uFog.w * dist;
    vec3 T = exp(-od * vec3(0.92, 1.0, 1.12));
    vec3 dirc = normalize(vec3(rd.x, max(rd.y, 0.015), rd.z));
    vec3 sky = texture2D(tSkyLUT, gulSkyUV(dirc)).rgb;
    float mu = dot(rd, uSunDir);
    vec3 dust = uDustCol + uSunCol * gulHG(mu, 0.72) * 1.4;
    vec3 ins = mix(sky, dust, 0.55);
    return col * T + ins * (1.0 - T);
  }
 #else
  #ifdef FOG_EXP2
   uniform float fogDensity;
  #else
   uniform float fogNear;
   uniform float fogFar;
  #endif
 #endif
#endif`;
    THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
 #ifdef GUL_ATMO
  gl_FragColor.rgb = gulAtmosphere( gl_FragColor.rgb, vFogWorldPos );
 #else
  #ifdef FOG_EXP2
   float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
   float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
 #endif
#endif`;
    const dust = this.sunTrans;
    this.uniforms.uDustCol.value.setRGB(0.32 + dust.x * 0.5, 0.3 + dust.y * 0.45, 0.32 + dust.z * 0.4);
  }

  buildEnv() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromEquirectangular(this.envRT.texture).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.78;
  }

  patch(material, { terrainShadow = true, csm = true, extra = null, key = '' } = {}) {
    if (material.userData.gulPatched) return material;
    material.userData.gulPatched = true;
    material.fog = true;
    material.defines = material.defines || {};
    material.defines.GUL_ATMO = '';
    if (terrainShadow) material.defines.GUL_TSHADOW = '';
    if (csm && material.isMeshStandardMaterial) this.csm.setupMaterial(material);
    const csmHook = material.onBeforeCompile;
    const uniforms = this.uniforms;
    material.onBeforeCompile = function (shader, renderer) {
      if (csmHook && csmHook !== THREE.Material.prototype.onBeforeCompile) csmHook.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      if (extra) extra(shader, renderer);
    };
    const baseKey = material.customProgramCacheKey ? material.customProgramCacheKey.call(material) : '';
    material.customProgramCacheKey = () => 'gul|' + (terrainShadow ? 'ts|' : '') + (csm ? 'csm|' : '') + key + '|' + baseKey;
    material.needsUpdate = true;
    return material;
  }

  setTerrainShadow(texture, N, cell, half) {
    this.uniforms.tTerrShadow.value = texture;
    this.uniforms.uTerr.value.set(N, cell, half, 0.004);
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.dome.position.copy(this.camera.position);
    this.dome.scale.setScalar(this.camera.far * 0.9);
    this.csm.update();
  }

  planShadows(force = false) {
    const f = ++this.shadowFrame, cam = this.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const breaks = this.csm.breaks, far = this.csm.maxFar;
    this.csm.lights.forEach((l, i) => {
      const u = l.userData, every = 1 << i;
      let need = force || !u.camPos || (f + i) % every === 0;
      if (!need) {
        const reach = (breaks[i] || 1) * far;
        need = u.camPos.distanceTo(cam.position) > reach * 0.02 || u.camDir.angleTo(dir) > 0.035;
      }
      if (!need) return;
      l.shadow.needsUpdate = true;
      u.camPos = (u.camPos || new THREE.Vector3()).copy(cam.position);
      u.camDir.copy(dir);
    });
  }
}
