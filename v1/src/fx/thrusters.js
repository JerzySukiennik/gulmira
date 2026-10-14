// Palm and boot thrusters: layered plume shaders, ground-lighting, rotor-wash dust.
import * as THREE from 'three';

const FLAME_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
uniform float uLen;
uniform float uWidth;
void main() {
  vUv = uv;
  vec3 p = position;
  float t = 1.0 - uv.y;
  p.y *= uLen;
  p.xz *= uWidth * (1.0 + 0.15 * sin(t * 18.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const FLAME_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
uniform float uTime;
uniform float uPower;
uniform vec3 uCore;
uniform vec3 uTail;
uniform float uSeed;
float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  #include <logdepthbuf_fragment>
  float t = 1.0 - vUv.y;
  float rim = abs(dot(normalize(vN), normalize(vV)));
  float body = pow(rim, 1.6);
  float flick = n2(vec2(vUv.x * 7.0 + uSeed, t * 6.0 - uTime * 38.0)) * 0.6 + n2(vec2(vUv.x * 13.0, t * 13.0 - uTime * 61.0)) * 0.4;
  float shock = 0.6 + 0.4 * sin(t * 40.0 - uTime * 30.0);
  float fall = pow(1.0 - t, 1.4);
  float a = body * fall * (0.55 + 0.6 * flick) * uPower * mix(1.0, shock, 0.25);
  vec3 col = mix(uTail, uCore, pow(1.0 - t, 3.0) * rim);
  gl_FragColor = vec4(col * a, a);
}`;

export class Thrusters {
  constructor(suit, animator, particles, terrain, scene) {
    this.anim = animator;
    this.particles = particles;
    this.terrain = terrain;
    this.time = 0;
    this.nozzles = [];
    const geo = new THREE.CylinderGeometry(0.5, 0.06, 1, 24, 12, true);
    geo.translate(0, -0.5, 0);
    const make = (bone, pos, dirAxis, scale, core, tail) => {
      const g = new THREE.Group();
      g.position.copy(pos);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dirAxis);
      bone.add(g);
      const layers = [];
      for (const [lw, ll, pw, c, tl] of [[1.25, 1, 1.15, core, tail], [2.3, 2.2, 0.45, core.clone().multiplyScalar(0.6), tail.clone().multiplyScalar(0.8)]]) {
        const mat = new THREE.ShaderMaterial({
          vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
          uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uCore: { value: c }, uTail: { value: tl }, uLen: { value: 0.3 }, uWidth: { value: 0.05 }, uSeed: { value: Math.random() * 10 } },
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
        const m = new THREE.Mesh(geo, mat);
        m.frustumCulled = false;
        m.layers.set(1);
        m.renderOrder = 30;
        g.add(m);
        layers.push({ m, lw, ll, pw });
      }
      const n = { g, layers, scale, power: 0, target: 0 };
      this.nozzles.push(n);
      return n;
    };
    const B = animator.B;
    const core = new THREE.Color(5.5, 6.5, 8.0), tail = new THREE.Color(0.6, 0.75, 1.3);
    const coreB = new THREE.Color(7.0, 6.6, 6.2), tailB = new THREE.Color(1.4, 0.9, 0.7);
    this.palmR = make(B.wrist_R, new THREE.Vector3(-0.032, -0.058, 0), new THREE.Vector3(-1, 0, 0), 0.6, core, tail);
    this.palmL = make(B.wrist_L, new THREE.Vector3(0.032, -0.058, 0), new THREE.Vector3(1, 0, 0), 0.6, core, tail);
    this.bootR = make(B.ankle_R, new THREE.Vector3(0, -0.078, -0.06), new THREE.Vector3(0, -1, 0), 1, coreB, tailB);
    this.bootL = make(B.ankle_L, new THREE.Vector3(0, -0.078, -0.06), new THREE.Vector3(0, -1, 0), 1, coreB, tailB);
    this.light = new THREE.PointLight(new THREE.Color(1.0, 0.9, 0.82), 0, 18, 2);
    this.light.layers.enableAll();
    scene.add(this.light);
    this.palmLight = new THREE.PointLight(new THREE.Color(0.8, 0.9, 1.0), 0, 10, 2);
    this.palmLight.layers.enableAll();
    scene.add(this.palmLight);
    this.dustAcc = 0;
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this.repulsorGlow = { R: 0, L: 0 };
  }

  update(dt, player) {
    this.time += dt;
    const m = player.mode, th = player.thrust;
    let boot = 0, palm = 0;
    if (m === 'hover') { boot = 0.55 + 0.45 * th; palm = 0.4 + 0.35 * th; }
    else if (m === 'flight') { boot = 0.45 + 0.75 * th + (player.boosting ? 0.35 : 0); palm = 0.35 + 0.5 * th; }
    else if (m === 'landing') { boot = Math.max(0, 0.9 - player.landT * 3); palm = boot * 0.6; }
    else if (m === 'knockdown') { boot = Math.random() < 0.3 ? 0.6 : 0.05; palm = boot * 0.5; }
    else if (m === 'ground') { boot = player.takeoffKick || 0; palm = 0; }
    this.palmR.target = player.aimR ? 0 : palm;
    this.palmL.target = player.aimL ? 0 : palm;
    this.bootR.target = boot; this.bootL.target = boot;
    const speed = player.vel.length();
    for (const n of this.nozzles) {
      n.power += (n.target - n.power) * (1 - Math.exp(-dt * 14));
      const p = n.power * (0.92 + 0.08 * Math.sin(this.time * 47 + n.scale * 10));
      for (const L of n.layers) {
        const u = L.m.material.uniforms;
        u.uTime.value = this.time;
        u.uPower.value = p * L.pw;
        u.uLen.value = n.scale * (0.18 + 0.75 * p) * L.ll * (1 + Math.min(1.5, speed / 200));
        u.uWidth.value = n.scale * 0.055 * L.lw * (0.7 + 0.3 * p);
        L.m.visible = p > 0.02;
      }
    }
    const P = this.particles;
    for (const n of this.nozzles) {
      if (n.power < 0.05) continue;
      n.g.getWorldPosition(this._a);
      const pw = n.power * (0.85 + Math.random() * 0.3);
      const boot = n.scale > 0.8;
      P.emit({ kind: 2, pos: this._a.clone(), size: (boot ? 0.42 : 0.3) * (0.6 + pw), life: 0.035, color: boot ? [7, 6.5, 6] : [5, 6.5, 9], alpha: Math.min(1, pw), drag: 0, fadeIn: 0 });
      if (boot && pw > 0.7) P.emit({ kind: 2, pos: this._a.clone(), size: 1.1 * pw, life: 0.03, color: [2.2, 1.6, 1.2], alpha: 0.6, drag: 0, fadeIn: 0 });
    }
    const a = this.anim;
    a.sole('R', this._a); a.sole('L', this._b);
    this.light.position.copy(this._a).add(this._b).multiplyScalar(0.5);
    this.light.position.y -= 0.3;
    this.light.intensity = (this.bootR.power + this.bootL.power) * 9;
    a.palm('R', this._a); a.palm('L', this._b);
    this.palmLight.position.copy(this._a).add(this._b).multiplyScalar(0.5);
    this.palmLight.intensity = (this.palmR.power + this.palmL.power) * 3 + (this.repulsorGlow.R + this.repulsorGlow.L) * 30;
    this.repulsorGlow.R *= Math.exp(-dt * 14); this.repulsorGlow.L *= Math.exp(-dt * 14);

    // rotor-wash dust
    const agl = player.agl;
    const power = (this.bootR.power + this.bootL.power) * 0.5;
    if (agl < 16 && power > 0.15 && m !== 'ground') {
      const strength = power * (1 - agl / 16);
      this.dustAcc += dt * strength * 160;
      const gx = player.pos.x, gz = player.pos.z;
      const gy = player.groundY;
      while (this.dustAcc > 1) {
        this.dustAcc -= 1;
        const ang = Math.random() * Math.PI * 2;
        const r0 = 0.5 + Math.random() * (1 + agl * 0.25);
        const sp = 6 + Math.random() * 10 * strength + 6;
        this.particles.emit({
          kind: 0, pos: new THREE.Vector3(gx + Math.cos(ang) * r0, gy + 0.2, gz + Math.sin(ang) * r0),
          vel: new THREE.Vector3(Math.cos(ang) * sp, 0.6 + Math.random() * 1.6, Math.sin(ang) * sp),
          size: 0.8 + Math.random() * 0.8, grow: 1.6, life: 1.6 + Math.random() * 1.6, drag: 1.4, color: [0.62, 0.53, 0.42], alpha: 0.32 * strength + 0.06,
          buoy: 0.4, lit: 1.0, curve: 1.4, fadeIn: 0.12,
        });
      }
    }
  }

  repulsorFlash(side) { this.repulsorGlow[side] = 1; }
}
