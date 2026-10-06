# Tests

Run from `platformio/`:

```sh
python3 diagnostics/test_analog_sampler.py
python3 diagnostics/test_lifecycle.py
c++ -std=c++17 diagnostics/test_smoothing.cpp -o /tmp/ilab-test-smoothing
/tmp/ilab-test-smoothing
node diagnostics/test_serial_replay.mjs
```

These tests use simulated drivers and recorded Serial data. They cover DMA,
sensor reconfiguration, smoothing and JSON parsing.

## Hardware tests

With normal firmware and a current config export matching the attached sensors:

```sh
python diagnostics/test_config_persistence.py --config /path/to/config.json --cycles 36
```

This test writes smoothing changes to flash and restores the supplied config
at the end. If interrupted, restore that file through the config editor.
Disconnect the browser before running it. Device scripts require `pyserial`.

For timing tests with `sensor-shield-stress`, follow the
[continuous acquisition test](continuous-test/RESULT.md). Restore normal firmware
when finished.

## Results

- [Acquisition](continuous-test/RESULT.md): nine sensors, 6,000 packets in two
  minutes at 49.999 Hz, no sensor errors during the measured phase.
- [Config persistence](config-test/RESULT.md): 36 changes plus restoration,
  2,238 packets without sensor errors after warmup. ADC now starts after saving.
- [Earlier rate tests](stress-test/RESULT.md): results before continuous sampling.

The VL53L0X is reset before initialization to allow repeated configuration.
These tests check operation and throughput; they do not establish sensor accuracy.
Summaries are kept here; raw logs and build output are ignored by Git.
