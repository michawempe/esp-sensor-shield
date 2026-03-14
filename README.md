# ilab ESP32-S3 Sensor Shield

An ESP32-S3 sensor integration system for physical computing workshops. Sensors are connected to a custom shield, configured via JSON over USB Serial, and stream live data.

## Structure

```
esp_firmware/   Arduino firmware — sensor reading, Serial I/O, config persistence
web/            Browser UI — config editor and workshop demo page
```

## Quick Start

1. Flash the firmware via Arduino IDE
   → `esp_firmware/ilab_ESP32_S3_Sensor_Shield/`

2. Open `web/admin/index.html` in Chrome or Edge
   → Connect via USB, configure which sensor is on which port, load/send a preset

3. Open `web/index.html` and click Connect
   → `window.sensors` is updated live; write your own sketch code in the page

See `esp_firmware/README.md` for the full config format and sensor parameters.
See `web/README.md` for how to read sensor data in your own page.
