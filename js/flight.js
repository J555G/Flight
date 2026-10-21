// Arcade flight model: an aircraft that hovers when the throttle stick is released.
//
// Left stick:  forward/back = speed along the nose, left/right = sideways slide.
// Right stick: up/down = pitch, left/right = bank with coordinated yaw.
// Release the left stick and the craft smoothly comes to a hover in place.

import { R, D2R, ecef, enu, wrapLon } from './geo.js?v=20261021205936';

const MAX_BANK = 50 * D2R;
const MAX_PITCH = 85 * D2R;
const PITCH_RATE = 45 * D2R;   // rad/s at full stick
const HOVER_YAW = 1.0;         // rad/s at full bank when hovering
const MIN_AGL = 3;

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export class Flight {
  constructor(s) {
    this.lat = s.lat * D2R;
    this.lon = s.lon * D2R;
    this.alt = s.alt;                 // metres above sea level (sphere)
    this.heading = s.heading * D2R;   // from north, clockwise
    this.pitch = (s.pitch || 0) * D2R;
    this.bank = 0;
    this.vf = 0;                      // forward speed (m/s, negative = backwards)
    this.vs = 0;                      // sideways speed (m/s, positive = right)
    this.ground = 0;
    this.pos = new Float64Array(3);
    ecef(this.lon, this.lat, this.alt, this.pos);
  }

  get agl() { return this.alt - this.ground; }

  // Place the craft at a world position with the given heading/pitch, hovering level.
  setPose(p, heading, pitch) {
    this.pos[0] = p[0]; this.pos[1] = p[1]; this.pos[2] = p[2];
    this.lon = wrapLon(Math.atan2(p[1], p[0]));
    this.lat = Math.atan2(p[2], Math.hypot(p[0], p[1]));
    this.alt = Math.hypot(p[0], p[1], p[2]) - R;
    this.heading = heading;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
    this.bank = 0; this.vf = 0; this.vs = 0;
  }

  // Top speed grows with height so the whole planet stays explorable.
  maxSpeed() {
    return Math.min(40 + Math.max(this.agl, 0) * 0.4, 300000);
  }

  update(dt, inp, groundHeight) {
    this.ground = groundHeight;
    const vmax = this.maxSpeed();

    // speed: smooth approach to the stick target; released stick => hover
    const tf = inp.fwd >= 0 ? inp.fwd * vmax : inp.fwd * vmax * 0.35;
    const ts = inp.side * vmax * 0.35;
    const kAcc = 1 - Math.exp(-dt / (inp.fwd === 0 ? 1.3 : 0.9));
    this.vf += (tf - this.vf) * kAcc;
    this.vs += (ts - this.vs) * (1 - Math.exp(-dt / 0.8));
    if (Math.abs(this.vf) < 0.05 && inp.fwd === 0) this.vf = 0;
    if (Math.abs(this.vs) < 0.05 && inp.side === 0) this.vs = 0;

    // bank follows the stick and levels itself when released
    const tb = inp.roll * MAX_BANK;
    this.bank += (tb - this.bank) * (1 - Math.exp(-dt / 0.35));

    // coordinated turn: yaw rate = g·tan(bank)/V, capped for slow flight/hover.
    // g is scaled up at high speed so turns stay usable when flying fast and high.
    const v = Math.abs(this.vf);
    const gEff = 9.81 * Math.max(1, v / 50);
    const yawRate = Math.tan(this.bank) * Math.min(gEff / Math.max(v, 1e-3), HOVER_YAW);
    this.heading = (this.heading + yawRate * dt) % (2 * Math.PI);
    if (this.heading < 0) this.heading += 2 * Math.PI;

    this.pitch += inp.pitch * PITCH_RATE * dt;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));

    // move
    const b = this.basis();
    const d = [0, 1, 2].map((i) => (b.fwd[i] * this.vf + b.rightH[i] * this.vs) * dt);
    const p = this.pos;
    p[0] += d[0]; p[1] += d[1]; p[2] += d[2];
    const r = Math.hypot(p[0], p[1], p[2]);
    this.lon = wrapLon(Math.atan2(p[1], p[0]));
    this.lat = Math.atan2(p[2], Math.hypot(p[0], p[1]));
    this.alt = r - R;

    // don't go through the ground (or out into deep space)
    const minAlt = this.ground + MIN_AGL;
    if (this.alt < minAlt || this.alt > 2.5e7) {
      this.alt = Math.min(Math.max(this.alt, minAlt), 2.5e7);
      ecef(this.lon, this.lat, this.alt, this.pos);
    }
  }

  // Orientation vectors in world (Earth-centred) coordinates.
  basis() {
    const { e, n, u } = enu(this.lon, this.lat);
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    const hf = [0, 1, 2].map((i) => ch * n[i] + sh * e[i]);    // level forward
    const rightH = [0, 1, 2].map((i) => ch * e[i] - sh * n[i]); // level right
    const fwd = [0, 1, 2].map((i) => cp * hf[i] + sp * u[i]);
    const up0 = cross(rightH, fwd);
    const sb = Math.sin(this.bank), cb = Math.cos(this.bank);
    const right = [0, 1, 2].map((i) => cb * rightH[i] - sb * up0[i]);
    const up = [0, 1, 2].map((i) => cb * up0[i] + sb * rightH[i]);
    return { fwd, right, up, rightH, u };
  }
}
