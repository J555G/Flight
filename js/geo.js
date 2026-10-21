// Spherical Earth helpers. World coordinates are Earth-centred (ECEF-like):
// x towards lon 0 / lat 0, y towards lon 90°E, z towards the North Pole. Metres.

export const R = 6371008.8;
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const MAX_MERC_LAT = Math.atan(Math.sinh(Math.PI)); // ~85.05°

export function tile2lon(x, z) {
  return (x / 2 ** z) * 2 * Math.PI - Math.PI;
}

export function tile2lat(y, z) {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z)));
}

// Fractional tile coordinates of a point at zoom z.
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const la = Math.max(-MAX_MERC_LAT, Math.min(MAX_MERC_LAT, lat));
  const x = ((lon + Math.PI) / (2 * Math.PI)) * n;
  const y = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n;
  return [x, y];
}

export function ecef(lon, lat, h, out) {
  const r = R + h;
  const cl = Math.cos(lat);
  out[0] = r * cl * Math.cos(lon);
  out[1] = r * cl * Math.sin(lon);
  out[2] = r * Math.sin(lat);
  return out;
}

// Local East / North / Up unit vectors at lon/lat.
export function enu(lon, lat) {
  const sl = Math.sin(lon), cl = Math.cos(lon);
  const sp = Math.sin(lat), cp = Math.cos(lat);
  return {
    e: [-sl, cl, 0],
    n: [-sp * cl, -sp * sl, cp],
    u: [cp * cl, cp * sl, sp],
  };
}

export function wrapLon(lon) {
  while (lon > Math.PI) lon -= 2 * Math.PI;
  while (lon < -Math.PI) lon += 2 * Math.PI;
  return lon;
}
