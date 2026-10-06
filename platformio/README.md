# PlatformIO

Builds the sketch in `../esp_firmware` for the Waveshare ESP32-S3-DEV-KIT-N8R8.
Keep both folders together.

## Build and upload

Install PlatformIO IDE in VS Code, then open this folder as the project.
Use **Project Tasks → sensor-shield → Build / Upload**, or run these commands
in a PlatformIO terminal from this folder:

```sh
pio run
pio device list
pio run -t upload
pio device monitor --port YOUR_PORT
```

Close the browser's Serial connection and any monitor before uploading.
The upload script selects the native ESP32-S3 USB port (`303A:1001`) when one
board is attached. To select it manually, add `--upload-port YOUR_PORT`.
Use the native port rather than the board's CH343 port (`1A86:55D3`).

Upload and monitor use 115200 baud. A normal upload preserves sensor settings.
After uploading, close the monitor and use the [web config editor](../web/README.md).

If upload fails, hold **BOOT**, press and release **RESET**, then release
**BOOT** and retry. Press **RESET** if the board stays in the bootloader.

## Build settings

[platformio.ini](platformio.ini) pins Arduino-ESP32 3.3.7 via pioarduino 55.03.37,
ArduinoJson 7.4.2 and Pololu VL53L0X 1.3.1. It uses 8 MB QIO flash at 80 MHz,
TinyUSB with CDC enabled, and no PSRAM. Uploads use the ROM bootloader with
`--no-stub` to avoid the RAM flasher errors observed on this board.

`src/main.cpp` includes the original sketch. Add library includes there and pin
new dependencies in `lib_deps`. Functions must be declared before use.

## Diagnostics

- `sensor-shield`: normal firmware, 50 Hz output.
- `sensor-shield-diagnostics`: distance sensor logs.
- `sensor-shield-stress`: temporary rate/config commands and timing counters.

Build another environment with `pio run -e NAME`. Restore `sensor-shield` after
hardware tests. See [tests and results](diagnostics/README.md) for commands and
known fixes. For `null` readings, check the sensor's `error` and `port` fields.
