// Render pipeline: HDR scene (MSAA + depth texture) -> physically based bloom -> filmic composite.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const QUAD_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const DOWN_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 karis(vec3 c) { return c / (1.0 + lum(c) * 0.25); }
void main() {
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
  vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 r;
  if (uFirst > 0.5) {
    vec3 g0 = karis((a + b + d + e) * 0.25), g1 = karis((b + c + e + f) * 0.25);
    vec3 g2 = karis((d + e + g + h) * 0.25), g3 = karis((e + f + h + i) * 0.25);
    vec3 g4 = karis((j + k + l + m) * 0.25);
    r = g4 * 0.5 + (g0 + g1 + g2 + g3) * 0.125;
  } else {
    r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(max(r, vec3(0.0)), 1.0);
}`;

const UP_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 r = uTexel * uRadius;
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += (texture2D(tSrc, vUv + vec2(-r.x, 0)).rgb + texture2D(tSrc, vUv + vec2(r.x, 0)).rgb + texture2D(tSrc, vUv + vec2(0, -r.y)).rgb + texture2D(tSrc, vUv + vec2(0, r.y)).rgb) * 2.0;
  c += texture2D(tSrc, vUv + vec2(-r.x, -r.y)).rgb + texture2D(tSrc, vUv + vec2(r.x, -r.y)).rgb + texture2D(tSrc, vUv + vec2(-r.x, r.y)).rgb + texture2D(tSrc, vUv + vec2(r.x, r.y)).rgb;
  gl_FragColor = vec4(c / 16.0, 1.0);
}`;

const AE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform sampler2D tPrev;
uniform float uDt;
uniform float uReset;
varying vec2 vUv;
void main() {
  float acc = 0.0, wsum = 0.0;
  for (int j = 0; j < 8; j++) for (int i = 0; i < 12; i++) {
    vec2 uv = (vec2(float(i), float(j)) + 0.5) / vec2(12.0, 8.0);
    float l = dot(texture2D(tSrc, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
    vec2 d = uv - vec2(0.5, 0.45);
    float w = exp(-dot(d, d) * 4.0) * mix(1.0, 0.35, smoothstep(0.65, 0.95, uv.y));
    acc += w * log2(clamp(l, 1e-4, 64.0));
    wsum += w;
  }
  float cur = acc / wsum;
  float prev = texture2D(tPrev, vec2(0.5)).r;
  float k = uReset > 0.5 ? 1.0 : 1.0 - exp(-uDt * (cur > prev ? 2.6 : 1.3));
  gl_FragColor = vec4(mix(prev, cur, k), 0.0, 0.0, 1.0);
}`;

const FINAL_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tDepth;
uniform sampler2D tDirt;
uniform vec2 uRes;
uniform float uExposure;
uniform float uBloom;
uniform float uTime;
uniform float uVignette;
uniform float uGrain;
uniform float uCA;
uniform float uSat;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uFlash;
uniform vec3 uFlashCol;
uniform float uDamage;
uniform float uBlurAmt;
uniform vec2 uBlurDir;
uniform float uLogFar;
uniform mat4 uPrevVP;
uniform mat4 uInvVP;
uniform float uMotion;
uniform vec2 uProjZ;
uniform vec2 uSunUV;
uniform float uSunAmt;
uniform vec3 uSunTint;
uniform sampler2D tAE;
uniform vec4 uAE;
varying vec2 vUv;
vec3 aces(vec3 x) {
  const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  x = ACESIn * x;
  vec3 a = x * (x + 0.0245786) - 0.000090537;
  vec3 b = x * (0.983729 * x + 0.4329510) + 0.238081;
  return clamp(ACESOut * (a / b), 0.0, 1.0);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 sceneAt(vec2 uv) {
  vec2 d = uv - 0.5;
  float ca = uCA * dot(d, d);
  vec3 c;
  c.r = texture2D(tScene, uv - d * ca).r;
  c.g = texture2D(tScene, uv).g;
  c.b = texture2D(tScene, uv + d * ca).b;
  return c;
}
void main() {
  vec2 uv = vUv;
  vec4 base = texture2D(tScene, uv);
  vec3 col = sceneAt(uv);
  if (uMotion > 0.0 && base.a > 0.5) {
    float dz = texture2D(tDepth, uv).r;
    float w = exp2(dz * uLogFar) - 1.0;
    vec2 ndc = uv * 2.0 - 1.0;
    vec4 wp = uInvVP * vec4(ndc * w, uProjZ.x * w + uProjZ.y, w);
    wp /= wp.w;
    vec4 prev = uPrevVP * vec4(wp.xyz, 1.0);
    vec2 puv = prev.xy / prev.w * 0.5 + 0.5;
    vec2 vel = (uv - puv) * uMotion;
    float vl = length(vel);
    vel *= min(1.0, 0.04 / max(vl, 1e-5));
    if (length(vel * uRes) > 0.8) {
      vec3 acc = col;
      float wsum = 1.0;
      float j = hash(uv * uRes + uTime);
      for (int i = 1; i < 10; i++) {
        float t = (float(i) + j) / 10.0 - 0.5;
        vec4 smp = texture2D(tScene, uv + vel * t);
        float wgt = step(0.5, smp.a);
        acc += smp.rgb * wgt;
        wsum += wgt;
      }
      col = acc / wsum;
    }
  }
  if (uBlurAmt > 0.0) {
    vec3 acc = col;
    for (int i = 1; i < 8; i++) {
      float t = float(i) / 8.0;
      acc += texture2D(tScene, uv + uBlurDir * t * uBlurAmt).rgb;
    }
    col = acc / 8.0;
  }
  if (uSunAmt > 0.001) {
    vec2 dv = (uSunUV - uv);
    float j = hash(uv * uRes + uTime * 7.0);
    vec3 shafts = vec3(0.0);
    float decay = 1.0;
    for (int i = 0; i < 28; i++) {
      float t = (float(i) + j) / 28.0;
      vec2 su = uv + dv * t * 0.92;
      float dz = texture2D(tDepth, su).r;
      float sky = step(0.99995, dz);
      vec3 c = texture2D(tScene, su).rgb;
      shafts += max(c - 1.2, vec3(0.0)) * sky * decay;
      decay *= 0.955;
    }
    float aspectFix = length(dv * vec2(uRes.x / uRes.y, 1.0));
    col += shafts / 28.0 * uSunAmt * uSunTint * (1.0 - smoothstep(0.0, 1.4, aspectFix));
  }
  vec3 bloom = texture2D(tBloom, uv).rgb;
  vec3 dirt = texture2D(tDirt, uv).rgb;
  col = mix(col, bloom, uBloom) + bloom * dirt * uBloom * 2.5;
  col += uFlashCol * uFlash;
  col *= uExposure * exp2(clamp((uAE.x - texture2D(tAE, vec2(0.5)).r) * uAE.y, uAE.z, uAE.w));
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  col = col * uGain + uLift * (1.0 - col);
  vec2 v = uv - 0.5;
  float vig = 1.0 - uVignette * dot(v * vec2(1.25, 1.0), v * vec2(1.25, 1.0)) * 2.2;
  col *= clamp(vig, 0.0, 1.0);
  if (uDamage > 0.0) {
    float edge = smoothstep(0.25, 0.75, length(v * vec2(1.6, 1.0)));
    col = mix(col, col * vec3(1.0, 0.55, 0.45), edge * uDamage);
  }
  col = srgb(clamp(col, 0.0, 1.0));
  float gr = hash(uv * uRes + fract(uTime * 13.37)) - 0.5;
  col += gr * uGrain * (1.0 - l * 0.6);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Renderer {
  constructor(canvas) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true, stencil: false });
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.autoClear = true;
    this.renderer = r;
    this.scale = 0.7;
    this.samples = 4;
    this.params = {
      exposure: 0.55, bloom: 0.045, vignette: 0.32, grain: 0.035, ca: 0.012, sat: 1.0,
      lift: new THREE.Vector3(0.012, 0.014, 0.022), gain: new THREE.Vector3(1.02, 1.0, 0.97),
      motion: 0.55, shafts: 0.9,
      aeKey: -2.2, aeStrength: 0.75, aeMin: -1.0, aeMax: 1.8,
    };
    this.aeReset = true;
    this.flash = 0;
    this.flashCol = new THREE.Vector3(1, 0.85, 0.6);
    this.damage = 0;
    this.blurAmt = 0;
    this.blurDir = new THREE.Vector2();
    this.prevVP = new THREE.Matrix4();
    this.invVP = new THREE.Matrix4();
    this.downMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: DOWN_FRAG, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } }, depthTest: false, depthWrite: false });
    this.upMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: UP_FRAG, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } }, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: FINAL_FRAG,
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, tDepth: { value: null }, tDirt: { value: this.makeDirt() },
        uRes: { value: new THREE.Vector2() }, uExposure: { value: 1 }, uBloom: { value: 0.04 }, uTime: { value: 0 },
        uVignette: { value: 0.3 }, uGrain: { value: 0.03 }, uCA: { value: 0.01 }, uSat: { value: 1 },
        uLift: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3(1, 1, 1) },
        uFlash: { value: 0 }, uFlashCol: { value: new THREE.Vector3(1, 1, 1) }, uDamage: { value: 0 },
        uBlurAmt: { value: 0 }, uBlurDir: { value: new THREE.Vector2() },
        uLogFar: { value: 1 }, uPrevVP: { value: new THREE.Matrix4() }, uInvVP: { value: new THREE.Matrix4() }, uMotion: { value: 0 }, uProjZ: { value: new THREE.Vector2() },
        uSunUV: { value: new THREE.Vector2() }, uSunAmt: { value: 0 }, uSunTint: { value: new THREE.Color(1.0, 0.72, 0.45) },
        tAE: { value: null }, uAE: { value: new THREE.Vector4() },
      },
      depthTest: false, depthWrite: false,
    });
    this.aeMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: AE_FRAG, uniforms: { tSrc: { value: null }, tPrev: { value: null }, uDt: { value: 0 }, uReset: { value: 1 } }, depthTest: false, depthWrite: false });
    this.aeRT = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false }));
    this.quad = new FullScreenQuad(null);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  makeDirt() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 260; i++) {
      const x = rnd() * 512, y = rnd() * 512, r = 2 + rnd() * rnd() * 26;
      const a = 0.04 + rnd() * 0.16;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,245,230,${a})`);
      gr.addColorStop(0.7, `rgba(255,245,230,${a * 0.5})`);
      gr.addColorStop(1, 'rgba(255,245,230,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 12; i++) {
      g.strokeStyle = `rgba(255,240,220,${0.03 + rnd() * 0.05})`;
      g.lineWidth = 1 + rnd() * 3;
      g.beginPath(); g.moveTo(rnd() * 512, rnd() * 512); g.bezierCurveTo(rnd() * 512, rnd() * 512, rnd() * 512, rnd() * 512, rnd() * 512, rnd() * 512); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  }

  resize() {
    const r = this.renderer;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(window.innerWidth * dpr * this.scale));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr * this.scale));
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    r.domElement.style.width = window.innerWidth + 'px';
    r.domElement.style.height = window.innerHeight + 'px';
    this.width = w; this.height = h;
    if (this.sceneRT) this.sceneRT.dispose();
    const depth = new THREE.DepthTexture(w, h);
    depth.type = THREE.FloatType;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.samples, depthTexture: depth, depthBuffer: true });
    this.sceneRT.texture.minFilter = THREE.LinearFilter;
    if (this.mips) this.mips.forEach(m => m.dispose());
    this.mips = [];
    let mw = w, mh = h;
    for (let i = 0; i < 7; i++) {
      mw = Math.max(1, Math.floor(mw / 2)); mh = Math.max(1, Math.floor(mh / 2));
      this.mips.push(new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    }
    this.finalMat.uniforms.uRes.value.set(w, h);
    if (this.onResize) this.onResize(w, h);
  }

  setScale(s) { this.scale = s; this.resize(); }

  bloomPass() {
    const r = this.renderer;
    let src = this.sceneRT.texture;
    let sw = this.width, sh = this.height;
    this.quad.material = this.downMat;
    for (let i = 0; i < this.mips.length; i++) {
      this.downMat.uniforms.tSrc.value = src;
      this.downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      this.downMat.uniforms.uFirst.value = i === 0 ? 1 : 0;
      r.setRenderTarget(this.mips[i]);
      this.quad.render(r);
      src = this.mips[i].texture;
      sw = this.mips[i].width; sh = this.mips[i].height;
    }
    this.quad.material = this.upMat;
    for (let i = this.mips.length - 1; i > 0; i--) {
      const s = this.mips[i], d = this.mips[i - 1];
      this.upMat.uniforms.tSrc.value = s.texture;
      this.upMat.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
      this.upMat.uniforms.uRadius.value = 1.0;
      r.setRenderTarget(d);
      r.autoClear = false;
      this.quad.render(r);
      r.autoClear = true;
    }
    return this.mips[0].texture;
  }

  aePass(dt) {
    const r = this.renderer, [prev, next] = this.aeRT, u = this.aeMat.uniforms;
    u.tSrc.value = this.mips[this.mips.length - 1].texture;
    u.tPrev.value = prev.texture;
    u.uDt.value = Math.min(dt, 0.1);
    u.uReset.value = this.aeReset ? 1 : 0;
    this.aeReset = false;
    this.quad.material = this.aeMat;
    r.setRenderTarget(next);
    this.quad.render(r);
    this.aeRT = [next, prev];
    return next.texture;
  }

  aeValue() {
    const px = new Float32Array(4);
    this.renderer.readRenderTargetPixels(this.aeRT[0], 0, 0, 1, 1, px);
    return px[0];
  }

  render(scene, camera, dt, time, beforeFx = null) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.shadowMap.needsUpdate = !this.skipShadows;
    if (!this.skipShadows && this.planShadows) this.planShadows();
    camera.layers.set(0);
    r.render(scene, camera);
    if (beforeFx) beforeFx(this.sceneRT.depthTexture);
    r.autoClear = false;
    camera.layers.set(1);
    r.render(scene, camera);
    r.autoClear = true;
    camera.layers.enableAll();
    const bloom = this.bloomPass();
    const u = this.finalMat.uniforms, p = this.params;
    u.tAE.value = this.aePass(dt);
    u.uAE.value.set(p.aeKey, p.aeStrength, p.aeMin, p.aeMax);
    u.tScene.value = this.sceneRT.texture;
    u.tDepth.value = this.sceneRT.depthTexture;
    u.tBloom.value = bloom;
    u.uExposure.value = p.exposure;
    u.uBloom.value = p.bloom;
    u.uVignette.value = p.vignette;
    u.uGrain.value = p.grain;
    u.uCA.value = p.ca;
    u.uSat.value = p.sat;
    u.uLift.value.copy(p.lift);
    u.uGain.value.copy(p.gain);
    u.uTime.value = time;
    u.uFlash.value = this.flash;
    u.uFlashCol.value.copy(this.flashCol);
    u.uDamage.value = this.damage;
    u.uBlurAmt.value = this.blurAmt;
    u.uBlurDir.value.copy(this.blurDir);
    u.uLogFar.value = Math.log2(camera.far + 1);
    u.uProjZ.value.set(-camera.projectionMatrix.elements[10], camera.projectionMatrix.elements[14]);
    if (this.sunDir) {
      const sp = camera.position.clone().addScaledVector(this.sunDir, 10000).project(camera);
      const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).dot(this.sunDir);
      u.uSunUV.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      u.uSunAmt.value = facing > 0 ? this.params.shafts * Math.pow(facing, 2) : 0;
    }
    const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.invVP.copy(vp).invert();
    u.uInvVP.value.copy(this.invVP);
    u.uPrevVP.value.copy(this.prevVP);
    u.uMotion.value = dt > 0 ? p.motion * Math.min(1, (1 / 60) / Math.max(dt, 1e-4)) : 0;
    this.prevVP.copy(vp);
    this.quad.material = this.finalMat;
    r.setRenderTarget(null);
    this.quad.render(r);
  }
}
