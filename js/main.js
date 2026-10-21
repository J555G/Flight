import * as THREE from 'three';
import { R, D2R, R2D, enu } from './geo.js?v=20261021205936';
import { TileManager } from './tiles.js?v=20261021205936';
import { Flight } from './flight.js?v=20261021205936';
import { Controls } from './controls.js?v=20261021205936';
import { Gestures } from './gestures.js?v=20261021205936';
import { Sky } from './sky.js?v=20261021205936';
import { cross, norm, headingPitch, rotate } from './view.js?v=20261021205936';
import { QUALITY, START } from './config.js?v=20261021205936';

// ---------- settings (remembered per device) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('flight.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('flight.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
let qualityName = store.get('quality', 'medium');
if (!QUALITY[qualityName]) qualityName = 'medium';
let fovDeg = Math.min(110, Math.max(30, store.get('fov', 60)));

// ---------- renderer / scene ----------
const canvas = document.getElementById('view');
const q0 = QUALITY[qualityName];
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: q0.antialias, logarithmicDepthBuffer: true, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q0.pixelRatio));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const glowLow = new THREE.Color('#b7d0ea');
const glowSpace = new THREE.Color('#2a4670');
const glow = glowLow.clone();
scene.fog = new THREE.Fog(glowLow.clone(), 1e4, 1e5);
const sky = new Sky(scene);

const camera = new THREE.PerspectiveCamera(fovDeg, innerWidth / innerHeight, 1, 1e8);
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
tiles.setQuality(q0);

// ---------- start position (URL hash: #lat,lon,alt,heading) ----------
// look further down when starting high up, so the Earth is in view
const startPitch = (alt) => (alt > 300000 ? -80 : alt > 30000 ? -40 : 0);
function parseHash() {
  const p = location.hash.slice(1).split(',').map(Number);
  if (p.length >= 2 && p.slice(0, 2).every(Number.isFinite)) {
    const alt = Number.isFinite(p[2]) ? p[2] : 1500;
    return { lat: p[0], lon: p[1], alt, heading: Number.isFinite(p[3]) ? p[3] : 0, pitch: startPitch(alt) };
  }
  return START;
}
const flight = new Flight(parseHash());
const controls = new Controls(document.getElementById('stickL'), document.getElementById('stickR'));
controls.invertPitch = store.get('invertPitch', false);

const groundAt = (p) => tiles.heightAt(Math.atan2(p[1], p[0]), Math.atan2(p[2], Math.hypot(p[0], p[1])));

// ---------- free look (relative to the aircraft, rolls with it) ----------
// Default: tilted down so the horizon sits 2/3 of the way up the screen when flying level.
const defaultLookPitch = () => -Math.atan(Math.tan((fovDeg * D2R) / 2) / 3);
let lookYaw = 0;       // + = look right
let lookPitchUser = 0; // added to the default
const LOOK_LIMIT = 89 * D2R;

function look(dYaw, dPitch) {
  lookYaw = Math.atan2(Math.sin(lookYaw + dYaw), Math.cos(lookYaw + dYaw));
  const total = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, defaultLookPitch() + lookPitchUser + dPitch));
  lookPitchUser = total - defaultLookPitch();
}
function resetLook() { lookYaw = 0; lookPitchUser = 0; }

// ---------- modes ----------
let mode = 'flight';
let mapView = null; // { pos, fwd } while in map mode

function flightView() {
  const b = flight.basis();
  const cy = Math.cos(lookYaw), sy = Math.sin(lookYaw);
  const f1 = [0, 1, 2].map((i) => cy * b.fwd[i] + sy * b.right[i]);
  const right = [0, 1, 2].map((i) => cy * b.right[i] - sy * b.fwd[i]);
  const p = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, defaultLookPitch() + lookPitchUser));
  const cp = Math.cos(p), sp = Math.sin(p);
  const fwd = [0, 1, 2].map((i) => cp * f1[i] + sp * b.up[i]);
  const up = [0, 1, 2].map((i) => cp * b.up[i] - sp * f1[i]);
  return { pos: flight.pos, fwd, right, up };
}

function mapViewFull() {
  const { pos, fwd } = mapView;
  const right = norm(cross(fwd, norm(pos)));
  const up = cross(right, fwd);
  return { pos, fwd, right, up };
}

const view = () => (mode === 'map' ? mapViewFull() : flightView());

function setMapView(pos, fwd) {
  const r = Math.hypot(pos[0], pos[1], pos[2]);
  const minR = R + groundAt(pos) + 15;
  if (r < minR) pos = pos.map((c) => (c * minR) / r);
  fwd = norm(fwd);
  mapView = { pos: [...pos], fwd };
  const { heading, pitch } = headingPitch(pos, fwd);
  flight.setPose(pos, heading, pitch); // keeps HUD, address and terrain lookups in sync
}

const modeBtn = document.getElementById('modeBtn');
function setMode(m) {
  if (m === mode) return;
  if (m === 'map') {
    const v = flightView();
    setMapView([...v.pos], v.fwd);
  } else {
    // continue flying from exactly the same camera: level aircraft, view kept as a look offset
    const v = mapViewFull();
    const { heading, pitch } = headingPitch(v.pos, v.fwd);
    flight.setPose(v.pos, heading, 0);
    lookYaw = 0;
    lookPitchUser = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, pitch)) - defaultLookPitch();
    mapView = null;
  }
  mode = m;
  document.body.classList.toggle('map-mode', m === 'map');
  modeBtn.textContent = m === 'map' ? '✈ Fly' : '🗺 Map';
}
modeBtn.addEventListener('click', () => setMode(mode === 'map' ? 'flight' : 'map'));

new Gestures(canvas, {
  mode: () => mode,
  view,
  vfov: () => fovDeg * D2R,
  groundAt,
  look,
  resetLook,
  setMapView,
});

// ---------- camera from the current view ----------
const _basis = new THREE.Matrix4();
const _v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
function updateCamera() {
  const v = view();
  _basis.makeBasis(_v[0].set(...v.right), _v[1].set(...v.up), _v[2].set(-v.fwd[0], -v.fwd[1], -v.fwd[2]));
  camera.matrix.copy(_basis); // camera sits at the origin; the world moves around it
  camera.matrixWorld.copy(camera.matrix);
  camera.matrixWorldInverse.copy(camera.matrix).invert();

  const p = flight.pos;
  base.position.set(-p[0], -p[1], -p[2]);
  base.updateMatrix();

  // atmosphere, haze and sky depend on altitude
  const h = Math.max(flight.alt, 1);
  const horizon = Math.sqrt(2 * R * h + h * h);
  const space = THREE.MathUtils.smoothstep(h, 15000, 250000);
  glow.copy(glowLow).lerp(glowSpace, space);
  scene.fog.color.copy(glow);
  const clear = THREE.MathUtils.smoothstep(h, 20000, 200000);
  scene.fog.far = (horizon + 60000) * (1.2 + 30 * clear);
  scene.fog.near = scene.fog.far * 0.25;
  const { e, n, u } = enu(flight.lon, flight.lat);
  sky.update(e, n, u, Math.acos(R / (R + h)), 1 - space, glow);

  camera.fov = fovDeg;
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
  hud.spd.textContent = mode === 'map' ? 'map' : kmh < 1 ? 'hover' : kmh >= 10000 ? `${(kmh / 1000).toFixed(1)}k km/h` : `${Math.round(kmh)} km/h`;
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
  if (mode === 'flight') {
    flight.update(dt, controls.read(), ground);
  } else {
    flight.ground = ground;
    if (flight.agl < 15) setMapView(mapView.pos, mapView.fwd); // terrain arrived under us
  }
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

const fovIn = document.getElementById('fov');
const fovOut = document.getElementById('fovVal');
fovIn.value = fovDeg;
fovOut.textContent = `${fovDeg}°`;
fovIn.addEventListener('input', () => {
  fovDeg = Number(fovIn.value);
  fovOut.textContent = `${fovDeg}°`;
  store.set('fov', fovDeg);
});

const inv = document.getElementById('invertPitch');
inv.checked = controls.invertPitch;
inv.addEventListener('change', () => { controls.invertPitch = inv.checked; store.set('invertPitch', inv.checked); });

document.getElementById('lookBtn').addEventListener('click', () => { resetLook(); menu.classList.remove('open'); });

function jumpTo(lat, lon, alt, heading) {
  const tmp = new Flight({ lat, lon, alt, heading, pitch: startPitch(alt) });
  if (mode === 'map') {
    const b = tmp.basis();
    setMapView([...tmp.pos], rotate(b.fwd, b.right, -30 * D2R));
  } else {
    flight.setPose(tmp.pos, tmp.heading, tmp.pitch);
    resetLook();
  }
}

document.getElementById('gotoBtn').addEventListener('click', () => {
  const s = prompt('Fly to coordinates: latitude, longitude (e.g. 37.75, 14.99)');
  if (!s) return;
  const [la, lo] = s.split(/[,\s]+/).map(Number);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90) { alert('Could not read those coordinates.'); return; }
  jumpTo(la, lo, Math.max(flight.agl, 1500), flight.heading * R2D);
  menu.classList.remove('open');
});

document.getElementById('homeBtn').addEventListener('click', () => {
  jumpTo(START.lat, START.lon, START.alt, START.heading);
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
