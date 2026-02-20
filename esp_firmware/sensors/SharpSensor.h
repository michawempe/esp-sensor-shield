#pragma once
#include "SensorBase.h"
#include "MappingUtils.h"
#include <math.h>

class SharpSensor : public SensorBase {
  uint8_t pin;
  float rawCm = NAN;
  float value = NAN;
  float inMin;
  float inMax;
  float outMin;
  float outMax;

  static float gp2y0a21CmFromAdc(int adc) {
    const float v = (adc / 4095.0f) * 3.3f;
    if (v < 0.1f) return NAN;

    float d = 27.86f / (v - 0.42f);
    if (d < 5.0f) d = 5.0f;
    if (d > 150.0f) d = 150.0f;
    return d;
  }

public:
  SharpSensor(const char* pid, const char* sensorName, uint8_t p,
              float cfgInMin, float cfgInMax, float cfgOutMin, float cfgOutMax)
    : pin(p), inMin(cfgInMin), inMax(cfgInMax), outMin(cfgOutMin), outMax(cfgOutMax) {
    setPortId(pid);
    setName(sensorName);
  }

  void begin() override {
    analogSetPinAttenuation(pin, ADC_11db);
  }

  void read() override {
    const int adc = analogRead(pin);
    rawCm = gp2y0a21CmFromAdc(adc);
    value = isnan(rawCm) ? NAN : mapClamped(rawCm, inMin, inMax, outMin, outMax);
  }

  void appendJson(String& json) override {
    appendQuoted(json, name);
    json += ":{";
    json += "\"type\":\"distance\",\"port\":";
    appendQuoted(json, portId);
    json += ",\"raw\":";
    if (isnan(rawCm)) {
      json += "null";
    } else {
      appendFloat(json, rawCm, 2);
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
