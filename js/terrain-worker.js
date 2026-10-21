// Module worker: fetches and decodes terrain tiles off the main thread.
import { fetchTerrarium } from './terrarium.js?v=20261021205936';

self.onmessage = async (e) => {
  const { id, url } = e.data;
  try {
    const r = await fetchTerrarium(url, (w, h) => new OffscreenCanvas(w, h));
    if (r.status !== 200) {
      self.postMessage({ id, status: r.status });
      return;
    }
    self.postMessage({ id, status: 200, data: r.data, min: r.min, max: r.max }, [r.data.buffer]);
  } catch (err) {
    self.postMessage({ id, status: 0, error: String(err) });
  }
};
