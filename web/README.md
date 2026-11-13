# Web

Use Chrome or Edge with Web Serial. Usually, the pages are opened with the
**Live Server** extension in VS Code:

1. Open this `web/` folder in VS Code.
2. Right-click `index.html` and choose **Open with Live Server**.
3. Open the served page in Chrome or Edge if a different browser starts.

The page addresses below are relative to the served `web/` folder. Use the host
and port shown by Live Server. If you open a parent folder in VS Code instead,
the URL may also include the path to `web/`.

Alternatively, start a server from a terminal in this `web/` folder:

```sh
python3 -m http.server 8765
```

| Page | Path | Purpose |
|---|---|---|
| Frontend | `index.html` | Empty page with connection popup and config link |
| Config editor | `admin/` | Assign sensors, edit settings, load and save presets |
| Sensor test | `sensortest/` | Live circles, raw values, history and rates |

With the terminal command above, open [localhost:8765](http://localhost:8765/),
[the config editor](http://localhost:8765/admin/) or
[the sensor test](http://localhost:8765/sensortest/).

Only one page or Serial monitor can use the board at a time. Disconnect before
switching pages.

## Configuration

Connect the board and edit a port. Text and number changes are sent when you
press Enter or leave a field; dropdown changes are sent immediately. Each update
replaces the complete sensor configuration and is saved on the board.
Loading a preset also sends it to the connected board. Presets live in
`admin/presets/`; saving downloads a JSON file without adding it to that folder.
See the [firmware README](../esp_firmware/README.md) for sensor parameters.

## Your own page

`index.html` loads `js/main.js`, which handles the popup and connection.
After connecting, sensor readings are available in `window.sensors`:

```js
import { readSerialAndUpdate } from "./js/render.js";

const unsubscribe = readSerialAndUpdate((sensors) => {
  const position = sensors.slider1?.value;
  if (position == null) return;
  // Use position here.
});
```

The callback runs on each received data packet; normal firmware targets 50
packets per second. This is the packet rate, not every sensor's sample rate or
the browser's display FPS. Configuration changes and USB backpressure can cause
pauses. Call `unsubscribe()` to stop listening. For animation, use
`requestAnimationFrame` and read the latest state with `getSensors()` from the
same module.

## Sensor test

Each sensor has a circle and a five-second history. Click a card's expand button
for more detail. Missing readings are marked; packet rate and display FPS are
shown separately. Rendering adds no smoothing.

Its CSS and JavaScript live in `sensortest/`. Serial helpers in `shared/`
and the font in `admin/font/` are shared with the other pages.

Automated development tests are kept in
[`platformio/diagnostics/web-sensortest/`](../platformio/diagnostics/web-sensortest/).
They are not required to use the website. See the
[diagnostics README](../platformio/diagnostics/README.md) for test commands.
