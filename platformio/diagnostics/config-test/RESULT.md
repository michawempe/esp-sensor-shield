# Glättungsänderung: ADC nach dem Speichern starten

Stand: 06.10.2026, normale Firmware, neun angeschlossene Sensoren.

## Reproduktion und Korrektur

Änderungen der Slider-Glättung über das normale JSON-Kommando führten bei vier
von sechs Versuchen zu dauerhaft fehlenden ADC-Daten. Sound meldete
`sound_not_ready`; Slider, Licht und Joystick meldeten `adc_not_ready`.
Auch die anschließende Wiederherstellung war betroffen. Die Config wurde jeweils
mit `persisted: true` bestätigt. Beleg: [before.json](before.json).

Bisher startete `ConfigManager::apply()` die ADC-Erfassung, bevor
`persistConfig()` die Einstellungen in NVS schrieb. Jetzt kann `apply()` den
Start aufschieben. Der reguläre Config-Pfad speichert zuerst und startet danach
die ADC-Erfassung, auch wenn das Speichern fehlschlägt. Beim Laden der Config
nach dem Boot und bei flüchtigen Stress-Kommandos erfolgt der Start wie bisher.
Ungültige Configs lassen die laufende Erfassung unverändert.

Die lokale SDK-Konfiguration aktiviert `CONFIG_ADC_CONTINUOUS_ISR_IRAM_SAFE`
nicht. Die Espressif-Dokumentation beschreibt die
[IRAM-Anforderungen des ADC-Treibers](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/adc/adc_continuous.html#iram-safe).
Das passt zu einer Unterbrechung durch Flash-Zugriffe. Die Wirkung der geänderten
Reihenfolge ist am Gerät belegt; der genaue interne DMA-Zustand beim Ausfall
wurde nicht separat instrumentiert.

## Verifikation

- 36 Config-Änderungen über den regulären Flash-Speicherpfad plus Wiederherstellung.
- Glättung 0, 25, 100, 250, 1.000 und 10.000 ms, jeweils für Sound, Slider,
  Licht, Joystick und Abstand.
- 2238 geprüfte Pakete nach jeweils 300 ms Anlaufzeit: keine `null`-Werte,
  keine Sensorfehler, korrekte Glättungsparameter, alle neun Sensoren vorhanden.
- Gemessene Rate in den einzelnen Phasen: 49,68–50,18 Hz.
- Normale Firmware gebaut und hochgeladen; beide Diagnose-Builds ebenfalls gebaut.
- Hosttests für DMA, Sensorlebensdauer, Glättung, Serial-Parser und Web-Mapping bestanden.

Direkt während einer Neukonfiguration wird die Erfassung weiterhin kurz
unterbrochen. Die Prüfung schließt die ersten 300 ms aus und belegt die Erholung,
nicht eine lückenlose Ausgabe während des Wechsels. Die unveränderte Hardware
und die Genauigkeit der Sensorsignale wurden damit nicht neu bewertet.

Belege: [Testphasen](summary.json), [wiederhergestellte Config](original-config.json),
[Firmware-Hash](normal-firmware.sha256). Der Abschlusstest mit normaler Firmware
liegt in [normal-verification.json](normal-verification.json).

Wiederholen aus `platformio` mit einem aktuellen Config-Export:

```sh
python diagnostics/test_config_persistence.py --config /pfad/zum/export.json --cycles 36
```

Der Test schreibt Einstellungen in NVS und stellt die übergebene Config am Ende
wieder her. USB-Serial muss währenddessen in der Webseite getrennt sein.
