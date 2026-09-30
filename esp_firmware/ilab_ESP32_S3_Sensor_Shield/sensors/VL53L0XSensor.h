#pragma once
#include "SensorBase.h"
#include "MappingUtils.h"
#include "SmoothingFilter.h"

#include <Wire.h>
#include <VL53L0X.h>
#include <math.h>
#include <memory>
#include <new>

#ifndef ILAB_VL53_DIAGNOSTICS
#define ILAB_VL53_DIAGNOSTICS 0
#endif

class VL53L0XSensor : public SensorBase {
  SmoothingFilter smoothing;
  static constexpr int MEDIAN_SIZE = 5;

  // ESP32-S3 has two hardware I2C controllers (bus 0 and 1).
  // Each VL53L0X sensor claims one exclusively so multiple sensors on
  // different C-ports (different SDA/SCL pins) don't overwrite each other.
  // Maximum 2 distance sensors can be active simultaneously.
  inline static uint8_t s_busUsed = 0; // bitmask: bit0=bus0, bit1=bus1

  static int claimBus() {
    for (int i = 0; i < 2; i++) {
      if (!(s_busUsed & (1 << i))) {
        s_busUsed |= (1 << i);
        return i;
      }
    }
    return -1; // no hardware I2C bus available
  }

  static void releaseBus(int i) {
    if (i >= 0 && i < 2) s_busUsed &= ~(1 << i);
  }

  // ConfigManager constructs replacements before deleting the active sensors.
  // Claim hardware only in begin(), after the old configuration is released.
  int busIndex = -1;
  std::unique_ptr<TwoWire> wire;
  const char* readError = "not_initialized";

#if ILAB_VL53_DIAGNOSTICS
  uint32_t readMs = 0;
  uint32_t initMs = 0;
  uint32_t goodReads = 0;
  uint32_t timeouts = 0;
  uint32_t invalidReads = 0;
  uint16_t returnedMm = 0;
  int initStatus = -1;
  int readStatus = -1;
  bool budgetOk = false;
  int stopBeforeReset = -1;
  int stopAfterReset = -1;

  int readStopRegister() {
    lox.writeReg(0x80, 0x01);
    lox.writeReg(0xFF, 0x01);
    lox.writeReg(0x00, 0x00);
    const uint8_t value = lox.readReg(0x91);
    const bool ok = lox.last_status == 0;
    lox.writeReg(0x00, 0x01);
    lox.writeReg(0xFF, 0x00);
    lox.writeReg(0x80, 0x00);
    return ok ? value : -1;
  }

  void traceLifecycle(const char* event) {
    // Only numeric values and fixed strings: keep the serial JSON protocol intact.
    Serial.printf("{\"diag\":\"vl53_lifecycle\",\"event\":\"%s\","
                  "\"port\":\"%s\",\"bus\":%d,\"mask\":%u,"
                  "\"object\":\"%p\",\"wire\":\"%p\",\"core\":%d}\n",
                  event, portId, busIndex, (unsigned)s_busUsed,
                  (void*)this, (void*)wire.get(), (int)xPortGetCoreID());
  }
#else
  void traceLifecycle(const char*) {}
#endif

  uint8_t pinScl;
  uint8_t pinSda;

  uint16_t rawMm = 0;
  float value = NAN;
  bool hasReading = false;
  bool initialized = false;

  float inMin;
  float inMax;
  float outMin;
  float outMax;

  VL53L0X lox;
  uint16_t buf[MEDIAN_SIZE] = {0, 0, 0, 0, 0};
  int idx = 0;

  bool waitForModelId(uint8_t expected) {
    const uint32_t started = millis();
    do {
      const uint8_t id = lox.readReg(VL53L0X::IDENTIFICATION_MODEL_ID);
      if (lox.last_status == 0 && id == expected) return true;
      delay(1);
    } while ((uint32_t)(millis() - started) < 500);
    return false;
  }

  bool resetDevice() {
    // A new C++ object does not reset the powered sensor. In Pololu 1.3.1,
    // stopContinuous() clears the hardware register cached as stop_variable.
    // Re-initialize from reset, as in ST's VL53L0X_ResetDevice sequence.
    lox.writeReg(0xFF, 0x00);
    if (lox.last_status != 0) return false;
    lox.writeReg(VL53L0X::SOFT_RESET_GO2_SOFT_RESET_N, 0x00);
    const bool asserted = lox.last_status == 0 && waitForModelId(0x00);
    // Always release reset, including when the assertion/readback failed.
    lox.writeReg(VL53L0X::SOFT_RESET_GO2_SOFT_RESET_N, 0x01);
    const bool released = lox.last_status == 0 && waitForModelId(0xEE);
    return asserted && released;
  }

  static uint16_t median5(const uint16_t* a) {
    uint16_t b[MEDIAN_SIZE];
    for (int i = 0; i < MEDIAN_SIZE; i++) b[i] = a[i];
    for (int i = 0; i < MEDIAN_SIZE - 1; i++) {
      for (int j = i + 1; j < MEDIAN_SIZE; j++) {
        if (b[j] < b[i]) {
          const uint16_t t = b[i];
          b[i] = b[j];
          b[j] = t;
        }
      }
    }
    return b[MEDIAN_SIZE / 2];
  }

public:
  // pinScl/pinSda follow the board's 4-pin mapping in PortMap.h.
  VL53L0XSensor(const char* pid, const char* sensorName,
                uint8_t cfgPinScl, uint8_t cfgPinSda,
                float cfgInMin, float cfgInMax, float cfgOutMin, float cfgOutMax)
    : pinScl(cfgPinScl), pinSda(cfgPinSda),
      inMin(cfgInMin), inMax(cfgInMax), outMin(cfgOutMin), outMax(cfgOutMax)
  {
    setPortId(pid);
    setName(sensorName);
    traceLifecycle("constructed");
  }

  ~VL53L0XSensor() {
    traceLifecycle("destroying");
    if (busIndex >= 0) {
      if (initialized) lox.stopContinuous();
      // TwoWire::~TwoWire ends the controller. Destroy it before releasing ownership.
      wire.reset();
      releaseBus(busIndex);
      busIndex = -1;
    }
    traceLifecycle("released");
  }

  void begin() override {
    smoothing.reset();
    hasReading = false;
    rawMm = 0;
    value = NAN;
    if (initialized) lox.stopContinuous();
    initialized = false;
    if (busIndex < 0) busIndex = claimBus();
    traceLifecycle("claimed");
    if (busIndex < 0) {
      readError = "no_i2c_bus";
      Serial.println("{\"error\":\"no_i2c_bus\",\"msg\":\"max 2 distance sensors supported\"}");
      return;
    }
    if (!wire) wire.reset(new (std::nothrow) TwoWire((uint8_t)busIndex));
    if (!wire || !wire->begin(pinSda, pinScl, 400000)) {
      readError = "i2c_begin_failed";
      wire.reset();
      releaseBus(busIndex);
      busIndex = -1;
      return;
    }
    lox.setBus(wire.get());
    lox.setTimeout(500);
#if ILAB_VL53_DIAGNOSTICS
    const uint32_t initStart = millis();
#endif
#if ILAB_VL53_DIAGNOSTICS
    stopBeforeReset = readStopRegister();
#endif
    if (!resetDevice()) {
      readError = "vl53l0x_reset_failed";
      traceLifecycle("reset_failed");
      return;
    }
#if ILAB_VL53_DIAGNOSTICS
    stopAfterReset = readStopRegister();
#endif
    initialized = lox.init();
#if ILAB_VL53_DIAGNOSTICS
    initMs = millis() - initStart;
    initStatus = lox.last_status; // init() always performs a transaction first.
#endif
    readError = initialized ? nullptr : "vl53l0x_init_failed";
    if (initialized) {
#if ILAB_VL53_DIAGNOSTICS
      budgetOk = lox.setMeasurementTimingBudget(200000);
#else
      lox.setMeasurementTimingBudget(200000);
#endif
      lox.startContinuous(0);
    }
    for (int i = 0; i < MEDIAN_SIZE; i++) buf[i] = 0;
    idx = 0;
    traceLifecycle(initialized ? "started" : "init_failed");
  }

  void read() override {
    hasReading = false;
    rawMm = 0;
    value = NAN;
    if (!initialized) return;

#if ILAB_VL53_DIAGNOSTICS
    const uint32_t readStart = millis();
#endif
    const uint16_t d = lox.readRangeContinuousMillimeters();
#if ILAB_VL53_DIAGNOSTICS
    readMs = millis() - readStart;
    returnedMm = d;
    readStatus = lox.last_status; // Last transmission only, not all read errors.
#endif
    if (lox.timeoutOccurred()) {
#if ILAB_VL53_DIAGNOSTICS
      ++timeouts;
#endif
      smoothing.reset();
      readError = "measurement_timeout";
      return;
    }
    if (d == 0 || d > 8000) {
#if ILAB_VL53_DIAGNOSTICS
      ++invalidReads;
#endif
      smoothing.reset();
      readError = "out_of_range";
      return;
    }
#if ILAB_VL53_DIAGNOSTICS
    ++goodReads;
#endif
    readError = nullptr;
    buf[idx] = d;
    idx = (idx + 1) % MEDIAN_SIZE;
    rawMm = median5(buf);
    hasReading = true;
    value = smoothing.update(mapClamped((float)rawMm, inMin, inMax, outMin, outMax), millis(), smoothingMs);
  }

  void appendJson(String& json) override {
    appendQuoted(json, name);
    json += ":{";
    json += "\"type\":\"distance\",\"port\":";
    appendQuoted(json, portId);

    json += ",\"raw\":";
    if (hasReading) {
      json += rawMm;
    } else {
      json += "null";
    }

    json += ",\"value\":";
    if (isnan(value)) {
      json += "null";
    } else {
      appendFloat(json, value);
    }

    if (readError) {
      json += ",\"error\":";
      appendQuoted(json, readError);
    }

#if ILAB_VL53_DIAGNOSTICS
    json += ",\"diag\":{\"bus\":";
    json += busIndex;
    json += ",\"initialized\":";
    json += initialized ? "true" : "false";
    json += ",\"initMs\":"; json += initMs;
    json += ",\"initStatus\":"; json += initStatus;
    json += ",\"stopBeforeReset\":"; json += stopBeforeReset;
    json += ",\"stopAfterReset\":"; json += stopAfterReset;
    json += ",\"budgetOk\":"; json += budgetOk ? "true" : "false";
    json += ",\"returnedMm\":"; json += returnedMm;
    json += ",\"readMs\":"; json += readMs;
    json += ",\"lastTxStatus\":"; json += readStatus;
    json += ",\"goodReads\":"; json += goodReads;
    json += ",\"timeouts\":"; json += timeouts;
    json += ",\"invalidReads\":"; json += invalidReads;
    json += "}";
#endif

    json += ",\"inMin\":";
    appendFloat(json, inMin);
    json += ",\"inMax\":";
    appendFloat(json, inMax);
    json += ",\"outMin\":";
    appendFloat(json, outMin);
    json += ",\"outMax\":";
    appendFloat(json, outMax);
    appendSmoothingJson(json);
    json += "}";
  }
};
