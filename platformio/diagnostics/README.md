# Tests

Run from `platformio/`:

```sh
python3 diagnostics/test_analog_sampler.py
python3 diagnostics/test_lifecycle.py
c++ -std=c++17 diagnostics/test_smoothing.cpp -o /tmp/ilab-test-smoothing
/tmp/ilab-test-smoothing
node diagnostics/test_serial_replay.mjs
node ../web/admin/tests/smoothing.mjs
node diagnostics/web-sensortest/sensor-visuals.mjs
```

These tests use simulated drivers and recorded Serial data. They cover DMA,
sensor reconfiguration, smoothing, JSON parsing and web sensor mapping. The
default Serial replay repeats a recorded frame and adds parser edge cases
(202 valid frames for each of five chunk sizes); an optional recording path
and phase name select a larger local recording.

## Web sensor display tests

`web-sensortest/` contains development tests for the sensor display; they are
not required for everyday use and are not loaded by the website. The mapping
test is included above. The browser test checks behavior and performance using
simulated Serial input, without an attached board.

For the browser test, serve `web/` on port 8765 (using Live Server or
`python3 -m http.server 8765 --directory ../web` from `platformio/`). Then run:

```sh
node diagnostics/web-sensortest/sensor-page.mjs
```

It needs local Chrome and `playwright-core`. Set `ILAB_PLAYWRIGHT_MODULE` to the
package's `index.mjs` if installed elsewhere. Set `ILAB_TEST_URL` to the full
sensor-test page URL if your server uses a different port or base path.
[Recorded results and limits](web-sensortest/RESULT.md) include a later run that
failed the stored 40 FPS performance threshold.

## Hardware tests

With normal firmware and a current config export matching the attached sensors:

```sh
python3 diagnostics/test_config_persistence.py --config /path/to/config.json --cycles 36
```

This test writes smoothing changes to flash and restores the supplied config
at the end. If interrupted, restore that file through the config editor.
Disconnect the browser before running it. Device scripts require `pyserial`.

For timing tests with `sensor-shield-stress`, follow the
[continuous acquisition test](continuous-test/RESULT.md). Restore normal firmware
when finished.

## Recorded results (6 October 2026)

- [Acquisition](continuous-test/RESULT.md): nine sensors, 6,000 packets in two
  minutes at 49.999 Hz, no sensor errors during the measured phase.
- [Config persistence](config-test/RESULT.md): 36 changes plus restoration,
  2,238 packets without sensor errors after warmup. ADC now starts after saving.
- [Earlier rate tests](stress-test/RESULT.md): results before continuous sampling.

These are historical measurements of the tested setup, not guaranteed rates
for every configuration or a new hardware test of the current checkout.
The VL53L0X is reset before initialization to allow repeated configuration.
These tests check operation and throughput; they do not establish sensor accuracy.
Summaries are kept here; raw logs and build output are ignored by Git.
