# Hardware-Stresstest

Historischer Stand vor der getrennten Erfassung. Die aktuelle Firmware und ihre
50-Hz-Messungen mit allen Sensoren sind im [Folgebericht](../continuous-test/RESULT.md) dokumentiert.

Stand: 06.10.2026. Ausgangsrevision: `7848315`.

Die aktuelle Testreihe verwendet das in `device.json` angegebene Board und die
in `original-config.json` gesicherte Konfiguration. Testeinstellungen werden nur
im RAM geändert; die gespeicherte NVS-Konfiguration wird nicht überschrieben.

Messwerte stehen fortlaufend in `summary.json`, Rohdaten lokal in `frames.jsonl`.
Die Messung läuft mit dem gesonderten PlatformIO-Environment `sensor-shield-stress`.
Der normale Build enthält weder Testkommandos noch zusätzliche Messfelder.

## Ergebnis und gewählter Standard

**50 Hz Sollrate sind für die schnellen Sensoren ein gut abgesicherter Standard.**
100 Hz und 200 Hz waren im achtsekündigen Kurztest ebenfalls ohne Paketlücken
möglich. Die beobachtete Sättigung lag je nach Paketgröße bei 250–333 Hz.
Diese Grenze gilt für dieses Board, diesen Rechner, den nativen USB-Port und den
Test-Build; sie ist keine allgemeine garantierte ESP32-Grenze.

**Die aktuelle gemischte Konfiguration bleibt bei etwa 5,1 Hz.** Der Abstandssensor
mit 200 ms Messbudget blockiert die gemeinsame Abfrage. Das Paket wartet auf alle
Sensoren. Ein kürzeres Sendeintervall beseitigt diese Grenze nicht.

Die normale Firmware ist auf 20 ms / 50 Hz Sollrate angepasst. Das Messbudget des
Abstandssensors bleibt 200 ms: kürzere Budgets wurden auf Durchsatz getestet,
aber nicht auf Messgenauigkeit über unterschiedliche Distanzen, Oberflächen und
Lichtverhältnisse. Sound behält sein 25-ms-Abfragefenster.

### Messwerte

Alle folgenden Kurztests liefen jeweils etwa acht Sekunden. Keine JSON-Fehler,
Sequenzlücken, Sensorfehler oder `null`-Werte in diesen Phasen.

| Konfiguration | Gemessen | Host-Abstand p99 |
|---|---:|---:|
| Aktuelle neun Sensoren, 25 Hz Soll | 5.09 Hz | 198.77 ms |
| Aktuelle neun Sensoren, 50 Hz Soll | 5.09 Hz | 199.51 ms |
| Sieben schnelle angeschlossene Sensoren, 50 Hz Soll | 49.99 Hz | 22.13 ms |
| Dieselben Sensoren, 100 Hz Soll | 100.02 Hz | 10.99 ms |
| Dieselben Sensoren, 200 Hz Soll | 200.03 Hz | 6.86 ms |
| Dieselben Sensoren, 1000 Hz Soll | 333.37 Hz | 3.64 ms |
| Elf Eingänge, 1000 Hz Soll | 250.00 Hz | 4.61 ms |
| Soundsensor allein, 50 Hz Soll | 39.85 Hz | 26.59 ms |
| Abstand allein, Messbudget 100 ms | 10.28 Hz | 98.73 ms |
| Abstand allein, Messbudget 50 ms | 20.86 Hz | 49.25 ms |
| Abstand allein, Messbudget 33 ms | 32.26 Hz | 32.11 ms |
| Abstand allein, Messbudget 20 ms | 55.00 Hz | 19.46 ms |

Die elf Eingänge waren sechs digitale und fünf analoge Kanäle. Nicht jeder davon
hatte einen physisch angeschlossenen Sensor; dieser Teil prüft Datenmenge und
Abfrageaufwand. Die sieben schnellen angeschlossenen Sensoren umfassen Schalter,
Taster, Slider, Licht, Joystick, Encoder und Touch.

Mit allen neun Sensoren und testweise 20 ms Abstandsmessbudget waren im separaten
zehnsekündigen Nachtest **35,68 Hz** erreichbar. Dann begrenzt insbesondere die
Sound-Abfrage. 50 echte Gesamtmessungen/s erfordern Änderungen an der Abfrage der
langsamen Sensoren, etwa getrennte Zeitpläne und nicht blockierende Messungen.

### Stabilität und Fehlerfälle

- **120 s bei 50 Hz:** 6.000 Pakete, keine Sequenzlücke, kein ungültiges JSON,
  kein Sensorfehler. Freier Heap durchgehend 288.392 Bytes. Host-Abstand p99
  22,12 ms, Maximum 23,85 ms; Geräteabstand p99 20,003 ms.
- Ungültiges JSON und eine überlange Zeile mit 8.300 Zeichen wurden korrekt
  abgewiesen. Die aktive Konfiguration blieb erhalten.
- 100 ungültige Kommandos als Burst wurden beantwortet; danach normaler Betrieb.
- **Gefundener Fehler:** Ein einzelnes `{` ohne Zeilenumbruch ließ die Ausgabe
  während des gesamten dreisekündigen Tests aussetzen. Im bisherigen Code gab
  es keine zeitliche Grenze; erst der abschließende Zeilenumbruch half.
- **Korrektur:** Nach 1 s ohne weitere Bytes wird `serial_line_timeout` gemeldet
  und die Sensorausgabe freigegeben. Der Rest der abgebrochenen Zeile wird bis
  zum nächsten Zeilenumbruch verworfen. Damit kann kein Reststück versehentlich
  als gültige neue Konfiguration interpretiert werden. Nach einem Abbruch erst
  `\n` senden, dann das vollständige Kommando wiederholen.
- **Fünf Sekunden ohne Lesen bei maximaler Rate:** vier fehlende Sequenznummern,
  eine unvollständige JSON-Zeile, anschließend selbstständige Erholung. Bei vollen
  Puffern kann die Übertragung Daten verlieren; das Protokoll garantiert keine
  verlustfreie Aufzeichnung. Der bestehende Web-Parser verwirft ungültige Zeilen.
  Die Host-Rate dieser Phase enthält das Aufholen gepufferter Pakete und darf
  nicht als Sensorfrequenz interpretiert werden.
- Seriellen Port schließen, zwei Sekunden warten und erneut öffnen: danach
  wieder 50 Hz ohne Fehler. Dies war kein physisches Abziehen des USB-Kabels.

### Website

Der echte `SerialJsonClient` wurde mit aufgezeichneten Paketen unter Node geprüft:
1.002 Frames pro Durchlauf, Chunkgrößen 1, 7, 64, 4.096 Bytes und ein kompletter
Block. Auch geteilte UTF-8-Zeichen, CRLF, mehrere Zeilen pro Chunk und eine
absichtlich ungültige Zeile wurden korrekt verarbeitet. Alle fünf Varianten
bestanden; selbst bei Einzelbytes etwa 1.868 Frames/s auf diesem Rechner.
Das ist ein Parser-Test, kein Browser-/Rendering-Benchmark.

Die automatische Konsolenausgabe der Demo ist auf höchstens zehn Einträge/s
begrenzt. `window.sensors` und beide Sensorereignisse erhalten weiter jedes
Datenpaket. Für Animationen zeigt die Web-README ein `requestAnimationFrame`-
Beispiel, das pro Darstellungsframe den neuesten Sensorstand verwendet.

### Umfang und Grenzen

Die erste Messreihe umfasst 29 Phasen und 25.413 empfangene Datenpakete über etwa
310 Sekunden reine Erfassungszeit. Sie ersetzt keinen mehrstündigen Dauertest.
Es wurden keine Stromausfälle, mechanischen Steckfehler, defekten Sensoren oder
Browser-Hintergrundtab-Szenarien simuliert. Bestehende Host-Tests für Glättung
(einschließlich unterschiedlicher Raten und Timerüberlauf) und den VL53L0X-
Lebenszyklus bestanden ebenfalls.

## Nachprüfung der Korrektur

`verification/summary.json` dokumentiert den Nachtest. Beide unterbrochenen
Eingaben (kurz und überlang) lösten genau einen Timeout aus; nach etwa einer
Sekunde lief die Sensorausgabe wieder. Ein nachfolgendes vollständiges
Testkommando wurde erfolgreich verarbeitet.

Weitere 60 s bei 50 Hz ergaben 3.000 Pakete ohne Lücken, JSON- oder Sensorfehler;
freier Heap durchgehend 288.352 Bytes. Sämtliche automatischen Nachtest-Assertions
bestanden. Die ursprüngliche Konfiguration wurde wieder aktiviert. Nach dem
Neustart durch den zweiten Upload entsprach die geladene gespeicherte
Konfiguration exakt der vor dem ersten Test gesicherten Konfiguration.

## Zustand nach Abschluss

Der normale PlatformIO-Build `sensor-shield` wurde erfolgreich hochgeladen und
am Gerät nochmals geprüft (`normal-verification.json`). Alle neun ursprünglichen
Sensoren liefern gültige Werte; die komplette Konfiguration läuft bei etwa
5,09 Hz. Test-Metadaten sind nicht mehr im Datenstrom. Timeout-Erholung und das
Abweisen einer ungültigen Konfiguration bestanden auch mit dem normalen Build.
Der serielle Port ist geschlossen und für die Website frei.

## Wiederholung

Im Ordner `platformio` (die Skripte überschreiben die gleichnamigen Ergebnisdateien;
vorher bei Bedarf sichern). Mit dem aktuellen Code zeigt auch die Phase
`partial_line_stall` bereits die korrigierte Erholung; der hier beschriebene
Stillstand stammt aus der ersten Messreihe vor dem Fix:

```sh
pio run -e sensor-shield-stress -t upload
python diagnostics/stress_rates.py
node diagnostics/test_serial_replay.mjs
python diagnostics/stress_rates.py --verify --out diagnostics/stress-test/verification
pio run -e sensor-shield -t upload
python diagnostics/verify_stress_normal.py
```

Python benötigt pyserial; die Python-Umgebung von PlatformIO enthält es.
Nur ein Programm darf den seriellen Port verwenden. Am Ende immer den normalen
Build zurückspielen, auch nach einem abgebrochenen Test. Ein Neustart des
Test-Builds lädt ebenfalls die unveränderte gespeicherte Sensorkonfiguration.

## Messmethode

- Hostzeit: Zeitpunkt einer vollständig empfangenen JSON-Zeile, keine Einweglatenz.
- Gerätezeit: `micros()` vor dem Senden; Sensorlesedauer separat erfasst.
- Sequenznummern erkennen Lücken innerhalb einer Testphase.
- Wechsel zwischen Phasen sind bewusst keine lückenlose Aufzeichnung.
- Freier Heap wird pro Datenpaket erfasst.
- Die Diagnosefelder vergrößern die Pakete etwas gegenüber dem normalen Build.
- Eingänge ohne bekannte angeschlossene Sensoren dienen nur dem Durchsatztest.
- JavaScript-Replay prüft den echten Website-Parser unter Node; es misst weder
  Browserdarstellung noch echtes WebSerial.
