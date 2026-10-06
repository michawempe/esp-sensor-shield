# Sensor-Testseite: Browserprüfung

06.10.2026, lokales Chrome, Desktop 1440 × 1100 und Mobilansicht 390 × 844.

- Reale Paketstruktur aus dem ESP-Abschlusstest über einen nachgebildeten
  Web-Serial-Port; Ausgabe mit 50 Hz angefordert.
- Slider, Sound, Joystick, Abstand und Encoder für die Leistungsprüfung
  gleichzeitig mit synthetischen Bewegungen angesteuert.
- Zehn Messpunkte im Abstand von 500 ms: Empfang 47–50 Pakete/s, Darstellung
  54–60 Frames/s; letzter Messpunkt 50 Pakete/s und 60 Frames/s.
- Sensorzuordnung, aktive Low-Eingänge, Joystickachsen, Encoderposition,
  Vergrößerung, fehlende Messwerte, Datenpause mit Erholung, Trennen und
  Konfigurationswechsel bestanden.
- Keine horizontal überlaufende Seite in der Mobilansicht; keine JavaScript-
  Ausnahmen. Sensornamen mit HTML-Zeichen bleiben einfacher Text.
- Reine Zuordnungstests in `sensor-visuals.mjs` bestanden ebenfalls.

Die Browserprüfung ist keine Bestätigung des nativen USB-Auswahldialogs. Dieser
muss beim ersten Verbinden in normalem Chrome/Edge bedient werden und ließ sich
in der Headless-Prüfung nicht automatisiert abschließen. Die echte Firmware und
USB-Ausgabe wurden separat am Gerät geprüft, siehe
[Hardware-Messbericht](../../platformio/diagnostics/continuous-test/RESULT.md).

Die Kreise übernehmen Messwerte ohne zusätzliche zeitliche Glättung. Gemeinsame
Zahlenformatierung und unveränderte DOM-Werte werden wiederverwendet, um unnötige
Arbeit bei jedem Paket zu vermeiden. Auf anderen Rechnern oder in Hintergrund-
Tabs können Bild- und Empfangsraten abweichen; die Seite zeigt diese live an.
