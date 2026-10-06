#pragma once
#include "SensorBase.h"
#include "../runtime/AnalogSampler.h"
#include "MappingUtils.h"
#include "SmoothingFilter.h"

class HallSensor : public SensorBase {
  SmoothingFilter smoothing;
  uint8_t pin;
  bool valid = false;
  int rawAdc = 0;
  float value = 0.0f;
  float inMin;
  float inMax;
  float outMin;
  float outMax;

public:
  HallSensor(const char* pid, const char* sensorName, uint8_t p,
             float cfgInMin, float cfgInMax, float cfgOutMin, float cfgOutMax)
    : pin(p), inMin(cfgInMin), inMax(cfgInMax), outMin(cfgOutMin), outMax(cfgOutMax) {
    setPortId(pid);
    setName(sensorName);
  }

  void begin() override {
    smoothing.reset();
    analogSampler.addPin(pin);
  }

  void read() override {
    valid = analogSampler.ready(pin);
    if (!valid) { smoothing.reset(); return; }
    rawAdc = analogSampler.read(pin);
    value = smoothing.update(mapClamped((float)rawAdc, inMin, inMax, outMin, outMax), millis(), smoothingMs);
  }

  void appendJson(String& json) override {
    appendQuoted(json, name);
    json += ":{";
    json += "\"type\":\"magnet\",\"port\":";
    appendQuoted(json, portId);
    json += ",\"raw\":";
    if (valid) json += rawAdc; else json += "null";
    json += ",\"value\":";
    if (valid) appendFloat(json, value); else json += "null";
    if (!valid) json += ",\"error\":\"adc_not_ready\"";
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
