# Web Refactor Plan

## Current layout (scan summary)
- `/web/index.html` loads JS from `/web/admin/js/*` plus inline logic for rendering sensor values.
- `/web/admin/index.html` loads 5 JS files:
  - `shared-core.js`, `shared-serial.js`, `shared-presets.js` (global `window.*` singletons)
  - `configpage-editor.js`, `configpage.js` (admin UI logic)
- `index-app.js` (in `/web/admin/js`) is actually the website app logic + UI (toolbar + sensor data probe), and is reused by `/web/index.html`.
- Shared utilities (serial, presets, core config transforms) are mixed with app-specific code and exported via globals.

## Goals
1. Keep website at `/web/index.html` and admin at `/web/admin/index.html`.
2. Separate logic for website vs admin.
3. Extract shared code to a shared location.
4. Make `/web/index.html` load a single JS entry (ES module) that can import shared helpers.
5. Move to a module-only design (remove globals like `window.ConfigPage*`, `window.SENSORS`, `window.getValue`, and per-sensor globals).

## Proposed target structure
- `/web/index.html`
- `/web/admin/index.html`
- `/web/js/`
  - `main.js` (website entry module; single script include)
  - `render.js` (website-only render helpers; imported by `main.js`)
- `/web/admin/js/`
  - `main.js` (admin entry module)
  - `editor.js` (admin-only editor logic; module)
- `/web/shared/`
  - `core.js` (ports/types/preset mapping)
  - `serial.js` (WebSerial client + AckTracker)
  - `presets.js` (preset listing/loading utils)
  - `dom.js` (optional tiny helpers if needed)

Notes:
- Move `index-app.js` functionality to `/web/js/index.js`.
- Move `index-app.js` functionality to `/web/js/main.js`.
- Move `configpage.js` to `/web/admin/js/main.js`.
- Move `configpage-editor.js` to `/web/admin/js/editor.js`.
- Convert shared files from globals to ES module exports.
- Keep admin CSS/fonts/presets paths intact.

## Refactor steps
1. Create `/web/shared/*.js` modules by splitting existing `shared-*` files into ES module exports.
2. Convert `configpage-editor.js` to module (`editor.js`) importing shared helpers; export `createEditor()`.
3. Convert `configpage.js` to module (`admin.js`) importing shared + editor modules; keep admin-only logic here.
4. Convert `index-app.js` to module (`/web/js/index.js`) importing shared + presets + serial modules, plus any website-only helpers.
5. Remove `window.*` globals and expose any needed hooks via module exports or DOM events only.
6. Update `/web/index.html` to a single `<script type="module" src="js/main.js"></script>` in the `<head>` and remove inline script.
7. Update `/web/admin/index.html` to a single `<script type="module" src="js/main.js"></script>` in the `<head>` (or keep multiple modules if preferred, but single entry is cleaner).
8. Verify relative paths for presets, fonts, and admin links still work after moves.
9. Manual smoke test:
   - `/web/index.html`: connect, load preset, sensor values update.
   - `/web/admin/index.html`: connect, edit sensor config, presets load/save.

## Open questions (confirm before edits)
- Do you want ES modules for admin too (recommended)?
- Any bundler restrictions, or should this remain “no build step” static files?
- Should the website toolbar UI remain, or move it into `/web/index.html` markup instead of injected HTML?
