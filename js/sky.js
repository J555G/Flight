// Sky dome: Michelangelo's Sistine Chapel ceiling overhead, the Last Judgement
// on the west side (as in the chapel), and galaxies with a glowing atmosphere
// around the horizon. The dome is aligned with the local east/north/up frame,
// so the ceiling always stays overhead wherever you fly.

import * as THREE from 'three';
import { SKY_CEILING_URL, SKY_WALL_URL } from './config.js?v=20261021205936';

// Room geometry in units of the ceiling height (ceiling plane at z = 1).
const CEIL_A = 1.35;                 // half length (east-west)
const CEIL_B = CEIL_A / (3129 / 1125); // half width, keeps the image's aspect
const WALL_Z0 = CEIL_A * Math.tan((12 * Math.PI) / 180); // Last Judgement bottom edge (~12° up)
const WALL_W = (1 - WALL_Z0) * (1920 / 2114);            // keeps the painting's aspect

const vert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far plane
  }
`;

const frag = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform sampler2D uCeil, uWall;
  uniform float uCeilReady, uWallReady;
  uniform mat3 uEnuT;      // world -> local (east, north, up)
  uniform float uDip;      // horizon dip below horizontal (rad)
  uniform float uAtmos;    // atmosphere strength (1 at sea level -> 0 in space)
  uniform vec3 uGlow;      // atmosphere colour near the horizon

  const float A = ${CEIL_A.toFixed(5)};
  const float B = ${CEIL_B.toFixed(5)};
  const float Z0 = ${WALL_Z0.toFixed(5)};
  const float WW = ${WALL_W.toFixed(5)};

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  vec3 galaxies(vec3 d) {
    // Milky Way: a bright, mottled band along a tilted great circle
    vec3 bandN = normalize(vec3(0.35, 0.55, 0.76));
    float lat = dot(d, bandN);
    float band = exp(-lat * lat * 18.0);
    float cloud = fbm(d * 6.0);
    float dust = smoothstep(0.45, 0.75, fbm(d * 11.0 + 3.1));
    vec3 col = vec3(0.012, 0.014, 0.03);
    col += band * (0.10 + 0.35 * cloud) * mix(vec3(0.55, 0.5, 0.75), vec3(1.0, 0.85, 0.7), cloud) * (1.0 - 0.6 * dust);
    // distant galaxies / nebulae
    float neb = smoothstep(0.62, 0.9, fbm(d * 3.0 + 7.7));
    col += neb * vec3(0.25, 0.12, 0.35) * 0.6;
    // stars
    vec3 g = d * 220.0;
    vec3 cell = floor(g);
    float h = hash(cell);
    if (h > 0.985) {
      vec3 c = cell + 0.5 + 0.35 * (vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 5.1)) - 0.5);
      float s = smoothstep(0.42, 0.0, length(g - c));
      col += s * mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), hash(cell + 9.0)) * (0.6 + 2.0 * (h - 0.985) / 0.015);
    }
    return col;
  }

  vec4 frescoes(vec3 d) {
    vec4 c = vec4(0.0);
    // ceiling: a flat rectangle at height 1 seen from below
    if (d.z > 0.0) {
      vec2 p = d.xy / d.z;
      vec2 uv = vec2((A - p.x) / (2.0 * A), (p.y + B) / (2.0 * B));
      if (all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) {
        float e = min(min(uv.x, 1.0 - uv.x) * 2.0 * A, min(uv.y, 1.0 - uv.y) * 2.0 * B);
        c = vec4(texture2D(uCeil, uv).rgb, smoothstep(0.0, 0.04, e) * uCeilReady);
      }
    }
    // Last Judgement: on the west wall (x = -A), below the ceiling's west end
    if (d.x < 0.0 && c.a < 1.0) {
      float t = -A / d.x;
      float wy = d.y * t, wz = d.z * t;
      vec2 uv = vec2((wy + WW * 0.5) / WW, (1.0 - wz) / (1.0 - Z0));
      if (all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) {
        float e = min(min(uv.x, 1.0 - uv.x) * WW, min(uv.y, 1.0 - uv.y) * (1.0 - Z0));
        vec3 w = texture2D(uWall, uv).rgb;
        float a = smoothstep(0.0, 0.03, e) * uWallReady;
        c = vec4(mix(w, c.rgb, c.a), max(a, c.a));
      }
    }
    return c;
  }

  void main() {
    vec3 d = normalize(uEnuT * normalize(vDir));
    vec3 col = galaxies(d);
    vec4 f = frescoes(d);
    col = mix(col, f.rgb, f.a);
    // atmosphere: glow hugging the real horizon, thinner high up
    float elev = asin(clamp(d.z, -1.0, 1.0)) + uDip;
    float above = exp(-max(elev, 0.0) / mix(0.025, 0.16, uAtmos));
    float below = exp(min(elev, 0.0) / 0.02);
    float glow = (elev > 0.0 ? above : below) * mix(0.55, 1.0, uAtmos);
    col = mix(col, uGlow, clamp(glow, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uCeil: { value: null }, uWall: { value: null },
      uCeilReady: { value: 0 }, uWallReady: { value: 0 },
      uEnuT: { value: new THREE.Matrix3() },
      uDip: { value: 0 }, uAtmos: { value: 1 },
      uGlow: { value: new THREE.Color('#b7d0ea') },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.scale.setScalar(1000); // camera sits at the origin
    scene.add(this.mesh);
    this._load(SKY_CEILING_URL, 'uCeil', 'uCeilReady');
    this._load(SKY_WALL_URL, 'uWall', 'uWallReady');
  }

  _load(url, key, readyKey) {
    new THREE.TextureLoader().setCrossOrigin('anonymous').load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.uniforms[key].value = tex;
      // fade in
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 1500);
        this.uniforms[readyKey].value = k;
        if (k < 1) requestAnimationFrame(step);
      };
      step();
    });
  }

  // e, n, u: local unit vectors at the camera; dip: horizon dip; atmos: 0..1
  update(e, n, u, dip, atmos, glowColor) {
    // rows = e, n, u  -> world to local
    this.uniforms.uEnuT.value.set(e[0], e[1], e[2], n[0], n[1], n[2], u[0], u[1], u[2]);
    this.uniforms.uDip.value = dip;
    this.uniforms.uAtmos.value = atmos;
    this.uniforms.uGlow.value.copy(glowColor);
  }
}
