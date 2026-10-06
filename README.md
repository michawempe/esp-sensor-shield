# ilab ESP32-S3 Sensor Shield

Connect sensors to the shield, configure them in the browser, and read their
values over USB Serial at 50 Hz.

## Getting started

1. Build and upload using [PlatformIO](platformio/README.md).
2. Serve the website from the repository root:

   ```sh
   python3 -m http.server 8765 --directory web
   ```

3. Open [the config editor](http://localhost:8765/admin/) in Chrome or Edge.
   Connect the board and assign your sensors.
4. Disconnect before switching to [your page](http://localhost:8765/) or the
   [sensor test](http://localhost:8765/sensortest/).

## Folders

- [esp_firmware/](esp_firmware/README.md): sensor code, configuration and Serial format.
- [platformio/](platformio/README.md): build and upload settings.
- [web/](web/README.md): empty starting page, config editor and sensor test.
- [platformio/diagnostics/](platformio/diagnostics/README.md): tests and results.
