# Zwei VL53L0X: Root-Cause-Analyse

## Ergebnis nach Gerätetest und gezielter Korrektur

[Abgeschlossener Gerätetest: 1902 fehlerfreie Sensordatensätze, normale Firmware hochgeladen](DEVICE_TEST_RESULT.md).

**Der aktuelle Fehler wurde am Gerät reproduziert und mit einem Sensorreset vor
jeder Neuinitialisierung im Diagnose- und normalen Build behoben.** Beide Sensoren liefern
zunächst gültige Werte; nach erneuter Anwendung derselben Konfiguration lieferte
der vorherige Firmwarestand 8190/8191 und damit `out_of_range`/`null`.
Busreservierung und `init()` waren dabei erfolgreich. Ein ESP32-Neustart allein
behebt diesen Zustand nicht, da er die Sensorversorgung nicht abschaltet.

Der konkrete Unterschied zum isolierten Test liegt im Ersetzen der Sensorobjekte:
Pololu `stopContinuous()` schreibt Registerseite 1, Register `0x91` auf null;
der bisherige Wert steckt nur noch im alten `VL53L0X`-Objekt. Dieses wird zerstört.
Das neue `init()` liest den veränderten Sensorzustand ein. Im Gerätetest wurde
`0x91=0` vor und `0x91=60` nach dem Sensorreset gemessen. Mit dem Reset bestehen
erneute Anwendung, 2→1→2 und Wiederherstellung der Konfiguration ohne Nullwerte.

Der Reset normalisiert auch andere Register und Kalibrierzustände. Dass allein
`0x91` für alle ungültigen Werte verantwortlich ist, wurde nicht isoliert bewiesen.
Ein IDE-spezifischer Fehler ist weiterhin nicht belegt; die Zustandsfolge ist
entscheidend. Ein zuvor benutzter und ein neu hinzugefügter Sensor können sich
hierdurch unterschiedlich verhalten.

Änderung: `VL53L0XSensor.h`, `resetDevice()` / `waitForModelId()` vor `lox.init()`.
Reset-/Boot-Wartezeiten je maximal 500 ms zuzüglich laufender I2C-Transaktion;
Fehler werden als `vl53l0x_reset_failed` veröffentlicht. Hardware-, Core- und
Optimierungsflags bleiben unverändert. [Inkrementeller Reset-Patch](vl53-reset.patch).
[Gesamtpatch zum ursprünglichen Git-Stand](vl53-from-head.patch).

[Ungepatchter Gerätetest mit Rohdaten](device-test/RESULT.md).
[Diagnose-Gegenversuch mit Reset](device-test-reset-reconfigured/summary.json).
Die folgenden Abschnitte dokumentieren die vorausgegangene statische Analyse;
die damalige Einschränkung „kein Gerätetest“ und die historische Priorisierung
werden durch diesen Befund ersetzt.

Stand: 30.09.2026. Untersucht wurden der vollständige gemeinsame Sketch, alle Sensoren,
ConfigManager, SensorManager, Publisher, die Web-Serial-Ausgabe, installierte Bibliotheken,
Arduino-Buildcache und neu erzeugte PlatformIO-Buildbefehle. Kein Upload und kein Gerätetest.
Die vom Nutzer bereits verifizierte Hardwarefunktion wird vorausgesetzt.

## 1. Ergebnis und Grenzen

**Der stärkste konkrete Befund ist eine vorzeitige Busreservierung im Git-Ausgangsstand.**
Der Fehler lässt sich mit dem echten Sensor-/Manager-Code und simulierten Treibern auf dem Host
reproduzieren: Beim Wechsel von einem auf zwei Sensoren erhält genau ein neuer Sensor keinen Bus.

**Wichtig: Dieser Fehler war im Arbeitsverzeichnis vor Beginn dieser Untersuchung bereits
korrigiert.** Auch die gefundene Arduino-Cachekopie dieses Projektpfads enthält diese Korrektur.
Damit ist er ein belegter früherer Fehler, aber keine bewiesene Erklärung für ein `null`,
das mit dem aktuellen Arbeitsstand noch auftritt. Ohne Fehlerzeile und Firmware-Nachweis bleibt
die Ursache des aktuell beobachteten Geräteverhaltens offen. Ein IDE-spezifischer I2C-Fehler
oder ein Optimierungsfehler ist durch die vorliegenden Quellen nicht belegt.

### Priorisierung

| Kandidat | Bewertung / entscheidender Nachweis |
| --- | --- |
| Alte Firmware mit Busreservierung im Konstruktor; unterschiedliche Re-Konfigurationsfolge | Höchste Evidenz für das historische Fehlerbild. Im Hosttest reproduziert. Aktueller Code behebt es bereits. Nur plausibel als aktuelle Ursache, wenn ein alter/anderer Stand geflasht ist. |
| Einmalig fehlgeschlagenes `lox.init()` bleibt dauerhaft ungelöst | Hohe Priorität, falls aktueller Code und `vl53l0x_init_failed`. Es gibt keinen erneuten Initialisierungsversuch in `read()`. Eine temporäre Störung wird damit zu dauerhaftem `null`. Auslöser noch unbewiesen. |
| Messwert wird von der Firmware verworfen | Hohe Priorität bei `measurement_timeout` oder `out_of_range`: jeder einzelne Fehler löscht sofort den zuletzt gültigen Wert. Isolierter Test kann z. B. 8190/65535 ausgeben, während die Firmware daraus `null` macht. Tatsächliche Rückgabewerte vergleichen. |
| Andere gespeicherte Konfiguration/mehr als zwei Distanzsensoren | Mittlere Priorität bei `no_i2c_bus`. Alle vier C-Ports akzeptieren `distance`; die Konfiguration wird auch bei fehlgeschlagenem Sensorstart bestätigt und gespeichert. NVS bleibt bei normalem Upload erhalten. |
| Core-/Library-/ABI-/Optimierungsunterschied | Niedrige Priorität: relevante lokale Quellen, Compiler und SDK-Flags stimmen überein. Kein belegter ABI-Konflikt. |
| Flashlayout / USB / UI | Flashlayout ist verschieden, NVS aber gleich. Keine direkte Erklärung für genau einen Sensor. USB kann den Ablauf beeinflussen; die UI erzeugt im geprüften Pfad keinen einzelnen Null-Messwert aus einem gültigen Zahlenwert. |

Historischer Referenzcommit des Regressionstests: `a063468906ae92e5051f8bc4457ffc55d9169b65`.

## 2. Belegter Lifecycle-Fehler

`ConfigManager.h:90–109` erzeugt erst alle neuen Objekte (`staged`), ruft danach
`sensorManager.clear()` auf und aktiviert dann jedes neue Objekt mit `add()` → `begin()`.

Im Git-HEAD war der Konstruktor:

```cpp
: busIndex(claimBus()),
  wire(busIndex >= 0 ? (uint8_t)busIndex : 0), ...
```

Beispiel mit einem aktiven Sensor auf Bus 0:

1. Neuer Sensor A wird konstruiert und reserviert Bus 1.
2. Neuer Sensor B wird konstruiert, findet keinen freien Bus und behält `busIndex == -1`.
3. `clear()` gibt den alten Bus 0 frei.
4. A startet auf Bus 1. B versucht keine neue Reservierung und bleibt uninitialisiert.
5. `read()` kehrt sofort zurück; `appendJson()` liefert `raw:null,value:null`.

Bei zwei alten Sensoren können beide Ersatzsensoren scheitern. Nach echtem Neustart mit zwei
Sensoren sollten im alten Code hingegen beide Busse verfügbar sein. Dieses Muster unterscheidet
den Lifecycle-Fehler von einem Fehler, der bereits beim ersten Start aus leerem Zustand auftritt.

### Bereits vorhandene korrekte Lösung

`VL53L0XSensor.h:40–42, 102–146`:

- Konstruktor reserviert keine Hardware: `busIndex = -1`, zunächst leerer `unique_ptr<TwoWire>`.
- `begin()` reserviert erst nach dem Löschen aller alten Sensoren.
- `setBus(wire.get())` erfolgt nach erfolgreichem `wire->begin()`.
- Destruktor stoppt Messung, zerstört `TwoWire`, gibt anschließend die Busnummer frei.
- Fehlgeschlagenes `TwoWire::begin()` gibt Objekt und Reservierung wieder frei.

Der alte Code rief `wire.end()` explizit und nochmals über den Member-Destruktor auf.
Das ist keine doppelte Speicherfreigabe. Ebenso ist die pauschale Behauptung falsch, ein
nie gestartetes Fallback-`TwoWire(0)` müsse beim Löschen zwangsläufig Bus 0 abschalten:
im geprüften Core schützt `TwoWire::end()` bei aktivierten HAL-Locks diesen Pfad mit `lock != NULL`.

## 3. Buildvergleich

Arduino-Beleg: `~/Library/Caches/arduino/sketches/CB25BCB649C098F753E22C3B4034861B/`
(`build.options.json`, `compile_commands.json`, Sketchkopie). Dieser Cache gehört zum aktuellen
Projektpfad, beweist aber nicht, dass genau dieses Binary beim erfolgreichen Hardwaretest lief.
Andere gefundene Projektkopien verwenden teils Hardware-CDC und Event-Core 1.

| Einstellung | Aktuelles PlatformIO | Arduino-Cache dieses Projektpfads |
| --- | --- | --- |
| Plattform | pioarduino 55.03.37, feste Release-URL | Espressif Arduino-Paket |
| Arduino-Core | 3.3.7 | 3.3.7 |
| ESP-IDF | 5.5.2; `IDF_VER=v5.5.2-729-g87912cd291` | gleiche SDK-Defines |
| Paketlabel der SDK-Libs | `5.5.0+sha.87912cd291` | nicht als tatsächliche IDF-Minor/Patch-Version interpretieren |
| Board / Variant | `esp32-s3-devkitc-1` / `esp32s3` | `esp32s3` / `esp32s3` |
| Flashgröße | 8 MB | 4 MB |
| Flashmodus / Frequenz | QIO / 80 MHz | QIO / 80 MHz |
| Imageheader | DIO mit QIO-Bootloader | ebenfalls DIO bei QIO-Menüauswahl |
| CPU | 240 MHz | 240 MHz |
| PSRAM | deaktiviert, kein `BOARD_HAS_PSRAM` | deaktiviert |
| Memory type | `qio_qspi` | `qio_qspi` |
| USB | TinyUSB, Mode 0 | TinyUSB, Mode 0 |
| CDC / MSC / DFU on boot | 1 / 0 / 0 | 1 / 0 / 0 |
| Loop-/Event-Core | 1 / 0 | 1 / 0 |
| Partitionen | eigene 8-MB-Tabelle, Appslots je `0x330000` | `default`, Appslots je `0x140000` |
| NVS | Offset `0x9000`, Größe `0x5000` | identisch |
| Compiler | GCC 14.2.0, esp-14.2.0_20251107 | identisch |
| Optimierung | `-Os`, kein zusätzliches Fast-Math/LTO gefunden | `-Os` |
| C++ | `-std=gnu++2b`, danach `-std=gnu++2a` → effektiv C++20 | identische Reihenfolge in `cpp_flags` |
| Exceptions / RTTI | `-fexceptions -fno-rtti` | identisch |
| weitere Flags | Stackprotektor, Function/Data Sections, kein Jump-Table; SDK-Flags | identische SDK-`cpp_flags` |
| Core Debug | 0 | 0 |
| Upload | esptool, 115200, `--no-stub`, ohne `-z`; native USB-Auswahl, 1200-bps Touch | Menü 921600, TinyUSB-CDC; tatsächliches Uploadprotokoll nicht im Cache belegt |

`build_unflags` entfernt die Boardvorgaben USB Mode 1, Event-Core 1 und `BOARD_HAS_PSRAM`;
`build_flags` setzt die obigen Werte. `ARDUINO_RUNNING_CORE=1` erscheint doppelt mit gleichem Wert.
`ARDUINO`, `ARDUINO_BOARD`, `ARDUINO_PARTITION`, IDE-Metadaten und Include-/Dateipfade unterscheiden
sich erwartbar. Im Sensorcode ist kein davon abhängiger abweichender Zweig vorhanden.

Die beim Start vorhandene `compile_commands.json` war veraltet: anderer Paketpfad,
`ILAB_BOOT_DIAGNOSTICS=1`, fehlendes CDC-Define gegenüber der aktuellen INI. Der frische Build
enthält korrekt `ARDUINO_USB_CDC_ON_BOOT=1`. Eine Compile-Datenbank ist kein Beleg für das
zuletzt geflashte Binary. Die README-Aussage einer vollständig gleichen 8-MB-Arduino-Konfiguration
wird vom gefundenen Cache nicht bestätigt.

### Bibliotheken und ABI

- Pololu VL53L0X 1.3.1 in beiden Umgebungen: alle C++-/Headerquellen bytegleich.
- ArduinoJson 7.4.2: Runtime-Quellen bytegleich; Unterschiede nur bei mitgelieferten Extras/Tests.
- Wire/Preferences kommen aus Core 3.3.7. VL53L0X benötigt Wire; keine zweite VL53L0X-Implementierung
  im tatsächlichen PlatformIO-Dependency-Graph. Die ebenfalls installierte Adafruit-Bibliothek
  wird in diesem Build nicht verwendet.
- `Wire.cpp`, `Wire.h`, `esp32-hal-i2c-ng.c`, Core `main.cpp`, SDK `cpp_flags`, `defines`,
  `qio_qspi/include/sdkconfig.h`, `libdriver.a` und `libesp_driver_i2c.a` wurden lokal bytegleich verglichen.
- Wrapper `src/main.cpp` bindet direkt denselben `.ino` ein. Arduino erzeugt Funktionsprototypen;
  die vorliegenden Funktionen sind bereits vor Benutzung definiert. Kein belegter Laufzeitunterschied daraus.

## 4. Datenpfad und Timing

`VL53L0XSensor.h:169–206` setzt **vor jedem Lesen** `hasReading=false`, `rawMm=0`, `value=NAN`.
Bei fehlender Initialisierung, Timeout oder `d == 0 || d > 8000` bleiben diese Werte bestehen.
`appendJson():215–225` schreibt die Zeichenfolge `null` explizit. ArduinoJson serialisiert diese
Sensordaten überhaupt nicht; es wird nur für die Konfiguration benutzt.

Ein gültiger Messwert wird folglich bereits durch einen einzelnen folgenden Timeout verworfen.
Die nächste gültige Messung stellt die Ausgabe wieder her. Der Medianpuffer startet mit fünf Nullen:
die ersten beiden gültigen Messungen können `raw=0` ergeben; das erklärt kein `null`.
Nichtendliche Mappingparameter können zusätzlich `value` unbrauchbar machen, während `raw` gültig ist.

`DataPublisher.h:7–14` hängt die Sensor-JSON-Fragmente aneinander. Web `shared/serial.js:165–178`
parst ganze Zeilen. Ein Parsefehler verwirft die ganze Zeile, nicht nur einen Sensor.
`admin/js/editor.js:440 ff.` übernimmt Werte nach Port; `fmt(null)` zeigt ausdrücklich `null`.
Eindeutige Namen werden in der Konfiguration geprüft; Namen und Port-IDs werden in feste Puffer kopiert.
Bei seriell numerischem Wert und abweichender UI-Anzeige den konkreten Frame vergleichen.

Es gibt im Sketch keinen WiFi-Start, keinen ESP-Webserver, keine eigenen Sensor-Tasks und keine
Sensor-ISR. Web läuft im Browser über USB-Serial. Konfiguration, `clear()`, `readAll()` und
`publish()` laufen nacheinander im Arduino-Loop-Task auf Core 1. USB/Systemtasks existieren,
aber greifen im Projekt nicht auf `s_busUsed` oder die Sensorobjekte zu.

- Loop-Schwelle 40 ms, am Ende `delay(1)`; das garantiert keine 25 Messungen pro Sekunde.
- VL53L0X-Budget 200000 µs, Sensor-Timeout 500 ms; Wire-Transaktionstimeout standardmäßig 50 ms.
- Continuous-Read wartet synchron auf Daten. Zwei fehlerhafte Sensoren können ungefähr zweimal
  das Sensorzeitlimit plus Transaktions-/Schedulingzeit blockieren.
- SoundSensor benötigt je Abfrage bis zu 25 ms. Das verlängert die Schleife.
- Empfang laufender Konfigurationszeilen pausiert Messungen; das allein schreibt keine Nullwerte.
- `lastPublishMs` bekommt den Zeitstempel vor dem blockierenden Lesen. Nach langem Lesen kann
  die nächste Runde sofort wieder fällig sein. Keine direkte Erklärung für dauerhaft einen Nullsensor.
- `setMeasurementTimingBudget()` wird bisher nicht geprüft; der Diagnose-Build erfasst das Ergebnis.
- Pololu prüft nicht jede empfangene Byteanzahl; `last_status` beschreibt nur die letzte
  `endTransmission()`, nicht den Erfolg sämtlicher Transaktionen. Status 0 schließt einen Lesefehler nicht aus.
  Siehe [Pololu-Implementierung 1.3.1](https://github.com/pololu/vl53l0x-arduino/blob/1.3.1/VL53L0X.cpp).

## 5. Lebenszeit / Undefined Behavior

Im aktuellen VL53L0X-Pfad kein belegter Use-after-free, Arrayüberlauf oder Zugriff auf einen
uninitialisierten Member gefunden. Medianindex bleibt modulo 5. SensorBase hat einen virtuellen
Destruktor; der Manager löscht über Basispointer korrekt. `staged` enthält rohe Pointer, übergibt
nach Validierung deren Ownership an den Manager und löscht sie auf Fehlerpfaden. Sein eigener
Vektordestruktor löscht die übernommenen Objekte nicht nochmals. Keine `shared_ptr`-Nutzung.

`setBus()` speichert einen nichtbesitzenden Pointer. Im aktuellen Ablauf lebt `wire` bei allen
`lox`-Zugriffen. Nach `wire.reset()` enthält `lox` vorübergehend noch die alte Adresse, wird aber
nicht mehr darüber aufgerufen; VL53L0X hat keinen hardwarezugreifenden Destruktor. Bei Neustart
von `begin()` wird der Buspointer vor `init()` erneut gesetzt. Kein belegter dangling-pointer-Zugriff.
Die globalen Sensoren werden erst in `setup()` angelegt; das bloße anfängliche `&Wire` im
Pololu-Konstruktor startet keine Hardware. Statische Busmaske ist nullinitialisiert.

Die statische Maske wäre bei parallelen `begin()`/Destruktoren ungeschützt. Solche parallelen
Aufrufe gibt es hier nicht. Ein weiteres `TwoWire`-Objekt mit gleicher Busnummer außerhalb dieser
Klasse könnte den Controller übernehmen: Core `begin()` liefert bei bereits gestartetem Controller
sofort Erfolg, ohne die neuen Objektpuffer anzulegen. Im vollständigen vorliegenden Sketch findet
sich kein zweiter aktiver Besitzer. Die globalen `Wire`/`Wire1` allein starten keine Controller.

Weitere begrenzte Befunde, derzeit ohne Beleg als Ursache dieses Distanzsensorfehlers:

- `EncoderSensor::accumulatedCount` kann langfristig als signed long überlaufen.
- Unbegrenzte extreme `midCutoff`/`edgeCutoff`-Konfigurationen können in Joystick-Arithmetik
  signed Overflow erzeugen. Normale Standardwerte tun das nicht.
- `getUIntOr()` prüft vor float→uint32 nicht explizit NaN; für nichtendliche Eingaben fehlt eine
  vollständige Validierung. Ebenso fehlen Grenzen für extreme Mappingwerte.
- `new`/Vektorallokationen im ConfigManager sind nicht durchgehend gegen OOM abgesichert.
  Der Manager hat keinen eigenen aufräumenden Destruktor; im dauerhaften Firmwarebetrieb wird
  über `clear()` aufgeräumt. Kopieren des Managers wäre gefährlich, erfolgt aber nirgends.
- Mehrfaches `begin()` desselben Encoders kann PCNT-Ressourcen verlieren; der aktuelle Manager
  ruft `begin()` pro neuem Objekt genau einmal auf. Distanzsensor-`begin()` stoppt vorher Continuous Mode.

Keine dieser Stellen wird ohne reproduzierbaren Zusammenhang großflächig umgebaut.

## 6. Patch und Verifikation

Neu geändert:

1. `VL53L0XSensor.h`: durch `ILAB_VL53_DIAGNOSTICS` abschaltbare Lifecycle-Ausgaben und Messdiagnose.
2. `platformio.ini`: zusätzliche Umgebung `sensor-shield-diagnostics`, mit identischen
   Hardware-, Versions- und Optimierungseinstellungen. Standardumgebung unverändert.
3. Diese Analyse, Host-Regressionstest und zwei Patchdateien.

`vl53-diagnostics.patch` enthält ausschließlich den hier ergänzten Sensor-Patch relativ zum
vorgefundenen Arbeitsstand. `vl53-from-head.patch` enthält zusätzlich die bereits vorgefundene
Lifecycle-Korrektur relativ zum Git-HEAD. **Nicht beide anwenden; Änderungen sind bereits eingespielt.**

Der Patch erfasst je Sensor Bus, Initialisierungsstatus/-dauer, Budget-Erfolg, Bibliotheksrückgabe,
Lesedauer, letzten Sendestatus, gültige Messungen, Timeouts und verworfene Werte.
Lifecycle-Zeilen enthalten Event, Port, Bus, Reservierungsmaske, Objekt-/Wire-Adresse und CPU-Core.
`returnedMm=0` und `lastTxStatus=-1` vor dem ersten Read sind Initialwerte, keine Hardwaremessung.
Zähler gelten für die Objektlebenszeit. Zusätzliche Ausgabe verändert etwas das Timing; deshalb
bei timingabhängigen Ergebnissen anschließend mit normalem Build gegenprüfen.

### Automatische Prüfung

```sh
python3 diagnostics/test_lifecycle.py
pio run -e sensor-shield
pio run -e sensor-shield-diagnostics
```

Hosttest: Git-HEAD reproduziert den Fehler (`exit 42` als erwartetes Resultat); aktueller Code
mit und ohne Diagnose besteht (`exit 0`). Geprüft: 1→2, wiederholt 2→2, Abbruch einer vorbereiteten
Konfiguration, Freigabe/Wiederbelegung, Initialisierungsfehler, Timeout→Erholung, Bereichsfehler
und dritter Sensor. Echte Header, simulierte Treiber; kein Ersatz für Gerätetests.
UndefinedBehaviorSanitizer aktiv. AddressSanitizer ließ sich auf diesem Host nicht initialisieren,
auch außerhalb der Sandbox; daher kein erfolgreicher ASan-Nachweis.

Beim erneuten Test bestanden alle drei Host-Regressionen sowie beide PlatformIO-Builds
(`sensor-shield` und `sensor-shield-diagnostics`). Die vorherige Blockade durch die
Python-Abhängigkeitsinstallation trat nicht erneut auf. Der Build benötigte außerhalb der
Sandbox Schreibzugriff auf eine Sicherungsdatei im gemeinsamen Framework-Paket.
Normaler Build: 46504 Bytes RAM / 460600 Bytes Flash; Diagnose-Build: 46504 / 461464 Bytes.
Kein Upload oder Gerätetest durchgeführt. Beim lokalen Ausführen wurde
`PLATFORMIO_CORE_DIR="$PWD/.pio-core" .pio-core/penv/bin/pio` verwendet.

### Kurzer Gerätetest

1. Vorhandene Konfiguration exportieren. Diagnose-Build auf denselben nativen USB-Port laden:
   `pio run -e sensor-shield-diagnostics -t upload --upload-port <PORT>`.
   Monitor öffnen (115200). Keine parallele Browserverbindung.
2. Zwei belegte C-Ports mit eindeutigen Namen konfigurieren. Beispiel **nur wenn C1/C2 verwendet werden**:

   ```json
   {"C1":{"type":"distance","name":"links"},"C2":{"type":"distance","name":"rechts"}}
   ```

3. 20 Datenframes sichern. Gleiche Konfiguration nochmals senden; dann 1→2 testen.
   Erwartung: Neue `constructed`-Events haben `bus=-1`; beide alten `released`-Events kommen
   vor neuen `claimed`-Events, nach vollständiger Freigabe Maske 0, danach Bus 0/1 und Maske 3.
   Konstruktor-Events dürfen während bestehender Sensoren Maske 3 sehen, aber nichts reservieren.
4. Neustart mit gespeicherter Konfiguration testen. Ein Kaltstart und eine erneute Anwendung
   müssen beide funktionieren. Die eigentliche vollständige Sensorkonfiguration ebenfalls testen.
5. Fehler einordnen:
   - `bus=-1` / `no_i2c_bus`: Zahl aktiver Distanzsensoren und Lifecycle-Reihenfolge prüfen.
   - `initialized=false`: Initpfad; kein nachträgliches JSON-/UI-Problem.
   - `initialized=true`, Timeouts steigen: Mess-/Controllerzustand, Lesedauer und Sendestatus vergleichen.
   - `invalidReads` steigt: `returnedMm` mit unmodifiziertem Testsketch vergleichen.
   - `goodReads` steigt und seriell Zahlen, UI zeigt null: konkreten Frame in der Web-App untersuchen.
6. Arduino IDE mit demselben gespeicherten JSON und exakt diesem Quellstand vergleichen.
   Für dieselben Diagnosen `#define ILAB_VL53_DIAGNOSTICS 1` vor den Sketch-Includes setzen.
   Den tatsächlichen erfolgreichen Arduino-Build samt FQBN sichern, nicht aus README ableiten.
7. Zurück zur normalen Umgebung bauen/uploaden und exportierte Konfiguration wiederherstellen.

Es wurden keine Flash-/USB-/Optimierungsparameter auf Verdacht geändert. Ein Downgrade,
Abschalten der Optimierung oder dauerhafte Wiederholung von `begin()` ist aktuell nicht begründet.
