# Flight

A simple browser flight explorer: fly anywhere on Earth over satellite imagery and real terrain.
Built with three.js, designed for touch on iPad, no build step.

## Controls

| | |
|---|---|
| **Left stick** | forward / back, slide left / right. Let go and the craft comes to a hover. |
| **Right stick** | pull back = nose up, push forward = nose down; left / right = banked, coordinated turn (turns on the spot while hovering). |
| Keyboard | `W` `S` `A` `D` for the left stick, arrow keys for the right stick. |

Top speed grows with height above the ground, so you can cruise low and slow or cross continents from high up.
The menu (☰) has quality presets, invert pitch, fly-to-coordinates and fullscreen.
The current position is kept in the address (`#lat,lon,alt,heading`), so reloading or bookmarking resumes there.

On iPad: open the page in Safari → Share → **Add to Home Screen** for a full-screen app.

## Data

- Imagery: [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) – Esri, Maxar, Earthstar Geographics, and the GIS User Community. Free use requires this attribution; see Esri's terms.
- Elevation: [Mapterhorn](https://mapterhorn.com) terrain tiles (Terrarium encoding), global to zoom 12 and higher resolution where available – [attribution](https://mapterhorn.com/attribution).

Sources and tuning live in `js/config.js`.

## Code

- `js/tiles.js` – quadtree tile streaming, terrain meshes, height lookup
- `js/flight.js` – flight model
- `js/controls.js` – touch joysticks and keyboard
- `js/main.js` – renderer, camera, sky/haze, HUD, menu
- `js/terrarium.js`, `js/terrain-worker.js` – elevation decoding off the main thread

Run locally with any static server, e.g. `python -m http.server`, then open http://localhost:8000.

Before committing changes, run `python3 tools/bump-version.py`: it stamps a new version on all script and style links, so browsers never mix old cached files with new ones.
