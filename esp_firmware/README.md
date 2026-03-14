# Firmware

Arduino sketch for the ilab ESP32-S3 Sensor Shield.
Reads sensors, streams JSON over USB Serial at ~5 Hz, persists config in NVS.

## Flash

Open `ilab_ESP32_S3_Sensor_Shield/ilab_ESP32_S3_Sensor_Shield.ino` in Arduino IDE.
Required libraries: `ArduinoJson`, `VL53L0X` (Pololu).
Board: `ESP32S3 Dev Module`, baud: `115200`.

---

## Configuring Sensors

Send a single-line JSON object over Serial (newline-terminated). Each key is a port ID, each value describes one sensor:

```json
{"B1":{"type":"slider","name":"vol","inMin":0,"inMax":4095,"outMin":0,"outMax":1},"A1":{"type":"button"},"C1":{"type":"encoder","fullRotation":360}}
```

On success the firmware replies:
```json
{"status":"config_applied","persisted":true}
```

The config is saved to NVS and restored on next boot.

To erase the stored config, send: `{}`

---

## Sensor Types & Parameters

### A-Ports (2-pin digital)

| Type | Parameters |
|---|---|---|
| `button` | — |
| `switch` | — |

`value` is 0 or 1.

### B-Ports (3-pin analog)

| Type | Parameters | Example |
|---|---|---|
| `slider` | `inMin`, `inMax`, `outMin`, `outMax` | 0 / 4095 / 0 / 1 |
| `light` | `inMin`, `inMax`, `outMin`, `outMax` | 0 / 4095 / 0 / 1 |
| `sound` | `inMin`, `inMax`, `outMin`, `outMax` | 0 / 2000 / 0 / 1 |
| `magnet` | `inMin`, `inMax`, `outMin`, `outMax` | 0 / 4095 / 0 / 1 |

`inMin`/`inMax` define the raw ADC range (0–4095). `outMin`/`outMax` define the mapped output range.

### C-Ports (4-pin)

| Type | Parameters | Example |
|---|---|---|
| `encoder` | `fullRotation`, `modulo` | 360 / false |
| `joystick` | `midCutoff`, `edgeCutoff`, `outMin`, `outMax` | 100 / 100 / -1 / 1 |
| `distance` | `inMin`, `inMax`, `outMin`, `outMax` | 30 / 1200 / 0 / 1 |

- `encoder`: `fullRotation` = value when rotated 360°. `modulo: true` wraps value at `fullRotation`.
- `joystick`: `midCutoff` = deadzone around center (ADC 2048). `value` is `{"x":..., "y":...}`.
- `distance`: `inMin`/`inMax` in mm. Max 2 distance sensors simultaneously.

### D-Ports (touch)

| Type | Parameters | Default |
|---|---|---|
| `touch` | `threshold` | 40000 |

`value` is 0 or 1. Lower threshold → more sensitive.

---

## Name

Every sensor gets a `name` used as the JSON key in the data frame.
If omitted, names are auto-generated in port order: `slider1`, `button2`, etc.

```json
{"B1": {"type": "slider", "name": "mySlider"}}
```

---

## Serial Output Format

Frames are emitted every 200 ms:

```json
{"data":{"mySlider":{"type":"slider","port":"B1","raw":2048,"value":0.5,"inMin":0,"inMax":4095,"outMin":0,"outMax":1}}}
```

- `raw`: unprocessed sensor reading
- `value`: mapped output value
- For `joystick`: `value` and `raw` are objects `{"x":..., "y":...}`
- For `distance`: `raw` and `value` are `null` on timeout or out-of-range

---

## Boot Behavior

On startup the firmware:
1. Loads stored config from NVS → applies it
2. If none or invalid → falls back to `DefaultConfig.h` (default: `{}`, no sensors)

Startup message:
```json
{"status":"ready","config":"stored"}   // or "default"
```

---

## Adding a New Sensor Type

1. Create `sensors/MySensor.h` — extend `SensorBase`, implement `begin()`, `read()`, `appendJson()`
2. Include it in `config/ConfigManager.h`
3. Add a `if (type == "mytype")` branch in `ConfigManager::createSensor()` — check port type, read parameters, return `new MySensor(...)`

Port type constraints:
- `PORT_2P` → A-ports (1 digital pin)
- `PORT_3P` → B-ports (1 analog pin)
- `PORT_4P` → C-ports (2 pins: SCL=`p.pins[0]`, SDA=`p.pins[1]`)
- `PORT_TOUCH` → D-ports (1 touch pin)
