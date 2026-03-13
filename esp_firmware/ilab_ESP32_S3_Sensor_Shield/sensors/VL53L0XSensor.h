#pragma once
#include "SensorBase.h"
#include "MappingUtils.h"

#include <Wire.h>
#include <VL53L0X.h>
#include <math.h>

class VL53L0XSensor : public SensorBase {
  static constexpr int MEDIAN_SIZE = 5;

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
    : pinScl(cfgPinScl), pinSda(cfgPinSda),
      inMin(cfgInMin), inMax(cfgInMax), outMin(cfgOutMin), outMax(cfgOutMax) {
    setPortId(pid);
    setName(sensorName);
  }

  void begin() override {
    Wire.begin(pinSda, pinScl);
    Wire.setClock(400000);
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
