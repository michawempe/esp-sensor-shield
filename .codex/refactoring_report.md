# Refactor Report

## Summary
- Split frontend into ES modules with shared utilities in `web/shared/`.
- Moved website logic to `web/js/main.js` and inline render logic to `web/js/render.js`.
- Moved admin logic to `web/admin/js/main.js` and editor logic to `web/admin/js/editor.js`.
- Removed all `window.*` globals and replaced them with module-local state + `sensor-frame` events.
- Updated both HTML files to load a single `main.js` from the `<head>`.
- Removed legacy script files under `web/admin/js/`.

## New/Updated Files
- `web/shared/core.js`
- `web/shared/serial.js`
- `web/shared/presets.js`
- `web/js/main.js`
- `web/js/render.js`
- `web/admin/js/main.js`
- `web/admin/js/editor.js`
- `web/index.html`
- `web/admin/index.html`

## Removed Files
- `web/admin/js/configpage-editor.js`
- `web/admin/js/configpage.js`
- `web/admin/js/index-app.js`
- `web/admin/js/shared-core.js`
- `web/admin/js/shared-serial.js`
- `web/admin/js/shared-presets.js`

## Notes
- The website still dispatches `sensor-frame` events on `window` for render updates, but no data is stored on `window`.
- The website toolbar UI remains injected by JS.
- Preset handling and WebSerial logic live in `web/shared/` and are imported where needed.

## Suggested Manual Checks
1. Open `/web/index.html`, connect, load preset, verify sensor values update.
2. Open `/web/admin/index.html`, connect, edit sensors, load/save presets.
