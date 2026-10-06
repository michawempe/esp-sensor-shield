# Web

Use Chrome or Edge with Web Serial. From this folder:

```sh
python3 -m http.server 8765
```

| Page | URL | Purpose |
|---|---|---|
| Frontend | [localhost:8765](http://localhost:8765/) | Empty page with connection popup and config link |
| Config editor | [/admin/](http://localhost:8765/admin/) | Assign sensors, edit settings, load and save presets |
| Sensor test | [/sensortest/](http://localhost:8765/sensortest/) | Live circles, raw values, history and rates |

Only one page or Serial monitor can use the board at a time. Disconnect before
switching pages.

## Configuration

Connect the board and edit a port. Changes are sent when you press Enter or leave
a field. Presets live in `admin/presets/`; saving downloads a JSON file.
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

The callback runs on each data packet, normally 50 times per second. Call
`unsubscribe()` to stop listening. For animation, use `requestAnimationFrame`
and read the latest state with `getSensors()` from the same module.

## Sensor test

Each sensor has a circle and a five-second history. Click a card's expand button
for more detail. Missing readings are marked; packet rate and display FPS are
shown separately. Rendering adds no smoothing.

Its CSS, JavaScript and tests live in `sensortest/`. Serial helpers in `shared/`
and the font in `admin/font/` are shared with the other pages.

From this folder, run `node sensortest/tests/sensor-visuals.mjs` for mapping tests.
The browser test is `sensortest/tests/sensor-page.mjs`; it needs local Chrome,
the server above, and `playwright-core`. Set `ILAB_PLAYWRIGHT_MODULE` to the
package's `index.mjs` if installed elsewhere. It simulates Serial input;
[results and limits](sensortest/tests/RESULT.md) are recorded separately.
