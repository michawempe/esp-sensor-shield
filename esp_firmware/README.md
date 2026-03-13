# ESP32-S3 Sensor Shield

Firmware + WebSerial Workshop UI for the ilab ESP32-S3 Sensor Shield.

## Features
- Port map `A1..A6`, `B1..B5`, `C1..C4`, `D1..D4`
- Modular sensor classes in `sensors/`
- Runtime JSON stream via Serial (`{"data":{...}}`)
- Persistent config in NVS (`Preferences`)
- Single-page Workshop UI (`index.html`) with Workshop + Config editor view

## Config Input Format
Standard format per port:

```json
{
  "C1": { "type": "distance", "name": "distance1", "inMin": 30, "inMax": 1200, "outMin": 0, "outMax": 1 },
  "C2": { "type": "joystick", "name": "joystick1", "midCutoff": 100, "edgeCutoff": 100, "outMin": -1, "outMax": 1 },
  "B3": { "type": "slider", "name": "slider1", "inMin": 0, "inMax": 4095, "outMin": 0, "outMax": 1 }
}
```

Notes:
- `distance` is the 4-pin I2C VL53L0X sensor type on C-ports.
- Required library for `distance`: `VL53L0X` (Pololu).

If `name` is missing, firmware auto-generates deterministic names (`type + index`) in port order `A1..D4`.

## Runtime Output Format
Each frame:

```json
{
  "data": {
    "slider1": {
      "type": "slider",
      "port": "B3",
      "raw": 1834,
      "value": 0.42,
      "inMin": 30,
      "inMax": 3000,
      "outMin": 0,
      "outMax": 1
    }
  }
}
```

Rules:
- Output key is sensor `name`
- Always includes `type`, `port`, `value`
- `raw` is present for all sensors (for `button`/`switch` identical to `value`)
- Active parameters are echoed without wrapper

## Boot + Persistency
- Boot tries stored config from NVS
- If missing/invalid: fallback to `DefaultConfig.h` (currently `{}` = empty startup config)
- On success, device sends:

```json
{"status":"ready","config":"stored"}
```

or

```json
{"status":"ready","config":"default"}
```

After valid config apply via Serial JSON, firmware persists it and sends:

```json
{"status":"config_applied","persisted":true}
```

## Serial Input
- JSON config lines only (single line, newline terminated)
- Non-JSON input is rejected with `{"error":"unknown_input","hint":"send JSON only"}`

## Main Files
- `ilab_ESP32_S3_Sensor_Shield.ino` serial input routing + boot/persist behavior
- `config/ConfigManager.h` config parsing, defaults, sensor object creation
- `config/DefaultConfig.h` default config JSON
- `runtime/SensorManager.h` sensor lifecycle
- `output/DataPublisher.h` JSON frame output
- `sensors/*.h` sensor implementations
- `../index.html` workshop + config editor single-page UI
- `../RULES.md` project conventions
