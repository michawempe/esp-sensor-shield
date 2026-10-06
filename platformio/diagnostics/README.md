# Tests und Messergebnisse

## Aktueller Stand

Die Firmware erfasst analoge Sensoren kontinuierlich und veröffentlicht alle
20 ms einen Datensatz. Sound verwendet ungefähr 16 kHz je Kanal und ein
20-ms-Fenster; der Abstandssensor arbeitet mit 20 ms Messbudget.

Der [aktuelle Gerätetest](continuous-test/RESULT.md) erreichte mit neun Sensoren
6.000 Pakete in zwei Minuten, 49,999 Hz und keine Sensorfehler während dieser
Messphase. Die JSON-Zusammenfassungen bleiben als Belege erhalten. Das prüft
Durchsatz und Datenübertragung, nicht die Genauigkeit aller Sensoren.

Der [Test gespeicherter Glättungsänderungen](config-test/RESULT.md) ergänzt diese
Messung um den regulären Config-Pfad mit Flash-Schreibzugriff.

## Frühere Fehler und Korrekturen

- **Abstand nach Neukonfiguration:** I²C-Busse werden erst in `begin()` reserviert,
  nachdem die alten Sensoren freigegeben wurden. Zusätzlich wird der VL53L0X vor
  `init()` zurückgesetzt. Ohne diesen Reset waren nach Neukonfiguration trotz
  erfolgreichem `init()` dauerhaft Werte 8190/8191 beobachtet worden. Mit Reset
  bestanden Wiederkonfiguration und Neustart: 1.902 gültige Sensordatensätze in
  den damaligen drei Abschlusstests mit zwei Abstandssensoren.
- **Blockierende Erfassung:** Das frühere Sound-Fenster und das 200-ms-Budget des
  Abstandssensors begrenzten die gemeinsame Ausgabe auf etwa 5 Hz. Der
  [historische Stresstest](stress-test/RESULT.md) dokumentiert diesen alten Stand.
  Die heutige Erfassung verwendet DMA und fragt fertige Abstandsmessungen ab.
- **Unvollständige Serial-Kommandos:** Nach einer Sekunde ohne weitere Bytes wird
  der Empfang abgebrochen. Die Sensorausgabe läuft weiter; die unvollständige
  Zeile wird bis zum nächsten Zeilenumbruch verworfen.
- **Buildvergleich:** Arduino-Core 3.3.7 und die verwendeten Bibliotheken stimmten
  im lokalen Vergleich überein. Der frühere Arduino-Cache verwendete 4 MB Flash,
  PlatformIO 8 MB. Vollständige Gleichheit der damaligen Builds war nicht belegt.

## Wiederholbare Tests

Aus dem Verzeichnis `platformio`:

```sh
python3 diagnostics/test_analog_sampler.py
python3 diagnostics/test_lifecycle.py
c++ -std=c++17 diagnostics/test_smoothing.cpp -o /tmp/ilab-test-smoothing
/tmp/ilab-test-smoothing
node diagnostics/test_serial_replay.mjs
pio run -e sensor-shield
```

Die Hosttests simulieren Hardwaretreiber. Der Serial-Test verwendet standardmäßig
einen aufgezeichneten Datensatz aus `continuous-test/normal-verification.json`
mehrfach und prüft Chunkgrenzen, UTF-8 und ungültige Zeilen. Eine neue vollständige
Aufzeichnung kann als Dateipfad plus Phasenname übergeben werden.

Die Gerätetestbefehle stehen im [Messbericht](continuous-test/RESULT.md).
Sie benötigen den passenden Aufbau und exklusiven Zugriff auf USB-Serial.
`stress_rates.py` dient gezielten Ausgaberatenversuchen mit der Stress-Firmware;
seine historischen Ergebnisse beschreiben nicht die aktuelle Leistung.

## Aufräumen

Entfernt wurden die alten Zweiersensor-Testläufe samt speziell dafür geschriebenen
Skripten, bereits eingebaute Patchkopien, ausführliche überholte Analysen sowie
Rohaufzeichnungen und Upload-Logs. Frühere versionierte Dateien bleiben in Git
nachvollziehbar. Firmware, Webstruktur, Buildkonfiguration und aktuelle Tests
bleiben an ihren bisherigen Orten. Neue Rohlogs werden nicht versioniert.

Glättungsänderungen mit **normaler Firmware** gezielt prüfen:

```sh
python diagnostics/test_config_persistence.py --config /pfad/zum/aktuellen-export.json
```

Die Exportdatei muss den aktuellen Aufbau und die gewünschten Einstellungen
enthalten. Der Test verändert Glättungswerte im Flash und stellt die übergebene
Konfiguration zum Schluss wieder her. Nach einem Abbruch kann diese Datei auch
über die Webseite wieder eingespielt werden.
