# Gerätetest: Fehler nach Neukonfiguration reproduziert

**Historisches Fehlerprotokoll vor dem Sensorreset-Patch.** Der anschließende
[Gegenversuch und abschließende Gerätetest](../DEVICE_TEST_RESULT.md) waren erfolgreich.

Getestet: Waveshare ESP32-S3, zwei VL53L0X an C1 und C2, Diagnose-Firmware.
Upload erfolgreich, Firmware-Hash in `firmware.json`, vollständige Ausgabe in `upload.log`.

| Testphase | Datenframes | C1 mit null | C2 mit null |
|---|---:|---:|---:|
| Nach Upload, unveränderte gespeicherte Konfiguration | 103 | 0 | 0 |
| Identische Zweierkonfiguration erneut gesendet | 76 | 76 | 76 |
| Nur C1 konfiguriert | 45 | 45 | nicht konfiguriert |
| Wechsel von einem auf zwei Sensoren | 124 | 124 | 123 |
| Zweierkonfiguration nochmals angewendet | 89 | 88 | 89 |
| Ursprüngliche Zweierkonfiguration wiederhergestellt | 68 | 67 | 66 |
| ESP32-Neustart über UART-Steuerleitungen | 96 | 96 | 96 |

Vor Upload waren ebenfalls beide Sensoren gültig (42 erfasste Frames).
Nach Upload: C1 47–52 mm, C2 37–39 mm. Nach Neukonfiguration:
`initialized=true`, `initStatus=0`, `budgetOk=true`, Bus 0/1 korrekt,
keine Mess-Timeouts, aber Bibliotheksrückgaben 8190/8191 und `out_of_range`.
Einzelne später akzeptierte Samples ergeben wegen des noch leeren Medianpuffers 0;
das ist kein Nachweis einer stabilen Erholung.

Die Lifecycle-Ausgaben zeigen die richtige Reihenfolge: Konstruktoren reservieren
keinen Bus; beide alten Besitzer werden freigegeben (Maske 0), danach werden Bus 0
und Bus 1 neu reserviert. **Der historische Reservierungsfehler erklärt diesen
reproduzierten Fehler nicht.**

## Aktualisierte Arbeitshypothese

Der Sensor-Hardwarezustand überlebt das Löschen seines C++-Objekts und einen
ESP32-Reset. Das neue Objekt erwartet bei `init()` jedoch einen Zustand, der durch
den vorherigen Messbetrieb und `stopContinuous()` verändert wurde.

Konkreter Codebefund in Pololu VL53L0X 1.3.1:

- `init()` liest auf Registerseite 1 Register `0x91` in den privaten Member `stop_variable`.
- `startContinuous()` schreibt diesen gespeicherten Wert zurück.
- `stopContinuous()` überschreibt Register `0x91` mit `0`.
- Das Projekt ruft beim Löschen `stopContinuous()` auf und zerstört anschließend das
  Objekt samt gespeichertem Wert. Das neue Objekt liest bei `init()` den veränderten
  Registerwert erneut ein.

Diese Kette ist im Quellcode belegt. Dass genau dieser Registerwert die beobachteten
8190/8191 verursacht, ist **noch eine Hypothese**: Der Registerwert wurde am Gerät
noch nicht aufgezeichnet, und es gab noch keinen kontrollierten Gegenversuch.
Auch ein nicht abgeschlossener Stop-/Kalibrierungsvorgang bleibt eine Alternative.

Nächster gezielter Versuch: `0x91` vor Stop und vor neuer Initialisierung erfassen;
anschließend einen definierten Sensorreset vor `init()` als isolierte Änderung
gegen dieselbe Konfigurationsfolge testen. Die ST-API enthält dafür
`VL53L0X_ResetDevice()` (Softresetregister `0xBF`); eine Übernahme muss begrenzte
Wartezeiten und Transaktionsfehler berücksichtigen. Kein Plattform-Flagwechsel nötig.

## Grenzen und aktueller Zustand

- ESP32-Neustart war kein Aus-/Einschalten der Sensorversorgung.
- Der Test beweist einen Fehler im Re-Konfigurationsablauf des aktuellen
  PlatformIO-Builds, noch keinen Unterschied bei identischem Ablauf in Arduino IDE.
- Die ursprünglichen Namen, Ports und Mappingparameter sind wiederhergestellt
  (`original-config.json`). Die zuletzt gemessenen Werte blieben fehlerhaft.
- Diagnose-Firmware blieb zuletzt auf dem Board.
- Bei Fortsetzung wurde das Board nicht mehr als USB-Gerät erkannt. Weitere
  Uploads/Gegenversuche benötigen das wieder angeschlossene Board.

Quellen: [Pololu 1.3.1](https://github.com/pololu/vl53l0x-arduino/blob/1.3.1/VL53L0X.cpp),
[ST-API im Adafruit-Repository](https://github.com/adafruit/Adafruit_VL53L0X/blob/master/src/core/src/vl53l0x_api.cpp).
