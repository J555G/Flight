// Camera pose helpers shared by flight mode and map mode.
// A "view" is a world position plus forward/right/up unit vectors (Earth-centred frame).

import { R, enu } from './geo.js?v=20261021205936';

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// Rodrigues rotation of vector v around unit axis k by angle.
export function rotate(v, k, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

// Heading (from north, clockwise) and pitch of a forward vector at a position.
export function headingPitch(pos, fwd) {
  const lon = Math.atan2(pos[1], pos[0]);
  const lat = Math.atan2(pos[2], Math.hypot(pos[0], pos[1]));
  const { e, n, u } = enu(lon, lat);
  const pitch = Math.asin(Math.max(-1, Math.min(1, dot(fwd, u))));
  const heading = Math.atan2(dot(fwd, e), dot(fwd, n));
  return { heading: (heading + 2 * Math.PI) % (2 * Math.PI), pitch };
}

// Ray from the camera through a screen point; nx, ny in -1..1 (y up).
export function screenRay(view, nx, ny, vfov, aspect) {
  const ty = Math.tan(vfov / 2), tx = ty * aspect;
  return norm([0, 1, 2].map((i) => view.fwd[i] + view.right[i] * nx * tx + view.up[i] * ny * ty));
}

// First hit of a ray with a sphere of radius R + h around the Earth's centre.
export function hitSphere(origin, dir, h) {
  const r = R + h;
  const b = dot(origin, dir);
  const c = dot(origin, origin) - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;
  return add(origin, dir, t);
}
