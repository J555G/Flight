// Touch / mouse gestures on the 3D view (everything outside the joysticks).
//
// Flight mode: drag = look around (pan / tilt the camera), double tap = look ahead again.
// Map mode:    one finger drags the ground, pinch zooms, two-finger twist rotates,
//              two fingers moving up/down together tilt. Double tap zooms in.
//              Mouse: drag = pan, wheel = zoom, right-drag = rotate / tilt.

import { R } from './geo.js?v=20261021205936';
import { dot, cross, norm, add, scale, rotate, headingPitch, screenRay, hitSphere } from './view.js?v=20261021205936';

export class Gestures {
  // app: { mode(), view(), vfov(), groundAt(pos), look(dYaw, dPitch), resetLook(), setMapView(pos, fwd) }
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.pts = new Map();
    this.lastTap = { t: 0, x: 0, y: 0 };
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, (e) => this._up(e));
    el.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _ndc(x, y) {
    const r = this.el.getBoundingClientRect();
    return [((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2];
  }

  // World point on the ground under a screen position (or null for sky).
  _hit(x, y) {
    const v = this.app.view();
    const [nx, ny] = this._ndc(x, y);
    const r = this.el.getBoundingClientRect();
    const dir = screenRay(v, nx, ny, this.app.vfov(), r.width / r.height);
    let h = this.app.groundAt(v.pos);
    let p = hitSphere(v.pos, dir, h);
    if (!p) return null;
    h = this.app.groundAt(p);
    return hitSphere(v.pos, dir, h) || p;
  }

  _down(e) {
    this.el.setPointerCapture(e.pointerId);
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
    const now = performance.now();
    if (this.pts.size === 1) {
      const dt = now - this.lastTap.t;
      const near = Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 40;
      if (dt < 320 && near) this._doubleTap(e.clientX, e.clientY);
      this.lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    this._baseline();
  }

  _up(e) {
    if (!this.pts.has(e.pointerId)) return;
    this.pts.delete(e.pointerId);
    this._baseline();
  }

  _baseline() {
    const p = [...this.pts.values()];
    this.anchor = null;
    if (p.length === 1 && this.app.mode() === 'map' && p[0].button !== 2) {
      this.anchor = this._hit(p[0].x, p[0].y);
    }
    if (p.length >= 2) {
      this.prev2 = this._two(p[0], p[1]);
    }
  }

  _two(a, b) {
    return {
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      d: Math.hypot(b.x - a.x, b.y - a.y),
      ang: Math.atan2(b.y - a.y, b.x - a.x),
      ay: a.y, by: b.y,
    };
  }

  _move(e) {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const pts = [...this.pts.values()];
    const h = this.el.getBoundingClientRect().height;
    const k = this.app.vfov() / h; // radians per pixel: the scene follows the finger

    if (this.app.mode() === 'flight') {
      if (pts.length === 1) this.app.look(-dx * k, dy * k);
      return;
    }

    // ---- map mode ----
    if (pts.length === 1) {
      if (p.button === 2 || e.shiftKey) { this._rotate(dx * 0.006, null); this._tilt(-dy * k); return; }
      if (!this.anchor) { this.anchor = this._hit(p.x, p.y); return; }
      const b = this._hit(p.x, p.y);
      if (!b) return;
      const A = norm(this.anchor), B = norm(b);
      const axis = cross(B, A);
      const s = Math.hypot(...axis);
      if (s < 1e-12) return;
      const ang = Math.atan2(s, dot(A, B));
      const v = this.app.view();
      const ax = scale(axis, 1 / s);
      this.app.setMapView(rotate([...v.pos], ax, ang), rotate(v.fwd, ax, ang));
      return;
    }

    if (pts.length >= 2) {
      const cur = this._two(pts[0], pts[1]);
      const prev = this.prev2;
      this.prev2 = cur;
      if (!prev) return;
      const day = cur.ay - prev.ay, dby = cur.by - prev.by;
      const dd = cur.d - prev.d;
      let dang = cur.ang - prev.ang;
      if (dang > Math.PI) dang -= 2 * Math.PI;
      if (dang < -Math.PI) dang += 2 * Math.PI;
      const meanDy = (day + dby) / 2;
      const together = day * dby > 0 && Math.abs(dd) < Math.abs(meanDy) * 0.6 && Math.abs(dang) < 0.02;
      if (together) {
        this._tilt(-meanDy * k);
      } else {
        const pivot = this._hit(cur.cx, cur.cy);
        if (prev.d > 0 && cur.d > 0) this._zoom(prev.d / cur.d, pivot);
        if (Math.abs(dang) > 1e-4) this._rotate(dang, pivot);
      }
    }
  }

  _zoom(f, pivot) {
    const v = this.app.view();
    if (!pivot) {
      // pointing at the sky: zoom straight down/up instead
      const g = this.app.groundAt(v.pos);
      const r = Math.hypot(...v.pos);
      const alt = r - R - g;
      pivot = scale(v.pos, (R + g) / r);
      if (alt <= 0) return;
    }
    const off = add(v.pos, pivot, -1);
    let np = add(pivot, off, f);
    const r = Math.hypot(...np);
    const minR = R + this.app.groundAt(np) + 15, maxR = R + 2.5e7;
    if (r < minR) np = scale(np, minR / r);
    if (r > maxR) np = scale(np, maxR / r);
    this.app.setMapView(np, v.fwd);
  }

  _rotate(ang, pivot) {
    const v = this.app.view();
    pivot = pivot || this._hit(...this._center()) || scale(v.pos, R / Math.hypot(...v.pos));
    const axis = norm(pivot);
    const np = add(pivot, rotate(add(v.pos, pivot, -1), axis, ang));
    this.app.setMapView(np, rotate(v.fwd, axis, ang));
  }

  _tilt(ang) {
    const v = this.app.view();
    const pivot = this._hit(...this._center());
    const { pitch } = headingPitch(v.pos, v.fwd);
    const lim = [-89.5 * Math.PI / 180, 10 * Math.PI / 180];
    ang = Math.max(lim[0] - pitch, Math.min(lim[1] - pitch, ang));
    if (Math.abs(ang) < 1e-6) return;
    // axis: horizontal right vector of the camera
    const up = norm(v.pos);
    const right = norm(cross(v.fwd, up));
    if (!pivot) { this.app.setMapView([...v.pos], rotate(v.fwd, right, ang)); return; }
    let np = add(pivot, rotate(add(v.pos, pivot, -1), right, ang));
    const r = Math.hypot(...np);
    const minR = R + this.app.groundAt(np) + 15;
    if (r < minR) return;
    this.app.setMapView(np, rotate(v.fwd, right, ang));
  }

  _center() {
    const r = this.el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  _wheel(e) {
    e.preventDefault();
    if (this.app.mode() !== 'map') return;
    this._zoom(Math.exp(e.deltaY * 0.0015), this._hit(e.clientX, e.clientY));
  }

  _doubleTap(x, y) {
    if (this.app.mode() === 'flight') this.app.resetLook();
    else this._zoom(0.5, this._hit(x, y));
  }
}
