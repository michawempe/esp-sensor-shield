# Project Report

## What This Project Is About
This project is a small, static front-end for an ESP32-S3 sensor board workshop. It provides:
- A main “workshop” page that loads shared WebSerial logic and a toolbar UI for connecting to the ESP32 and loading presets.
- A dedicated configuration page for editing per-port sensor types and parameters, sending the config over WebSerial, and saving/loading presets.
- A minimal default demo page that renders live sensor values on screen.

The browser connects to the board using the WebSerial API, receives JSON “frame” data from the device, and can send JSON config payloads back to it.

## Structure
Top-level files:
- `index.html`: entry point for the workshop UI that injects a toolbar and connects to the board.
- `default.html`: simple diagnostic page that shows live sensor values in the DOM.
- `codex/report.md`: this report.

`config/`:
- `index.html`: standalone configuration UI.
- `css/style.css`: styles for the configuration UI.
- `js/configpage.js`: main config page controller (serial connect, presets, editor wiring).
- `js/configpage-editor.js`: editor module that builds the per-port rows, handles edits, and builds payloads.
- `js/shared-core.js`: shared constants and helpers (port ordering, allowed sensor types, preset parsing, USB filters).
- `js/shared-serial.js`: WebSerial client + ack tracking for config updates.
- `js/shared-presets.js`: preset discovery and loading helpers.
- `presets/`: example preset JSON files (`default.json`, `empty.json`, `testname.json`).
- `font/GT-Haptik-Regular-Trial.otf`: font used in the UI.

## Wiring And Data Flow
### Page Composition
- `index.html` and `default.html` load the shared modules in this order:
  `config/js/shared-core.js` → `config/js/shared-serial.js` → `config/js/shared-presets.js` → `config/js/index-app.js`.
- `config/index.html` loads:
  `config/js/shared-core.js` → `config/js/shared-serial.js` → `config/js/shared-presets.js` → `config/js/configpage-editor.js` → `config/js/configpage.js` plus `config/css/style.css`.

### WebSerial Integration
- `config/js/shared-serial.js` provides `SerialJsonClient` (connect/read/write) and `AckTracker` (wait for “config_applied” or error responses).
- `config/js/shared-core.js` restricts ports to the ESP32-S3 JTAG/Serial USB interface and blocks the “Single Serial” interface via VID/PID filters.

### Runtime Sensor Data
- The device sends newline-delimited JSON frames.
- When a frame includes `data`, `config/js/index-app.js` updates `window.SENSORS`, dispatches a `sensor-frame` event, and exposes values via `window.getValue(name)`.
- `default.html` listens for `sensor-frame` and renders `button1`, `slider1`, `distance1`, `joystick1`, and `touch1` values.

### Configuration Editing
- `config/js/configpage-editor.js` builds per-port rows for ports `A1..A6`, `B1..B5`, `C1..C4`, `D1..D4`.
- Allowed sensor types are per-port-group (A: button/switch, B: distance/magnet/slider/sound/light, C: encoder/joystick, D: touch).
- Editing a port sends an updated payload; the editor can sync back defaults after the board replies.

### Presets
- Presets are JSON configs keyed by port (`A1`, `B2`, etc.).
- `config/js/shared-presets.js` discovers preset JSON files by fetching the `config/presets/` directory and parsing directory listings (fallback to default list).
- The config page can load presets from the project `config/presets/` folder or from a user-selected directory via the File System Access API, and can save a “current” preset to that folder.
- The workshop toolbar (from `config/js/index-app.js`) also loads and applies presets over serial.

## How It Fits Together (At A Glance)
- Shared modules provide the WebSerial stack, port/type rules, and preset loading.
- `config/js/index-app.js` is a lightweight controller/UI for connection + preset application.
- `config/js/configpage.js` is the full-featured editor that uses `config/js/configpage-editor.js` for the per-port UI and payload construction.
- Both UIs rely on the board sending JSON frames and accepting JSON config payloads.
