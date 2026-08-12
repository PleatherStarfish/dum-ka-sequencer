# App icon

`icon.svg` is the source of truth — a minimalist **astrolabe** on the Solarized
Astral indigo plate with parchment linework: suspension ring and stub (the
throne), graduated mater limb, dotted tympan equator, the rete's off-center
ecliptic ring, two star nodes, and the magenta alidade over its axis pin. The
design is deliberately name-agnostic (no wordmark glyphs), so it survives a
product rename; magenta is the palette's hero accent, not a letterform.

Regenerate the rasters after editing the SVG (Chromium renders each size
natively, then `iconutil` packs the `.icns`):

1. Render `icon.svg` at 16/32/64/128/256/512/1024 px (transparent background —
   e.g. Playwright `locator("svg").screenshot({ omitBackground: true })`,
   scaling the root `width`/`height`).
2. `32x32.png`, `128x128.png`, `128x128@2x.png` (=256), `icon.png` (=1024).
3. Build `icon.icns`: map renders into an `icon.iconset/` (16..512@2x) and run
   `iconutil -c icns icon.iconset -o icon.icns`.
