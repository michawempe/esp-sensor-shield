# Getrennte Sensorerfassung mit 50-Hz-Ausgabe

Stand: 06.10.2026. Getestet am angeschlossenen Waveshare ESP32-S3 mit der in
`original-config.json` gesicherten Konfiguration. Diese entspricht der vor den
Stresstests gespeicherten Konfiguration.

## Ergebnis

**Die vollständige Konfiguration mit neun Sensoren erreicht jetzt 50 Hz.**
Sound und Abstand blockieren die übrigen Sensoren nicht mehr.

| Messung im zweiminütigen Test | Ergebnis |
|---|---:|
| Empfangene Pakete | 6.000 |
| Paketrate | 49,999 Hz |
| Paketlücken / ungültiges JSON / Sensorfehler | 0 / 0 / 0 |
| Sound-Abtastrate | 16.129 Samples/s |
| Neue Sound-Fenster | 50,40/s |
| Neue Abstandsmessungen | 55,03/s |
| Größtes beobachtetes Alter des Sound-Fensters | 19 ms |
| Größtes beobachtetes Alter der Abstandsmessung | 17 ms |
| Abstand zwischen empfangenen Paketen, p99 | 21,63 ms |
| Größter Host-Paketabstand | 27,71 ms |
| Freier Heap zu Beginn und Ende | 249.836 Bytes |

Die Alter beziehen sich auf den Zeitpunkt der Übernahme in der Firmware,
nicht auf die gesamte physikalische Verzögerung inklusive Messfenster,
Medianfilter, USB und Browserdarstellung.

## Umsetzung

- **Gemeinsame Ausgabe alle 20 ms.** Die Zeitplanung bleibt auf einem festen
  Raster. Nach längeren Pausen werden verpasste Termine übersprungen.
- **ADC1 mit DMA:** Die Hardware erfasst alle benötigten ADC1-Pins fortlaufend.
  Slider, Licht, Magnet und Joystick lesen den aktuellen Wert aus diesem Puffer.
  ADC1 wird dabei nicht gleichzeitig mit `analogRead()` betrieben.
- **Sound:** 16.000 Samples/s je Kanal eingestellt, Spitze-zu-Spitze aus jeweils
  320 Samples. Durch die Hardware-Taktteilung ergeben sich im Test etwa
  16.129 Samples/s und knapp 20 ms je Fenster. Skalierung und `smoothingMs`
  bleiben wie bisher nutzbar; das frühere blockierende 25-ms-Fenster entfällt.
- **ADC-Gesamtgrenze:** Ab sechs aktiven ADC1-Pins reduziert die Firmware die
  Rate je Kanal, sodass die eingestellte Summe höchstens 80.000 Samples/s beträgt.
  Die Fenstergröße wird entsprechend angepasst. Ohne Sound werden 1.000
  Samples/s je Kanal eingestellt; DMA-Blöcke decken dann 8 ms ab.
- **ADC2:** Joysticks an C3/C4 werden weiterhin direkt bei der Ausgabe gelesen.
- **Abstand:** 20-ms-Messbudget und Abfrage der Fertigmeldung alle 2 ms. Nur bei
  fertiger Messung werden Ergebnisregister gelesen und der Interrupt quittiert.
  Die blockierende Wartefunktion der Bibliothek wird nicht mehr verwendet.
- **Frische Daten:** Abstandswerte werden bei fehlenden Ergebnissen nach 100 ms
  ungültig; ADC/Sound melden fehlende Daten mit `null` und einem Fehlerfeld.
  Nach langem Rückstau werden alte DMA-Daten und unvollständige Sound-Fenster
  verworfen. Der Medianfilter startet mit dem ersten echten Abstandswert.
- **Konfigurationswechsel:** DMA wird vor dem Freigeben alter Sensoren gestoppt
  und erst nach dem Initialisieren sämtlicher neuer Sensoren wieder gestartet.

Die geringere Abstandsmesszeit kann stärkeres Rauschen oder eine geringere
Reichweite verursachen. Die vorhandene Medianfilterung bleibt aktiv. Es wurden
Durchsatz und gültige Messungen am vorhandenen Aufbau geprüft; eine vollständige
Genauigkeitsmessung über verschiedene Materialien und Entfernungen war nicht
Teil dieses Tests.

## Weitere Gerätetests

Insgesamt **35 Messphasen mit 13.514 Paketen**, nach kurzen Einschwingzeiten:

- vollständige Konfiguration, Konfiguration ohne Sound;
- einzelner Slider, einzelner Sound-Kanal und leere Konfiguration;
- fünf Sound-Kanäle, ADC1-Joystick und zusätzlicher ADC2-Joystick: 50 Hz Ausgabe,
  etwa 11.521 Samples/s je Sound-Kanal, keine Fehler oder DMA-Überläufe während
  der Erfassung. Zusätzliche Kanäle waren teilweise unbeschaltet; dieser Test
  prüft Abfrage und Datenmenge, nicht deren Sensorfunktion;
- fünf Konfigurationswechsel plus 20 weitere Wiederholungen zur Prüfung der
  Ressourcenfreigabe; freier Heap in diesen 20 Phasen zwischen 249.472 und
  249.592 Bytes, ohne fortlaufenden Speicherverlust;
- Schließen und Öffnen des seriellen Ports;
- fünf Sekunden ohne Lesen und anschließende Erholung. Rückstau und mögliche
  beschädigte Zeilen wurden vor der Erholungsmessung zwei Sekunden abgearbeitet;
  die anschließenden zehn Sekunden waren wieder fehlerfrei bei 50 Hz.

Die Behauptung „keine Paketlücken“ bezieht sich auf die erfassten Phasen, nicht
auf Konfigurationswechsel, die absichtliche Empfangspause oder Einschwingzeiten.
Ein blockierter Host kann weiterhin Daten verlieren; die Firmware ist kein
verlustfreier Audiorekorder.

## Automatische Prüfungen

- `test_analog_sampler.py`: realer Sampler mit simuliertem DMA-Treiber;
  Kanalzuordnung, Fenstergrenzen, Spitzenwerte, veraltete Daten, Überlauf,
  Frequenzbegrenzung und Ressourcenfreigabe bei Startfehlern bestanden.
- `test_lifecycle.py`: echte Manager-/VL53L0X-Klassen mit simuliertem Bus;
  Reservierung, wiederholte Neukonfiguration, Halten des letzten Werts bei
  laufender Messung, Timeout und Fehlerfälle bestanden.
- `test_serial_replay.mjs`: echte Website-Parserklasse mit aufgezeichneten
  Paketen, verschiedenen Chunkgrößen, UTF-8 und ungültiger Zeile bestanden.
  Dies ist ein Node-Test, kein Browser-/Rendering-Benchmark.
- PlatformIO-Builds für Diagnose und normalen Betrieb erfolgreich.

## Wiederholen

Im Verzeichnis `platformio` (Ergebnisdateien werden überschrieben):

```sh
pio run -e sensor-shield-stress -t upload
python diagnostics/test_continuous_device.py
python diagnostics/test_continuous_device.py --edges
python diagnostics/test_analog_sampler.py
python diagnostics/test_lifecycle.py
node diagnostics/test_serial_replay.mjs
pio run -e sensor-shield -t upload
python diagnostics/verify_stress_normal.py --out diagnostics/continuous-test --min-hz 49 --reapply
```

Die Gerätetests setzen für die ursprüngliche Konfiguration B2=Sound und B3=Slider
voraus. Sie ändern Testkonfigurationen nur im RAM und stellen am Ende die
ursprüngliche Konfiguration wieder her. Der normale Abschlusstest mit `--reapply`
sendet diese identische Konfiguration einmal über den regulären NVS-Speicherpfad.
Nach einem abgebrochenen Test den normalen Build zurückspielen; ein Neustart
lädt ebenfalls die gespeicherte Konfiguration.

Technische Grundlage: Espressif beschreibt die gemeinsame Verwendung von
[ADC Continuous und Oneshot](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/peripherals/adc/adc_continuous.html).
Die lokale ESP32-S3-SDK-Konfiguration begrenzt die angeforderte Gesamtfrequenz
auf 83.333 Samples/s. Das
[VL53L0X-Datenblatt](https://www.st.com/resource/en/datasheet/vl53l0x.pdf)
beschreibt den schnellen Messmodus mit 20 ms Messbudget.

## Abschluss am Gerät

Der normale Build wurde erfolgreich hochgeladen. Der Abschlusstest bestätigte
50 Hz mit allen neun ursprünglichen Sensoren ohne Diagnosefelder im JSON.
Die identische Sensorkonfiguration wurde über den regulären Pfad erneut
angewendet und erfolgreich in NVS gespeichert (`persisted: true`). Auch der
Timeout bei unvollständiger Eingabe und das Zurückweisen einer ungültigen
Konfiguration bestanden im normalen Build. Belege: `normal-verification.json`.
Der Test hat den seriellen Port geschlossen; er ist wieder für die Website frei.

## Ergänzung: gespeicherte Glättungsänderungen

Die RAM-Konfigurationswechsel dieses Tests deckten einen Fehler beim Speichern
geänderter Einstellungen nicht ab. Der [gezielte NVS-Test](../config-test/RESULT.md)
dokumentiert die spätere Reproduktion und Korrektur. Die obigen Messungen sind
historische Ergebnisse des damaligen Builds. Große Rohlogs wurden beim Aufräumen
entfernt; die kompakten Zusammenfassungen bleiben erhalten.
