# Firmware mit PlatformIO bauen und hochladen

Dieses Projekt baut die Firmware aus [`../esp_firmware`](../esp_firmware) mit festgelegten Versionen für das [Waveshare ESP32-S3-DEV-KIT-N8R8](https://docs.waveshare.com/ESP32-S3-DEV-KIT-N8R8). Es verwendet direkt den vorhandenen Sketch; Änderungen an der Firmware gelten für beide IDEs.

## 1. Einrichten

1. [Visual Studio Code](https://code.visualstudio.com/) installieren.
2. In VS Code die Erweiterung **PlatformIO IDE** von PlatformIO installieren. Die Ersteinrichtung abwarten und VS Code bei Bedarf neu starten.
3. Das gesamte Repository herunterladen oder klonen. Die Ordner `platformio` und `esp_firmware` müssen nebeneinander liegen bleiben.
4. In PlatformIO Home → **Open Project** den Ordner **`esp-sensor-shield/platformio`** öffnen. Kein neues Boardprojekt anlegen und den Sketch nicht importieren.
5. Unter PlatformIO → **Project Tasks → sensor-shield → General → Build** bauen. Beim ersten Mal werden Compiler, Arduino-Core und Bibliotheken aus dem Internet geladen; das kann mehrere Minuten dauern.

Arduino IDE und manuell installierte Arduino-Bibliotheken werden für diesen Ablauf nicht benötigt.

## 2. Hochladen

1. Das Waveshare ESP32-S3-DEV-KIT-N8R8 mit einem USB-Datenkabel anschließen. Die Konfiguration ist für diese Variante mit **8 MB Flash** vorgesehen. Die vorhandenen 8 MB OPI-PSRAM bleiben wie im ursprünglichen Arduino-Setup deaktiviert, weil diese Firmware sie nicht benötigt.
2. Arduino Serial Monitor, andere Terminalprogramme und die USB-Verbindung der Browser-Web-App schließen. Nur ein Programm kann den Port verwenden.
3. Unter **PlatformIO Home → Devices** den nativen ESP32-S3-Port wählen. Das Board meldet über seinen USB-Hub zwei Ports: den nativen Port (`VID:PID 303A:1001`, Beschreibung etwa `ESP32S3_DEV`) und den CH343-UART-Port (`VID:PID 1A86:55D3`). Für diese TinyUSB-Firmware den nativen Port verwenden.
4. **Project Tasks → sensor-shield → General → Upload** ausführen. Auf `SUCCESS` warten.
5. Falls das Board nach dem Upload im Bootloader bleibt: **RESET/RST** drücken oder USB kurz trennen und wieder verbinden.
6. **Monitor** öffnen. Firmware und Upload verwenden **115200 Baud**.

Den Port ausdrücklich angeben (siehe Terminalbefehle unten), da dieses Board zwei serielle Geräte bereitstellt. Die Portnamen sind rechnerabhängig: macOS beispielsweise `/dev/cu.usbmodem...`, Windows `COM5`, Linux `/dev/ttyACM0`. Ein Port wird deshalb nicht fest in die Projektdatei eingetragen.

### Falls die Verbindung zum Bootloader nicht klappt

1. **BOOT** gedrückt halten.
2. **RESET/RST** kurz drücken und loslassen (oder bei gedrücktem BOOT USB anschließen).
3. **BOOT** loslassen.
4. Devices erneut ansehen: Der Bootloader kann einen anderen Port als die laufende Firmware haben.
5. Diesen Port für Upload auswählen; danach RESET drücken und für Monitor den Port der laufenden Firmware wählen.

Der Upload läuft absichtlich mit 115200 Baud direkt über den ROM-Bootloader (`--no-stub`). Das dauert etwas länger, umgeht aber Prüfsummenfehler des RAM-Flasherprogramms über den CH343/USB-Hub. Bei instabilen Uploads ein anderes Datenkabel bzw. einen direkten USB-Anschluss verwenden. Auf Linux bei `Permission denied` die seriellen Zugriffsrechte gemäß [PlatformIO-Dokumentation](https://docs.platformio.org/en/latest/core/installation/udev-rules.html) einrichten.

## 3. Funktion prüfen

Im Monitor kommen ungefähr alle 200 ms JSON-Zeilen, bei leerer Sensorkonfiguration:

```json
{"data":{}}
```

Beim Start wird zusätzlich beispielsweise diese Zeile gesendet; sie kann bereits vor dem Öffnen des Monitors ausgegeben worden sein:

```json
{"status":"ready","config":"default"}
```

Bei gespeicherter Konfiguration steht dort `stored`. Für einen vollständigen Hardwaretest anschließend den Monitor schließen, [`web/admin/index.html`](../web/admin/index.html) in Chrome/Edge öffnen und einen tatsächlich angeschlossenen Sensor konfigurieren. Messwerte prüfen, das Board neu starten und prüfen, dass die Konfiguration erhalten bleibt. JSON-Kommandos im Monitor mit Enter abschicken.

**Ein normaler Upload löscht nicht den gesamten Flash.** Die NVS-Sensorkonfiguration bleibt bei unverändertem Partitionslayout erhalten. `Erase Flash` gehört nicht zu diesem Ablauf und würde gespeicherte Einstellungen löschen. Die Web-App und der Monitor dürfen nicht gleichzeitig auf den Port zugreifen.

### Abstandssensor liefert `null`

Buildvergleich, Lifecycle-Regressionstest und Gerätetests sind in [diagnostics/ROOT_CAUSE_ANALYSIS.md](diagnostics/ROOT_CAUSE_ANALYSIS.md) dokumentiert. Diagnose-Build: `pio run -e sensor-shield-diagnostics`. Am Gerät trat nach erneuter Konfiguration trotz erfolgreicher Busreservierung ein weiterer Fehler auf: Der VL53L0X behielt den vom vorherigen Betrieb veränderten internen Zustand. Die Firmware setzt deshalb jeden Sensor vor `init()` definiert zurück. Der Diagnose-Build protokolliert zusätzlich Registerzustand, Initialisierung und Messfehler.

Bei einem VL53L0X bedeuten `raw: null` und `value: null`, dass keine gültige Messung vorliegt. Die Sensordaten enthalten dann zusätzlich `error`:

| Fehler | Bedeutung |
| --- | --- |
| `no_i2c_bus` | Beide I²C-Controller sind belegt; maximal zwei Abstandssensoren gleichzeitig. |
| `i2c_begin_failed` | Der I²C-Controller konnte nicht gestartet werden. |
| `vl53l0x_reset_failed` | Der Sensorreset oder dessen Rückleseprüfung ist fehlgeschlagen; die Firmware begrenzt die Wartezeiten. |
| `vl53l0x_init_failed` | Der VL53L0X konnte nicht initialisiert werden; Portzuordnung, Stecker und Versorgung prüfen. |
| `measurement_timeout` | Die Messung wurde nicht innerhalb des Zeitlimits fertig. |
| `out_of_range` | Der gelieferte Messwert liegt außerhalb des akzeptierten Bereichs. |

Die I²C-Busse werden erst beim Aktivieren einer Konfiguration reserviert, nachdem die bisherigen Sensoren freigegeben wurden. Dadurch lässt sich auch eine Konfiguration mit zwei Abstandssensoren erneut anwenden. Nach einem Initialisierungsfehler kann die Konfiguration erneut gesendet oder das Board neu gestartet werden.

Zum Prüfen nach dem Upload: Messwerte ansehen, dieselbe Sensorkonfiguration erneut senden und anschließend das Board neu starten. Bleibt `null` bestehen, die vollständige JSON-Zeile aus dem Monitor einschließlich `error` und `port` zur Diagnose verwenden.

## Terminalbefehle

In VS Code **PlatformIO: New Terminal** öffnen und in den Ordner `esp-sensor-shield/platformio` wechseln. Dadurch ist `pio` verfügbar, auch wenn ein gewöhnliches Systemterminal den Befehl nicht kennt.

```sh
pio run
pio device list
pio run --target upload --upload-port COM5
pio device monitor --port COM5
```

`COM5` durch den eigenen Port ersetzen. Monitor mit **Ctrl+C** schließen. Mit nur einem angeschlossenen Zielboard genügt auch `pio run --target upload`.

Ein sauberer Neubau geht mit:

```sh
pio run --target clean
pio run
```

## Festgelegte Versionen und Einstellungen

| Bestandteil | Version |
| --- | --- |
| pioarduino ESP32-Plattform | `55.03.37` (feste Release-URL) |
| Arduino-ESP32 | `3.3.7` |
| ArduinoJson | `7.4.2` |
| Pololu VL53L0X | `1.3.1` |

Core und Bibliotheken entsprechen den bei der Einrichtung lokal vorhandenen Arduino-Versionen. Die [pioarduino-Version 55.03.37](https://github.com/pioarduino/platform-espressif32/releases/tag/55.03.37) stellt Arduino-ESP32 3.3.7 für PlatformIO bereit. PlatformIO IDE installiert sie anhand der Projektdatei. Keine beweglichen `stable`-/`latest`-Links oder offenen Bibliotheksversionen verwenden.

| Arduino-IDE-Einstellung | Umsetzung in diesem Projekt |
| --- | --- |
| ESP32S3 Dev Module | `esp32-s3-devkitc-1` als Basis mit expliziten Overrides |
| USB CDC On Boot: Enabled | `ARDUINO_USB_CDC_ON_BOOT=1` |
| USB Mode: USB-OTG (TinyUSB) | `ARDUINO_USB_MODE=0`; Basiswert `1` wird entfernt |
| Upload Mode: USB-OTG CDC | `esptool` über den seriellen USB-Port |
| CPU: 240 MHz | `board_build.f_cpu=240000000L` |
| Flash: QIO, 80 MHz | `flash_mode=qio`, `f_flash=80000000L`, `memory_type=qio_qspi` |
| Flash: 8 MB | `board_upload.flash_size=8MB` |
| 8M with SPIFFS | mitgelieferte `partitions.csv`, zwei App-Slots mit je `0x330000` Bytes |
| PSRAM: Disabled | Das Board besitzt 8 MB OPI-PSRAM; die Firmware nutzt sie bewusst nicht |
| Arduino Runs On: Core 1 | `ARDUINO_RUNNING_CORE=1` |
| Events Run On: Core 0 | `ARDUINO_EVENT_RUNNING_CORE=0` |
| Core Debug Level: None | `CORE_DEBUG_LEVEL=0` |
| USB DFU / MSC On Boot: Disabled | beide Defines auf `0` |
| Erase All Flash: Disabled | normaler Upload ohne vollständiges Löschen |
| Upload | `115200`, esptool über CH343, ohne RAM-Stub |
| JTAG: Disabled | Upload über esptool; kein Debugger eingerichtet |
| Zigbee: Disabled | keine Zigbee-Konfiguration; ESP32-S3 hat kein natives Zigbee-Funkmodul |

Die Pinbelegung des Shields kommt weiterhin aus [`PortMap.h`](../esp_firmware/ilab_ESP32_S3_Sensor_Shield/PortMap.h). Die Boardbasis ist eine Build-Konfiguration, keine Aussage, dass die Hardware ein DevKitC ist. Arduino verwendet beim QIO-Boot ebenfalls einen DIO-Imageheader; der Plattformbuilder setzt dies passend zum QIO-Bootloader um.

## Dateien und Wartung

**Abgleich vom 30.09.2026:** Der lokal gefundene Arduino-Buildcache dieses Sketches verwendet 4 MB Flash und `PartitionScheme=default`, während PlatformIO 8 MB verwendet. Die obige Tabelle beschreibt die beabsichtigte Zuordnung; vollständige Gleichheit mit dem tatsächlich erfolgreichen Arduino-Gerätetest ist nicht belegt. Core, Bibliotheken und relevante Compiler-/SDK-Einstellungen stimmen im lokalen Vergleich überein. Einzelheiten und Belege stehen in der [Analyse](diagnostics/ROOT_CAUSE_ANALYSIS.md).

- `platformio.ini`: Boardparameter, Versionen, Upload und Monitor.
- `partitions.csv`: übernommenes Arduino-8-MB-Layout inklusive NVS und zwei App-Slots.
- `src/main.cpp`: bindet den Originalsketch ein, ohne Kopie der Firmware.
- `scripts/no_stub_upload.py`: entfernt beim ROM-Upload PlatformIOs inkompatibles Kompressionsflag.
- `.gitignore`: schließt generierte Pakete, Builds und lokale IDE-Dateien aus.

Der Sketch wird als C++ übersetzt. Neue Funktionen müssen vor ihrer Verwendung definiert oder deklariert werden; PlatformIO erzeugt für diesen Wrapper keine Arduino-Funktionsprototypen. Bei neuen Bibliotheken auch deren Include in `src/main.cpp` ergänzen, damit PlatformIO sie trotz des außerhalb liegenden Sketches erkennt; externe Bibliotheken zusätzlich mit fester Version in `lib_deps` eintragen.

### Prüfstand bei der Einrichtung

- PlatformIO Core `6.1.19` hat `platformio.ini` erfolgreich eingelesen.
- Die Partitionseinträge stimmen mit Arduino-ESP32 3.3.7 überein, überschneiden sich nicht und passen in 8 MB.
- Der C++-Wrapper wurde mit den lokal installierten Arduino-Paketen und den oben genannten Boardoptionen erfolgreich kompiliert. Dieser ergänzende Test ersetzt keinen PlatformIO-Build.
- Build, Upload und Hardwaretest werden nach Änderungen erneut ausgeführt; der letzte erfolgreiche Test ist im Arbeitsprotokoll bzw. in der Übergabe dokumentiert.

Für nachvollziehbare Ergebnisse denselben Git-Stand und diese Paketversionen verwenden. Updates bewusst ändern, neu bauen und am Board testen. Die feste Konfiguration macht die Build-Eingaben wiederholbar; sie garantiert keine bytegleichen Binärdateien über unterschiedliche Betriebssysteme. Für Workshops das Projekt einmal vorab bauen, solange Internet verfügbar ist.

Technische Referenzen: [PlatformIO-Projektkonfiguration](https://docs.platformio.org/en/latest/projectconf/index.html), [Boardbasis](https://docs.platformio.org/en/latest/boards/espressif32/esp32-s3-devkitc-1.html), [Arduino-Boardparameter 3.3.7](https://github.com/espressif/arduino-esp32/blob/3.3.7/boards.txt), [Arduino-Partitionstabelle](https://github.com/espressif/arduino-esp32/blob/3.3.7/tools/partitions/default.csv).
