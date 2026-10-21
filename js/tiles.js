// Streams a quadtree of Web Mercator tiles onto a spherical Earth.
// Each tile = satellite image draped on a terrain mesh. Meshes store vertices
// relative to their own centre; each frame they are positioned relative to the
// camera ("relative to eye"), so float precision stays good anywhere on Earth.

import * as THREE from 'three';
import { R, tile2lon, tile2lat, ecef, lonLatToTile } from './geo.js';
import { TN, fetchTerrarium } from './terrarium.js';
import {
  IMAGERY_URL, IMAGERY_MAX_Z, TERRAIN_URL,
  TERRAIN_BASE_MAX_Z, TERRAIN_TRY_MAX_Z, fillUrl,
} from './config.js';

const SEG = 32;          // mesh segments per tile side
const ROOT_Z = 2;
const MAX_Z = IMAGERY_MAX_Z;
const MAX_IMAGE_REQUESTS = 10;
const BUILDS_PER_FRAME = 3;

// ---------- shared grid topology (copied per tile as typed arrays) ----------
const GRID_V = (SEG + 1) * (SEG + 1);
const PERIM = [];
for (let i = 0; i < SEG; i++) PERIM.push([i, 0]);
for (let j = 0; j < SEG; j++) PERIM.push([SEG, j]);
for (let i = SEG; i > 0; i--) PERIM.push([i, SEG]);
for (let j = SEG; j > 0; j--) PERIM.push([0, j]);
const VCOUNT = GRID_V + PERIM.length;

const UV = new Float32Array(VCOUNT * 2);
for (let j = 0; j <= SEG; j++)
  for (let i = 0; i <= SEG; i++) {
    const k = j * (SEG + 1) + i;
    UV[k * 2] = i / SEG;
    UV[k * 2 + 1] = j / SEG; // v=0 at north edge (textures not flipped)
  }
PERIM.forEach(([i, j], p) => {
  const k = GRID_V + p;
  UV[k * 2] = i / SEG;
  UV[k * 2 + 1] = j / SEG;
});

const INDEX = (() => {
  const idx = [];
  for (let j = 0; j < SEG; j++)
    for (let i = 0; i < SEG; i++) {
      const a = j * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const n = PERIM.length;
  for (let p = 0; p < n; p++) {
    const q = (p + 1) % n;
    const [ia, ja] = PERIM[p], [ib, jb] = PERIM[q];
    const a = ja * (SEG + 1) + ia, b = jb * (SEG + 1) + ib;
    const sa = GRID_V + p, sb = GRID_V + q;
    idx.push(a, sa, b, b, sa, sb);
  }
  return new Uint16Array(idx);
})();

// ---------- terrain cache ----------
function sampleTerrain(ter, z, x, y, u, v) {
  const s = 2 ** (z - ter.tz);
  const fu = (x - ter.tx * s + u) / s;
  const fv = (y - ter.ty * s + v) / s;
  const fx = Math.min(Math.max(fu, 0), 1) * (TN - 1);
  const fy = Math.min(Math.max(fv, 0), 1) * (TN - 1);
  const x0 = Math.min(Math.floor(fx), TN - 2), y0 = Math.min(Math.floor(fy), TN - 2);
  const tx = fx - x0, ty = fy - y0, d = ter.data, k = y0 * TN + x0;
  const a = d[k] * (1 - tx) + d[k + 1] * tx;
  const b = d[k + TN] * (1 - tx) + d[k + TN + 1] * tx;
  return a * (1 - ty) + b * ty;
}

class TerrainCache {
  constructor() {
    this.entries = new Map();
    this.missing = new Set();
    this.queue = [];
    this.active = 0;
    this.maxActive = 6;
    this.maxEntries = 160;
    this.pending = new Map();
    this.nextId = 1;
    this.worker = null;
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./terrain-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => {
          const cb = this.pending.get(e.data.id);
          this.pending.delete(e.data.id);
          if (cb) cb(e.data);
        };
        this.worker.onerror = () => { this.worker = null; };
      } catch { this.worker = null; }
    }
  }

  _fetch(url) {
    if (this.worker) {
      return new Promise((resolve) => {
        const id = this.nextId++;
        this.pending.set(id, resolve);
        this.worker.postMessage({ id, url });
      });
    }
    return fetchTerrarium(url, (w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h; return c;
    }).catch((e) => ({ status: 0, error: String(e) }));
  }

  _throttled(url) {
    return new Promise((resolve) => {
      this.queue.push({ url, resolve });
      this._pump();
    });
  }

  _pump() {
    while (this.active < this.maxActive && this.queue.length) {
      const { url, resolve } = this.queue.shift();
      this.active++;
      this._fetch(url).then((r) => {
        this.active--;
        resolve(r);
        this._pump();
      });
    }
  }

  _isMissing(tz, tx, ty) {
    for (let k = tz; k > TERRAIN_BASE_MAX_Z; k--) {
      const s = tz - k;
      if (this.missing.has(`${k}/${tx >> s}/${ty >> s}`)) return true;
    }
    return false;
  }

  // Resolves to { data, min, max } or null.
  _entry(tz, tx, ty) {
    const key = `${tz}/${tx}/${ty}`;
    let e = this.entries.get(key);
    if (e) {
      this.entries.delete(key);
      this.entries.set(key, e); // LRU bump
      return e;
    }
    e = this._throttled(fillUrl(TERRAIN_URL, tz, tx, ty)).then((r) => {
      if (r.status === 200) return { data: r.data, min: r.min, max: r.max };
      if (tz > TERRAIN_BASE_MAX_Z) this.missing.add(key);
      else this.entries.delete(key); // allow retry later for base levels
      return null;
    });
    this.entries.set(key, e);
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
    return e;
  }

  async get(z, x, y) {
    let tz = Math.min(z, TERRAIN_TRY_MAX_Z);
    while (tz > TERRAIN_BASE_MAX_Z && this._isMissing(tz, x >> (z - tz), y >> (z - tz))) tz--;
    for (;;) {
      const tx = x >> (z - tz), ty = y >> (z - tz);
      const r = await this._entry(tz, tx, ty);
      if (r) return { tz, tx, ty, ...r };
      if (tz <= TERRAIN_BASE_MAX_Z) return null;
      tz--;
    }
  }
}

// ---------- tiles ----------
const _p = new Float64Array(3);

class Tile {
  constructor(z, x, y, parent) {
    this.z = z; this.x = x; this.y = y; this.parent = parent;
    this.children = null;
    this.state = 'empty'; // empty | loading | built | error
    this.mesh = null;
    this.terrain = null;
    this.lastUsed = 0;
    this.retryAt = 0;
    this.cullFrame = -1; this.culled = false;

    const lon0 = tile2lon(x, z), lon1 = tile2lon(x + 1, z);
    const latN = tile2lat(y, z), latS = tile2lat(y + 1, z);
    const lonC = (lon0 + lon1) / 2, latC = tile2lat(y + 0.5, z);
    this.center = ecef(lonC, latC, 0, new Float64Array(3));
    let r = 0;
    for (const [lo, la] of [[lon0, latN], [lon1, latN], [lon0, latS], [lon1, latS],
      [lonC, latN], [lonC, latS], [lon0, latC], [lon1, latC]]) {
      ecef(lo, la, 0, _p);
      r = Math.max(r, Math.hypot(_p[0] - this.center[0], _p[1] - this.center[1], _p[2] - this.center[2]));
    }
    const hMax = parent ? Math.max(parent.hMax, 0) : 9000;
    this.hMax = hMax;
    this.radius = r * 1.05 + hMax + 500;
    const minAbsLat = latN * latS < 0 ? 0 : Math.min(Math.abs(latN), Math.abs(latS));
    this.size = Math.max((lon1 - lon0) * R * Math.cos(minAbsLat), (latN - latS) * R);
  }

  get ready() { return this.state === 'built'; }

  ensureChildren() {
    if (!this.children) {
      const z = this.z + 1, x = this.x * 2, y = this.y * 2;
      this.children = [
        new Tile(z, x, y, this), new Tile(z, x + 1, y, this),
        new Tile(z, x, y + 1, this), new Tile(z, x + 1, y + 1, this),
      ];
    }
    return this.children;
  }

  build(bitmap, renderer, anisotropy) {
    const { z, x, y, terrain } = this;
    const pos = new Float64Array(VCOUNT * 3);
    const heights = new Float32Array(GRID_V);
    let hMin = Infinity, hMax = -Infinity;
    for (let j = 0; j <= SEG; j++) {
      const lat = tile2lat(y + j / SEG, z);
      for (let i = 0; i <= SEG; i++) {
        const lon = tile2lon(x + i / SEG, z);
        const h = terrain ? sampleTerrain(terrain, z, x, y, i / SEG, j / SEG) : 0;
        const k = j * (SEG + 1) + i;
        heights[k] = h;
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
        ecef(lon, lat, h, _p);
        pos[k * 3] = _p[0]; pos[k * 3 + 1] = _p[1]; pos[k * 3 + 2] = _p[2];
      }
    }
    const skirt = this.size * 0.02 + 30;
    PERIM.forEach(([i, j], p) => {
      const k = j * (SEG + 1) + i;
      ecef(tile2lon(x + i / SEG, z), tile2lat(y + j / SEG, z), heights[k] - skirt, _p);
      const s = GRID_V + p;
      pos[s * 3] = _p[0]; pos[s * 3 + 1] = _p[1]; pos[s * 3 + 2] = _p[2];
    });

    // centre = middle grid vertex; vertices stored relative to it
    const mid = (SEG / 2) * (SEG + 1) + SEG / 2;
    const c = new Float64Array([pos[mid * 3], pos[mid * 3 + 1], pos[mid * 3 + 2]]);
    const rel = new Float32Array(VCOUNT * 3);
    let r2 = 0;
    for (let k = 0; k < VCOUNT; k++) {
      const dx = pos[k * 3] - c[0], dy = pos[k * 3 + 1] - c[1], dz = pos[k * 3 + 2] - c[2];
      rel[k * 3] = dx; rel[k * 3 + 1] = dy; rel[k * 3 + 2] = dz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) r2 = d2;
    }
    this.center = c;
    this.radius = Math.sqrt(r2) * 1.01;
    this.hMax = hMax;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(rel, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
    geo.setIndex(new THREE.BufferAttribute(INDEX, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius);

    const tex = new THREE.Texture(bitmap);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    renderer.initTexture(tex);
    if (bitmap.close) bitmap.close();

    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false; // we cull ourselves
    mesh.visible = false;
    this.mesh = mesh;
    this.state = 'built';
  }

  dispose(group) {
    if (this.mesh) {
      group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.map.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    this.terrain = null;
    this.state = 'empty';
  }
}

async function loadImage(z, x, y) {
  const res = await fetch(fillUrl(IMAGERY_URL, z, x, y), { mode: 'cors' });
  if (!res.ok) throw new Error('imagery ' + res.status);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

export class TileManager {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.terrain = new TerrainCache();
    this.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    this.roots = [];
    const n = 2 ** ROOT_Z;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) this.roots.push(new Tile(ROOT_Z, x, y, null));
    this.frame = 0;
    this.inflight = 0;
    this.built = [];       // tiles with meshes
    this.buildQueue = [];
    this.visible = [];
    this.lod = 2.0;
    this.maxTiles = 240;
    this.frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._s = new THREE.Sphere();
    this.pendingCount = 0;
  }

  setQuality(q) { this.lod = q.lod; this.maxTiles = q.maxTiles; }

  _isCulled(t) {
    if (t.cullFrame === this.frame) return t.culled;
    t.cullFrame = this.frame;
    const cam = this.cam;
    const cx = t.center[0] - cam[0], cy = t.center[1] - cam[1], cz = t.center[2] - cam[2];
    // horizon: is the tile's bounding sphere entirely below the horizon plane?
    let culled = false;
    const len = this.camLen, rMin = R - 1000;
    if (len > rMin) {
      const s = (t.center[0] * cam[0] + t.center[1] * cam[1] + t.center[2] * cam[2]) / len - (rMin * rMin) / len;
      if (s < -t.radius) culled = true;
    }
    if (!culled) {
      this._s.center.set(cx, cy, cz);
      this._s.radius = t.radius;
      culled = !this.frustum.intersectsSphere(this._s);
    }
    t.culled = culled;
    return culled;
  }

  _wantsSplit(t) {
    if (t.z >= MAX_Z) return false;
    const cam = this.cam;
    const d = Math.hypot(t.center[0] - cam[0], t.center[1] - cam[1], t.center[2] - cam[2]) - t.radius;
    t.priority = Math.max(d, 1) / t.size;
    return d < t.size * this.lod;
  }

  _request(t) {
    if (t.state === 'empty' || (t.state === 'error' && performance.now() > t.retryAt)) {
      if (t.priority === undefined) this._wantsSplit(t);
      this.requests.push(t);
    }
  }

  _select(t) {
    if (this._isCulled(t)) return;
    t.lastUsed = this.frame;
    if (this._wantsSplit(t)) {
      const kids = t.ensureChildren();
      let all = true;
      for (const c of kids) {
        if (!c.ready && !this._isCulled(c)) { all = false; this._request(c); }
      }
      if (all) { for (const c of kids) this._select(c); return; }
    }
    if (t.ready) { this._draw(t); return; }
    this._request(t);
    // fallback: draw ready children if we lost our own mesh
    if (t.children && t.children.every((c) => c.ready || this._isCulled(c))) {
      for (const c of t.children) if (!this._isCulled(c)) { c.lastUsed = this.frame; this._draw(c); }
    }
  }

  _draw(t) {
    const m = t.mesh, cam = this.cam;
    m.position.set(t.center[0] - cam[0], t.center[1] - cam[1], t.center[2] - cam[2]);
    m.updateMatrix();
    m.visible = true;
    this.visible.push(t);
  }

  async _load(t) {
    t.state = 'loading';
    this.inflight++;
    try {
      const [bmp, ter] = await Promise.all([
        loadImage(t.z, t.x, t.y),
        this.terrain.get(t.z, t.x, t.y),
      ]);
      t.terrain = ter;
      this.buildQueue.push({ t, bmp });
    } catch (e) {
      t.state = 'error';
      t.retryAt = performance.now() + 5000;
    } finally {
      this.inflight--;
    }
  }

  update(camPos, camera) {
    this.frame++;
    this.cam = camPos;
    this.camLen = Math.hypot(camPos[0], camPos[1], camPos[2]);
    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._m);

    // finish a few loaded tiles per frame (texture uploads are the costly part)
    for (let n = 0; n < BUILDS_PER_FRAME && this.buildQueue.length; n++) {
      const { t, bmp } = this.buildQueue.shift();
      if (t.state !== 'loading') { if (bmp.close) bmp.close(); continue; }
      t.build(bmp, this.renderer, this.anisotropy);
      this.group.add(t.mesh);
      this.built.push(t);
    }

    for (const t of this.visible) if (t.mesh) t.mesh.visible = false;
    this.visible = [];
    this.requests = [];
    for (const r of this.roots) this._select(r);

    // start the most urgent loads
    this.requests.sort((a, b) => a.z - b.z || a.priority - b.priority);
    this.pendingCount = this.requests.length + this.inflight;
    for (const t of this.requests) {
      if (this.inflight >= MAX_IMAGE_REQUESTS) break;
      if (t.state === 'loading' || t.state === 'built') continue;
      this._load(t);
    }

    if (this.built.length > this.maxTiles) this._evict();
    if (this.frame % 300 === 0) for (const r of this.roots) this._prune(r);
  }

  _evict() {
    const frame = this.frame;
    const cand = this.built.filter((t) => t.lastUsed < frame && t.z > ROOT_Z);
    cand.sort((a, b) => a.lastUsed - b.lastUsed || b.z - a.z);
    let excess = this.built.length - this.maxTiles;
    const gone = new Set();
    for (const t of cand) {
      if (excess-- <= 0) break;
      t.dispose(this.group);
      gone.add(t);
    }
    this.built = this.built.filter((t) => !gone.has(t));
  }

  _hasLoaded(t) {
    if (t.state !== 'empty' && t.state !== 'error') return true;
    return !!t.children && t.children.some((c) => this._hasLoaded(c));
  }

  _prune(t) {
    if (!t.children) return;
    if (t.lastUsed < this.frame - 600 && !t.children.some((c) => this._hasLoaded(c))) {
      t.children = null;
      return;
    }
    for (const c of t.children) this._prune(c);
  }

  // Terrain height (m) under lon/lat from the most detailed loaded tile.
  heightAt(lon, lat) {
    let [fx, fy] = lonLatToTile(lon, lat, ROOT_Z);
    const n = 2 ** ROOT_Z;
    let t = this.roots[Math.min(n - 1, Math.floor(fy)) * n + Math.min(n - 1, Math.floor(fx))];
    let best = t && t.ready && t.terrain ? t : null;
    while (t && t.children) {
      const z = t.z + 1;
      [fx, fy] = lonLatToTile(lon, lat, z);
      const cx = Math.floor(fx) - t.x * 2, cy = Math.floor(fy) - t.y * 2;
      if (cx < 0 || cx > 1 || cy < 0 || cy > 1) break;
      t = t.children[cy * 2 + cx];
      if (t.ready && t.terrain) best = t;
      else if (!t.ready) break;
    }
    if (!best) return 0;
    const [ux, uy] = lonLatToTile(lon, lat, best.z);
    return sampleTerrain(best.terrain, best.z, best.x, best.y, ux - best.x, uy - best.y);
  }
}
