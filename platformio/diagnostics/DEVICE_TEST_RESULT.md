# Ergebnis: beide Sensoren mit korrigierter Firmware erfolgreich getestet

Der aktuelle **normale** Firmware-Build mit Sensorreset ist auf dem ESP32-S3.
Die gesicherten Namen, Ports und Mappingparameter für C1/C2 sind wiederhergestellt.
Der serielle Testport wurde geschlossen und steht der Web-App wieder zur Verfügung.

## Vorher/Nachher

| Test | Ohne Sensorreset | Mit Sensorreset |
|---|---|---|
| Erste Messungen nach Upload | Beide gültig | Beide gültig |
| Gleiche Konfiguration erneut anwenden | Beide dauerhaft `out_of_range` / `null` | Beide gültig |
| Wechsel 2→1→2 | Keine stabile Erholung | Beide gültig |
| Erneute Zweierkonfiguration | Keine stabile Erholung | Beide gültig |
| ESP32-Neustart mit gespeicherter Zweierkonfiguration | 192 von 192 Sensordatensätzen `null` | 206 von 206 gültig |

Erfolgreicher Gegenversuch mit Diagnose-Build: **443 Datenframes / 846 Sensordatensätze**.
Identische Konfigurationsfolge mit normalem Build: **445 Datenframes / 850 Sensordatensätze**.
Abschließender Neustarttest mit normalem Build: **103 Datenframes / 206 Sensordatensätze**.
Insgesamt **1902 Sensordatensätze ohne `null` oder Fehler** nach der Korrektur in diesen drei Tests.
Die Diagnosezähler zeigten keine Mess-Timeouts und keine verworfenen Messwerte.
Letzte Werte nach Neustart: **C1 85 mm, C2 68 mm**.

Die ersten beiden Ausgaben nach einer Neuinitialisierung können wegen des bestehenden,
mit Nullen gefüllten Medianpuffers `raw=0` zeigen. Diese separate Filtereigenschaft
wurde nicht verändert; das ist kein Nachweis einer echten 0-mm-Messung.

## Ursache und minimaler Fix

Die Anwendung ersetzt Sensorobjekte bei jeder Konfiguration. `stopContinuous()`
der Pololu-Bibliothek löscht ein internes Register (`0x91`, Registerseite 1), dessen
früheren Wert das alte Objekt in `stop_variable` gespeichert hatte. Mit dem alten
Objekt geht dieser gespeicherte Wert verloren. Der weiterhin versorgte Sensor wird
anschließend mit einem neuen Objekt aus seinem veränderten Hardwarezustand initialisiert.
`init()` liefert dabei Erfolg, die Messungen können trotzdem unbrauchbar sein.

Im Gegenversuch wurde vor dem Reset **0**, danach **60** in Register `0x91` gemessen.
Ein zuvor laufender Sensor kann damit anders reagieren als ein frisch hinzugefügter;
das passt auch zum ursprünglichen Fehlerbild mit nur einem betroffenen Sensor.

Der Fix setzt den **VL53L0X selbst** vor `lox.init()` zurück. Die Resetsequenz nutzt
Register `0xBF`, prüft die Modell-ID beim Assert/Release und begrenzt die Wartezeiten.
Ein Fehler wird als `vl53l0x_reset_failed` sichtbar. Es wurden keine Core-, Flash-,
USB- oder Optimierungsflags geändert und keine fehlerhaften Werte als gültig maskiert.

Die Konfigurationsfolge und die Wirkung des Resets sind am Gerät nachgewiesen.
Der Reset verändert mehrere interne Zustände; die ausschließliche Kausalität von
Register `0x91` wurde nicht durch einen separaten Einzelregister-Gegenversuch bewiesen.
Ein spezifischer Unterschied zur Arduino IDE bei exakt derselben Zustandsfolge
ist weiterhin nicht nachgewiesen.

## Belege und Wiederholung

- [Fehler vor der Korrektur](device-test/RESULT.md)
- [Diagnose-Gegenversuch](device-test-reset-reconfigured/summary.json)
- [Normaler Build: komplette Testfolge](device-test-normal/summary.json)
- [Normaler Build: Neustart](device-test-normal/restart-summary.json)
- [Firmware-Hash des zuletzt hochgeladenen normalen Builds](device-test-normal/firmware.json)
- [Gezielter Reset-Patch](vl53-reset.patch)
- [Gesamtpatch zum ursprünglichen Git-Stand](vl53-from-head.patch)

Beide Builds und Hosttests bestanden. Die Hosttests prüfen zusätzlich einen
fehlgeschlagenen Reset mit begrenzter Wartezeit; die Sensorphysik wird dort simuliert.

Erneuter Gerätetest aus dem PlatformIO-Ordner, nachdem die normale Firmware geladen wurde:

```sh
.pio-core/penv/bin/python diagnostics/run_device_test.py diagnostics/device-test-repeat --normal
.pio-core/penv/bin/python diagnostics/check_device_restart.py diagnostics/device-test-repeat
```

Die Skripte erwarten dieses Board mit C1/C2, wenden die gesicherte Konfiguration aus
`device-test/original-config.json` an und verändern dabei vorübergehend die aktive
Sensorkonfiguration. Währenddessen Web-Serial-Verbindung und andere Monitore schließen.
