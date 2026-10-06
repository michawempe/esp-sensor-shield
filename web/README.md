# Web

Browser-based interface for the ESP Sensor Shield. Requires Chrome or Edge (WebSerial API).

## Pages

| Page | Path | Purpose |
|---|---|---|
| Frontend | `index.html` | Empty page with startup popup for board connection and config editor |
| Sensor test | `sensortest/index.html` | Large live circles, raw values, history and connection metrics |
| Config editor | `admin/index.html` | Configure sensors per port, load/send presets |

Serve locally with any static file server, e.g. VS Code Live Server Extension.

---

## Frontend (`index.html`)

The empty starting page loads `js/main.js`. Its startup popup links to the config
editor and connects the board. After connecting, the popup closes and sensor data
is available through `window.sensors` and the events described below.

## Sensor Test (`sensortest/index.html`)

The page connects to the ESP via WebSerial and keeps `window.sensors` up to date.
Use **Board verbinden** in the header to connect; the same button disconnects.
The page creates a card for every configured sensor, including multiple sensors
of the same type. Before connecting, it shows static previews of the supported
types.

- Slider, light, magnet and sound control the circle diameter using the configured
  output range. Distance uses the input range: nearer objects make a larger circle.
- Joystick moves a dot in two dimensions; positive Y points up.
- Encoder rotates a marker according to `fullRotation`; its readout keeps the full value.
- Button/switch are active at 0 (pull-up); touch is active at 1.
- **Vergrößern** expands a card across the page for closer inspection.
- Raw values and a five-second trace help identify small changes. Joystick traces
  show X in black and Y in gray.
- Packet rate, display frame rate and the largest recent packet interval are shown
  at the top. After 500 ms without a packet, values are marked stale. Invalid sensor
  readings are also marked explicitly.

Rendering uses `requestAnimationFrame` and the latest received values, with no
extra interpolation. Histories repaint at most ten times per second. The page
loads `sensortest/js/sensor-test.js`. Its CSS, JavaScript and tests live inside
`sensortest/`; the serial helpers in `shared/` and the existing admin font are reused.

### Reading sensor data

Import and use `readSerialAndUpdate` in your script:

```js
import { readSerialAndUpdate } from "./js/render.js";

readSerialAndUpdate((sensors) => {
  const val = sensors.slider1?.value ?? 0;
  console.log(val);
});
```

The callback fires on every incoming data frame. Firmware targets 50 Hz,
including the tested mixed configuration with sound and distance. Each packet
contains the latest values; sound is sampled continuously and distance is read
when a new measurement is ready. Configuration changes and USB backpressure
can interrupt output.
The demo console log is limited to 10 entries/s; sensor state and events still
receive every frame.
`readSerialAndUpdate` returns a teardown function to unsubscribe.

### Visual updates at higher rates

Keep incoming-frame callbacks short. For animation, read the latest sensor state
once per display frame:

```js
import { getSensors } from "./js/render.js";

function draw() {
  const value = getSensors().slider1?.value ?? 0;
  // Update your visualization using value.
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
```

This avoids running a full visual update for each packet when several packets
arrive together. Input events still include every received frame.

### Sensor data structure

```js
window.sensors = {
  slider1: {
    type: "slider",
    port: "B1",
    raw: 2048,
    value: 0.5,        // mapped output value
    inMin: 0, inMax: 4095, outMin: 0, outMax: 1
  },
  btn: {
    type: "button",
    port: "A1",
    raw: 1,
    value: 1
  },
  stick: {
    type: "joystick",
    port: "C2",
    raw:   { x: 120, y: -340 },
    value: { x: 0.23, y: -0.67 }
  },
  dist: {
    type: "distance",
    port: "C1",
    raw: 430,          // mm, null on timeout
    value: 0.38
  }
}
```

### Events

| Event | Detail |
|---|---|
| `sensors-updated` | fired on `window` after each frame; `event.detail.frame` = raw parsed object |
| `sensor-frame` | same frame, separate event name |

```js
window.addEventListener("sensors-updated", (e) => {
  console.log(e.detail.frame);
});
```

## Config Editor (`admin/index.html`)

1. Click **Connect** — select the ESP32 USB port
2. Each port row shows its live sensor value once connected
3. Click **Edit** on a port to change sensor type and parameters
   → Changes are sent to the ESP immediately on blur/Enter
4. **Load Preset** — pick a preset file from `admin/presets/`, sends config to ESP
5. **Save** — downloads the current config as a `.json` file
   → Copy the file into `admin/presets/` to make it available in the dropdown

---
## Test the visualization

```sh
node sensortest/tests/sensor-visuals.mjs
```

For the Chrome integration test, serve `web` on localhost port 8765 and install
`playwright-core` in a temporary directory. Run `sensortest/tests/sensor-page.mjs` with
`ILAB_PLAYWRIGHT_MODULE` pointing to that installation's `index.mjs` (or install
the module locally). Optional settings: `ILAB_TEST_URL`, `ILAB_SCREENSHOT_DIR`.
The test uses a simulated Web Serial port with recorded hardware data at 50 Hz;
it does not claim to test the browser's real USB permission dialog.
