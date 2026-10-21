// Decodes a Terrarium-encoded elevation image into a TN x TN float grid.
// height = R*256 + G + B/256 - 32768  (metres)

export const TN = 257;

export function decodeTerrarium(px, W, H) {
  const out = new Float32Array(TN * TN);
  let min = Infinity, max = -Infinity;
  const sx = (W - 1) / (TN - 1);
  const sy = (H - 1) / (TN - 1);
  const h = (i, j) => {
    const k = (j * W + i) * 4;
    return px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768;
  };
  for (let j = 0; j < TN; j++) {
    const fy = j * sy;
    const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, H - 1), ty = fy - y0;
    for (let i = 0; i < TN; i++) {
      const fx = i * sx;
      const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, W - 1), tx = fx - x0;
      const a = h(x0, y0) * (1 - tx) + h(x1, y0) * tx;
      const b = h(x0, y1) * (1 - tx) + h(x1, y1) * tx;
      const v = a * (1 - ty) + b * ty;
      out[j * TN + i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { data: out, min, max };
}

export async function fetchTerrarium(url, makeCanvas) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) return { status: res.status };
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const W = bmp.width, H = bmp.height;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  const px = ctx.getImageData(0, 0, W, H).data;
  return { status: 200, ...decodeTerrarium(px, W, H) };
}
