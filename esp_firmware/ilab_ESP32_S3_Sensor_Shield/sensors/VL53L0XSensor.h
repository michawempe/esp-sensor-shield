#pragma once
#include "SensorBase.h"
#include "MappingUtils.h"

#include <Wire.h>
#include <VL53L0X.h>
#include <math.h>

class VL53L0XSensor : public SensorBase {
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

  // busIndex MUST be declared before wire: member init order follows declaration order.
  int busIndex;
  TwoWire wire;

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
    : busIndex(claimBus()),
      wire(busIndex >= 0 ? (uint8_t)busIndex : 0),
      pinScl(cfgPinScl), pinSda(cfgPinSda),
      inMin(cfgInMin), inMax(cfgInMax), outMin(cfgOutMin), outMax(cfgOutMax)
  {
    setPortId(pid);
    setName(sensorName);
  }

  ~VL53L0XSensor() {
    if (busIndex >= 0) {
      if (initialized) lox.stopContinuous();
      wire.end();
      releaseBus(busIndex);
    }
  }

  void begin() override {
    hasReading = false;
    rawMm = 0;
    value = NAN;
    initialized = false;
    if (busIndex < 0) {
      Serial.println("{\"error\":\"no_i2c_bus\",\"msg\":\"max 2 distance sensors supported\"}");
      return;
    }
    wire.begin(pinSda, pinScl);
    wire.setClock(400000);
    lox.setBus(&wire);
    lox.setTimeout(500);
    initialized = lox.init();
    if (initialized) {
      lox.setMeasurementTimingBudget(200000);
      lox.startContinuous(0);
    }
    for (int i = 0; i < MEDIAN_SIZE; i++) buf[i] = 0;
    idx = 0;
  }

  void read() override {
    hasReading = false;
    rawMm = 0;
    value = NAN;
    if (!initialized) return;

    const uint16_t d = lox.readRangeContinuousMillimeters();
    if (lox.timeoutOccurred() || d == 0 || d > 8000) return;
    buf[idx] = d;
    idx = (idx + 1) % MEDIAN_SIZE;
    rawMm = median5(buf);
    hasReading = true;
    value = mapClamped((float)rawMm, inMin, inMax, outMin, outMax);
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

    json += ",\"inMin\":";
    appendFloat(json, inMin);
    json += ",\"inMax\":";
    appendFloat(json, inMax);
    json += ",\"outMin\":";
    appendFloat(json, outMin);
    json += ",\"outMax\":";
    appendFloat(json, outMax);
    json += "}";
  }
};
