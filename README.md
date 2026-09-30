# ilab ESP32-S3 Sensor Shield

An ESP32-S3 sensor integration system for physical computing workshops. Sensors are connected to a custom shield, configured via JSON over USB Serial, and stream live data.

## Structure

```
esp_firmware/   Arduino firmware — sensor reading, Serial I/O, config persistence
platformio/     Reproducible firmware build/upload — pinned dependencies, German guide
web/            Browser UI — config editor and workshop demo page
```

## Quick Start

1. Flash the firmware via PlatformIO IDE
   → [Setup and upload guide (Deutsch)](platformio/README.md)
   → Open `platformio/` as the PlatformIO project; the original sketch stays in `esp_firmware/`.
   Arduino IDE is also supported; see [firmware documentation](esp_firmware/README.md).

2. Open `web/admin/index.html` in Chrome or Edge
   → Connect via USB, configure which sensor is on which port, load/send a preset

3. Open `web/index.html` and click Connect
   → `window.sensors` is updated live; write your own sketch code in the page

See `esp_firmware/README.md` for the full config format and sensor parameters.
See `web/README.md` for how to read sensor data in your own page.

## Sensorwerte glätten

In der Config Page lässt sich pro Slider, Licht-, Magnet-, Sound-, Joystick- und
Abstandssensor **Glättung (ms)** einstellen. `0` schaltet die zusätzliche Glättung
aus (Standard). Mit `100` anfangen: größere Werte beruhigen Schwankungen stärker,
machen die Reaktion aber träger. Erlaubt sind ganze Zahlen von `0` bis `10000`.
Die Einstellung wird wie die übrige Sensorkonfiguration auf dem ESP gespeichert
und beim Export eines Presets übernommen. Dafür die aktualisierte Firmware aufspielen.

Beispiel eines Konfigurationseintrags:

```json
{"type":"slider","name":"slider1","smoothingMs":100}
```

Der ESP glättet `value`; `raw` behält seine bisherige Bedeutung. Beide Joystickachsen
werden getrennt mit derselben Einstellung geglättet. Beim Sound wird der ermittelte
Lautstärkepegel geglättet. Beim Abstand bleibt der bestehende Medianfilter zusätzlich
aktiv; ungültige Messungen bleiben `null` und setzen die zusätzliche Glättung zurück.
Taster, Schalter, Touch und Encoder erhalten dieses Feld nicht.

Technisch arbeitet ein Tiefpass erster Ordnung mit der tatsächlich vergangenen Zeit:
`alpha = dt / (smoothingMs + dt)`, `value += alpha * (input - value)`.
Das braucht pro Achse nur einen gespeicherten Wert, einen Zeitstempel und wenige
Rechenoperationen, ohne Messwertpuffer oder zusätzliche Wartezeit. Die erste Messung
wird direkt übernommen. `smoothingMs` ist eine Zeitkonstante, kein Warteintervall und
kein festes Durchschnittsfenster. Bei kurzen Messintervallen sind nach ungefähr
dieser Zeit 63 % einer sprunghaften Änderung übernommen; nach etwa der dreifachen
Zeit 95 %. Langsamere Sensorabfragen begrenzen die zeitliche Auflösung.
