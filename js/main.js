import * as THREE from 'three';
import { R, R2D } from './geo.js';
import { TileManager } from './tiles.js';
import { Flight } from './flight.js';
import { Controls } from './controls.js';
import { QUALITY, START } from './config.js';

// ---------- settings (remembered per device) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('flight.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('flight.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
let qualityName = store.get('quality', 'medium');
if (!QUALITY[qualityName]) qualityName = 'medium';

// ---------- renderer / scene ----------
const canvas = document.getElementById('view');
let renderer;
function makeRenderer() {
  const q = QUALITY[qualityName];
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: q.antialias, logarithmicDepthBuffer: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.pixelRatio));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}
makeRenderer();

const scene = new THREE.Scene();
const skyLow = new THREE.Color('#a9c8e8');
const skySpace = new THREE.Color('#02050c');
scene.background = skyLow.clone();
scene.fog = new THREE.Fog(skyLow.clone(), 1e4, 1e5);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 1, 1e8);
camera.matrixAutoUpdate = false;

// Plain sphere a little below sea level: fills the poles (outside Web Mercator) and any gaps.
const base = new THREE.Mesh(
  new THREE.SphereGeometry(R - 1500, 96, 48),
  new THREE.MeshBasicMaterial({ color: '#d6dde6' }),
);
base.rotation.x = Math.PI / 2; // sphere poles on Y -> our poles on Z
base.matrixAutoUpdate = false;
scene.add(base);

const tiles = new TileManager(renderer, scene);
tiles.setQuality(QUALITY[qualityName]);

// ---------- start position (URL hash: #lat,lon,alt,heading) ----------
// look further down when starting high up, so the Earth is in view
const startPitch = (alt) => (alt > 300000 ? -85 : alt > 30000 ? -45 : -6);
function parseHash() {
  const p = location.hash.slice(1).split(',').map(Number);
  if (p.length >= 2 && p.slice(0, 2).every(Number.isFinite)) {
    return {
      lat: p[0], lon: p[1],
      alt: Number.isFinite(p[2]) ? p[2] : 1500,
      heading: Number.isFinite(p[3]) ? p[3] : 0,
      pitch: startPitch(Number.isFinite(p[2]) ? p[2] : 1500),
    };
  }
  return START;
}
let flight = new Flight(parseHash());
const controls = new Controls(document.getElementById('stickL'), document.getElementById('stickR'));
controls.invertPitch = store.get('invertPitch', false);

// ---------- camera from flight state ----------
const _basis = new THREE.Matrix4();
function updateCamera() {
  const b = flight.basis();
  _basis.makeBasis(
    new THREE.Vector3(...b.right),
    new THREE.Vector3(...b.up),
    new THREE.Vector3(-b.fwd[0], -b.fwd[1], -b.fwd[2]),
  );
  camera.matrix.copy(_basis); // camera sits at the origin; the world moves around it
  camera.matrixWorld.copy(camera.matrix);
  camera.matrixWorldInverse.copy(camera.matrix).invert();

  const p = flight.pos;
  base.position.set(-p[0], -p[1], -p[2]);
  base.updateMatrix();

  // sky colour and haze depend on altitude
  const h = Math.max(flight.alt, 1);
  const horizon = Math.sqrt(2 * R * h + h * h);
  const space = THREE.MathUtils.smoothstep(h, 12000, 90000);
  scene.background.copy(skyLow).lerp(skySpace, space);
  scene.fog.color.copy(skyLow).lerp(skySpace, Math.min(1, space * 1.5));
  const clear = THREE.MathUtils.smoothstep(h, 20000, 200000);
  scene.fog.far = (horizon + 60000) * (1.2 + 30 * clear);
  scene.fog.near = scene.fog.far * 0.25;

  camera.near = Math.max(0.5, Math.min(flight.agl * 0.02, 1000));
  camera.far = horizon * 3 + 2 * R;
  camera.updateProjectionMatrix();
}

// ---------- HUD ----------
const hud = {
  alt: document.getElementById('hAlt'),
  agl: document.getElementById('hAgl'),
  spd: document.getElementById('hSpd'),
  hdg: document.getElementById('hHdg'),
  pos: document.getElementById('hPos'),
  load: document.getElementById('loading'),
};
const fmtDist = (m) => (Math.abs(m) >= 10000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
function updateHud() {
  const f = flight;
  hud.alt.textContent = fmtDist(f.alt);
  hud.agl.textContent = fmtDist(f.agl);
  const kmh = Math.hypot(f.vf, f.vs) * 3.6;
  hud.spd.textContent = kmh < 1 ? 'hover' : kmh >= 10000 ? `${(kmh / 1000).toFixed(1)}k km/h` : `${Math.round(kmh)} km/h`;
  hud.hdg.textContent = `${String(Math.round(f.heading * R2D) % 360).padStart(3, '0')}°`;
  const la = f.lat * R2D, lo = f.lon * R2D;
  hud.pos.textContent = `${Math.abs(la).toFixed(4)}°${la >= 0 ? 'N' : 'S'} ${Math.abs(lo).toFixed(4)}°${lo >= 0 ? 'E' : 'W'}`;
  hud.load.classList.toggle('show', tiles.pendingCount > 0);
}

let lastHash = 0;
function saveHash(now) {
  if (now - lastHash < 2000) return;
  lastHash = now;
  const f = flight;
  const h = `#${(f.lat * R2D).toFixed(5)},${(f.lon * R2D).toFixed(5)},${Math.round(f.alt)},${Math.round(f.heading * R2D)}`;
  history.replaceState(null, '', h);
}

// ---------- loop ----------
let last = performance.now();
let hudTimer = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (document.hidden) return;

  const ground = tiles.heightAt(flight.lon, flight.lat);
  flight.update(dt, controls.read(), ground);
  updateCamera();
  tiles.update(flight.pos, camera);
  renderer.render(scene, camera);
  window.__flightStarted = true;

  hudTimer += dt;
  if (hudTimer > 0.1) { hudTimer = 0; updateHud(); saveHash(now); }
}
requestAnimationFrame(frame);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
}
addEventListener('resize', resize);
resize();

// ---------- menu ----------
const menu = document.getElementById('menu');
document.getElementById('menuBtn').addEventListener('click', () => menu.classList.toggle('open'));
document.getElementById('closeMenu').addEventListener('click', () => menu.classList.remove('open'));

function markQuality() {
  for (const b of document.querySelectorAll('[data-q]')) b.classList.toggle('on', b.dataset.q === qualityName);
}
markQuality();
for (const b of document.querySelectorAll('[data-q]')) {
  b.addEventListener('click', () => {
    const prevAA = QUALITY[qualityName].antialias;
    qualityName = b.dataset.q;
    store.set('quality', qualityName);
    markQuality();
    const q = QUALITY[qualityName];
    tiles.setQuality(q);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.pixelRatio));
    resize();
    // antialiasing can only change with a new WebGL context
    if (q.antialias !== prevAA) location.reload();
  });
}

const inv = document.getElementById('invertPitch');
inv.checked = controls.invertPitch;
inv.addEventListener('change', () => { controls.invertPitch = inv.checked; store.set('invertPitch', inv.checked); });

document.getElementById('gotoBtn').addEventListener('click', () => {
  const s = prompt('Fly to coordinates: latitude, longitude (e.g. 37.75, 14.99)');
  if (!s) return;
  const [la, lo] = s.split(/[,\s]+/).map(Number);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90) { alert('Could not read those coordinates.'); return; }
  const keepAlt = Math.max(flight.agl, 1500);
  flight = new Flight({ lat: la, lon: lo, alt: keepAlt, heading: flight.heading * R2D, pitch: startPitch(keepAlt) });
  menu.classList.remove('open');
});

document.getElementById('homeBtn').addEventListener('click', () => {
  flight = new Flight(START);
  menu.classList.remove('open');
});

const fsBtn = document.getElementById('fsBtn');
const root = document.documentElement;
if (root.requestFullscreen || root.webkitRequestFullscreen) {
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    }
  });
} else {
  fsBtn.style.display = 'none';
}

// stop iOS pinch / double-tap zoom stealing gestures
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault());
}
document.addEventListener('touchmove', (e) => { if (!e.target.closest('.menu')) e.preventDefault(); }, { passive: false });
