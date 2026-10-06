#!/usr/bin/env python3
"""Host regression: real manager/sensor headers, simulated Wire and VL53L0X.
No claim about physical timing or ESP32 driver behavior; run with python3.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
FIRMWARE = ROOT / 'esp_firmware/ilab_ESP32_S3_Sensor_Shield'
HISTORICAL_REV = 'a063468906ae92e5051f8bc4457ffc55d9169b65'
ARDUINO = r'''
#pragma once
#include <string>
#include <type_traits>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cmath>
class String : public std::string {
public:
  using std::string::string;
  using std::string::operator+=;
  String(double v, unsigned int digits) {
    char b[80]; snprintf(b, sizeof(b), "%.*f", int(digits), v); assign(b);
  }
  template<class T, typename std::enable_if<std::is_arithmetic<T>::value, int>::type = 0>
  String& operator+=(T v) { append(std::to_string(v)); return *this; }
};
struct SerialMock {
  void println(const char*) {}
  template<class... T> void printf(const char*, T...) {}
};
inline SerialMock Serial;
inline uint32_t mockMillis = 0;
inline uint32_t millis() { return ++mockMillis; }
inline void delay(uint32_t) {}
inline int xPortGetCoreID() { return 1; }
'''
WIRE = r'''
#pragma once
#include <cassert>
#include <cstdint>
class TwoWire {
  int id;
  bool started = false;
public:
  inline static bool active[2] = {};
  explicit TwoWire(uint8_t n) : id(n) { assert(n < 2); }
  ~TwoWire() { end(); }
  bool begin(int, int, uint32_t = 100000) {
    assert(!active[id]); active[id] = started = true; return true;
  }
  void end() { if (started) active[id] = started = false; }
  void setClock(uint32_t) {}
  void setTimeOut(uint16_t) {}
};
inline TwoWire Wire(0);
'''
LOX = r'''
#pragma once
#include "Wire.h"
class VL53L0X {
  TwoWire* bus = &Wire;
public:
  enum { SOFT_RESET_GO2_SOFT_RESET_N = 0xBF, IDENTIFICATION_MODEL_ID = 0xC0, RESULT_INTERRUPT_STATUS = 0x13, RESULT_RANGE_STATUS = 0x14, SYSTEM_INTERRUPT_CLEAR = 0x0B };
  inline static bool resetWorks = true;
  bool resetting = false;
  void writeReg(uint8_t reg, uint8_t value) {
    if (reg == SOFT_RESET_GO2_SOFT_RESET_N) resetting = value == 0;
  }
  uint8_t readReg(uint8_t reg) {
    if (reg == IDENTIFICATION_MODEL_ID) return resetting && resetWorks ? 0 : 0xEE;
    if (reg == RESULT_INTERRUPT_STATUS) return timeout ? 0 : 7;
    return 55;
  }
  uint16_t readReg16Bit(uint8_t) { return measurement; }
  inline static bool initOk = true;
  inline static bool timeout = false;
  inline static uint16_t measurement = 250;
  uint8_t last_status = 0;
  void setBus(TwoWire* p) { bus = p; }
  void setTimeout(uint16_t) {}
  bool init() { assert(bus); return initOk; }
  bool setMeasurementTimingBudget(uint32_t) { return true; }
  void startContinuous(uint32_t = 0) {}
  void stopContinuous() {}
  uint16_t readRangeContinuousMillimeters() { return measurement; }
  bool timeoutOccurred() { bool t = timeout; timeout = false; return t; }
};
'''
TEST = r'''
#include "runtime/SensorManager.h"
#include "sensors/VL53L0XSensor.h"
#include <cassert>
SensorManager sensorManager;
VL53L0XSensor* make(const char* port, const char* name) {
  return new VL53L0XSensor(port, name, 4, 5, 0, 1000, 0, 1);
}
String data() { String s; sensorManager.appendAllJson(s); return s; }
int main() {
  // Exact ConfigManager ordering: construct replacements, clear old, add new.
  sensorManager.add(make("C1", "old"));
  auto* a = make("C1", "first");
  auto* b = make("C2", "second");
  sensorManager.clear(); sensorManager.add(a); sensorManager.add(b);
  for (int i=0; i<5; ++i) sensorManager.readAll();
  if (data().find("\"raw\":null") != std::string::npos) { sensorManager.clear(); return 42; }
  // Repeat two -> two, then clear -> two, and ensure staged rollback is inert.
  for (int iteration=0; iteration<10; ++iteration) {
    a = make("C1", "first"); b = make("C2", "second");
    sensorManager.clear(); sensorManager.add(a); sensorManager.add(b);
    auto* unused = make("C3", "rejected"); delete unused;
    for (int i=0; i<5; ++i) sensorManager.readAll();
    assert(data().find("\"raw\":null") == std::string::npos);
  }
#if ILAB_NONBLOCKING_TEST
  VL53L0X::timeout = true; mockMillis += 3; sensorManager.readAll();
  // No new range yet: retain the last valid sample, never wait in read().
  assert(data().find("\"raw\":null") == std::string::npos);
#endif
  VL53L0X::timeout = true; mockMillis += 700; sensorManager.readAll();
  assert(data().find("measurement_timeout") != std::string::npos);
  assert(data().find("\"raw\":null") != std::string::npos);
  VL53L0X::timeout = false; mockMillis += 3; sensorManager.readAll();
  assert(data().find("\"raw\":null") == std::string::npos);
  VL53L0X::measurement = 8190; sensorManager.readAll();
  assert(data().find("out_of_range") != std::string::npos);
  sensorManager.clear(); assert(!TwoWire::active[0] && !TwoWire::active[1]);
  VL53L0X::initOk = false; sensorManager.add(make("C1", "bad"));
  sensorManager.readAll(); assert(data().find("vl53l0x_init_failed") != std::string::npos);
  sensorManager.clear();
  VL53L0X::resetWorks = false;
  sensorManager.add(make("C1", "reset_failed"));
  sensorManager.readAll();
  assert(data().find("vl53l0x_reset_failed") != std::string::npos);
  sensorManager.clear();
  VL53L0X::resetWorks = true;
  VL53L0X::initOk = true; VL53L0X::measurement = 250;
  sensorManager.add(make("C1", "first")); sensorManager.add(make("C2", "second"));
  sensorManager.add(make("C3", "third"));
  assert(data().find("no_i2c_bus") != std::string::npos);
  sensorManager.clear(); assert(!TwoWire::active[0] && !TwoWire::active[1]);
}
'''
with tempfile.TemporaryDirectory(prefix='vl53-lifecycle-') as tmp:
    d = Path(tmp)
    for sub in ['sensors', 'runtime']:
        (d/sub).mkdir()
    for f in ['sensors/SensorBase.h', 'sensors/MappingUtils.h', 'sensors/SmoothingFilter.h', 'runtime/SensorManager.h']:
        shutil.copyfile(FIRMWARE/f, d/f)
    for name, code in [('Arduino.h', ARDUINO), ('Wire.h', WIRE), ('VL53L0X.h', LOX), ('test.cpp', TEST)]:
        (d/name).write_text(code)
    (d/'runtime/AnalogSampler.h').write_text('struct AnalogSampler { void reset() {} bool start() { return true; } void poll() {} }; inline AnalogSampler analogSampler;')
    current = (FIRMWARE/'sensors/VL53L0XSensor.h').read_text()
    original = subprocess.check_output(['git', '-C', str(ROOT), 'show', HISTORICAL_REV + ':esp_firmware/ilab_ESP32_S3_Sensor_Shield/sensors/VL53L0XSensor.h'], text=True)
    for label, code, diag, expected in [('HEAD regression', original, 0, 42), ('current', current, 0, 0), ('diagnostics', current, 1, 0)]:
        (d/'sensors/VL53L0XSensor.h').write_text(code)
        subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-fsanitize=undefined', f'-DILAB_VL53_DIAGNOSTICS={diag}', f'-DILAB_NONBLOCKING_TEST={int(label != "HEAD regression")}', '-I'+str(d), str(d/'test.cpp'), '-o', str(d/'test')], check=True)
        result = subprocess.run([str(d/'test')])
        assert result.returncode == expected, (label, result.returncode, expected)
        print(f'{label}: PASS (exit {expected})')
