// Data sources and tuning. Change URLs here if a provider moves.

export const IMAGERY_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const IMAGERY_MAX_Z = 17;

export const TERRAIN_URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
export const TERRAIN_BASE_MAX_Z = 12; // global coverage
export const TERRAIN_TRY_MAX_Z = 15;  // regional high-res, falls back if missing

export const QUALITY = {
  low:    { pixelRatio: 1.0, lod: 1.4, maxTiles: 160, antialias: false },
  medium: { pixelRatio: 1.5, lod: 2.0, maxTiles: 240, antialias: false },
  high:   { pixelRatio: 2.0, lod: 2.6, maxTiles: 340, antialias: true },
};

// Start above Zermatt, looking towards the Matterhorn.
export const START = { lat: 46.035, lon: 7.70, alt: 3800, heading: 215, pitch: 0 };

// Sky: Michelangelo, Sistine Chapel (Wikimedia Commons).
// Ceiling: "CAPPELLA SISTINA Ceiling.jpg" (CC BY-SA 3.0); Last Judgement: public domain.
export const SKY_CEILING_URL = 'https://upload.wikimedia.org/wikipedia/commons/0/07/CAPPELLA_SISTINA_Ceiling.jpg';
export const SKY_WALL_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Last_Judgement_%28Michelangelo%29.jpg/1920px-Last_Judgement_%28Michelangelo%29.jpg';

export function fillUrl(tpl, z, x, y) {
  return tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}
