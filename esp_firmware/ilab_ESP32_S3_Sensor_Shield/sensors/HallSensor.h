#pragma once
#include "SensorBase.h"
#include "MappingUtils.h"
#include "SmoothingFilter.h"

class HallSensor : public SensorBase {
  SmoothingFilter smoothing;
  uint8_t pin;
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
    analogSetPinAttenuation(pin, ADC_11db);
  }

  void read() override {
    rawAdc = analogRead(pin);
    value = smoothing.update(mapClamped((float)rawAdc, inMin, inMax, outMin, outMax), millis(), smoothingMs);
  }

  void appendJson(String& json) override {
    appendQuoted(json, name);
    json += ":{";
    json += "\"type\":\"magnet\",\"port\":";
    appendQuoted(json, portId);
    json += ",\"raw\":";
    json += rawAdc;
    json += ",\"value\":";
    appendFloat(json, value);
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
