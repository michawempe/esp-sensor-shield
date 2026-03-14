# Web

Browser-based interface for the ESP Sensor Shield. Requires Chrome or Edge (WebSerial API).

## Pages

| Page | Path | Purpose |
|---|---|---|
| Workshop demo | `index.html` | Read sensor data in your own sketch code |
| Config editor | `admin/index.html` | Configure sensors per port, load/send presets |

Serve locally with any static file server, e.g. VS Code Live Server Extension.

---

## Workshop Page (`index.html`)

The page connects to the ESP via WebSerial and keeps `window.sensors` up to date.
A startup overlay with a **Connect** button appears automatically.

### Reading sensor data

Import and use `readSerialAndUpdate` in your script:

```js
import { readSerialAndUpdate } from "./js/render.js";

readSerialAndUpdate((sensors) => {
  const val = sensors.slider1?.value ?? 0;
  console.log(val);
});
```

The callback fires on every incoming data frame (~5 Hz).
`readSerialAndUpdate` returns a teardown function to unsubscribe.

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