#pragma once
#include "SensorBase.h"
#include "MappingUtils.h"
#include "SmoothingFilter.h"
#include <Arduino.h>
#include "../runtime/AnalogSampler.h"

class SoundSensor : public SensorBase {
  SmoothingFilter smoothing;
  uint8_t pin;

  int p2p = 0;
  float value = 0.0f;
  float inMin;
  float inMax;
  float outMin;
  float outMax;

  uint32_t lastWindow = 0;
  bool valid = false;

public:
  SoundSensor(const char* pid, const char* sensorName, uint8_t p,
              float cfgInMin, float cfgInMax, float cfgOutMin, float cfgOutMax)
    : pin(p), inMin(cfgInMin), inMax(cfgInMax), outMin(cfgOutMin), outMax(cfgOutMax) {
    setPortId(pid);
    setName(sensorName);
  }

  void begin() override {
    smoothing.reset();
    lastWindow = 0;
    valid = false;
    analogSampler.addPin(pin, true);
  }

  void read() override {
    const auto& c = analogSampler.sound(pin);
    valid = analogSampler.healthy() && c.windows && (uint32_t)(millis() - c.updatedMs) < 100;
    if (!valid) { smoothing.reset(); return; }
    if (c.windows == lastWindow) return;
    lastWindow = c.windows;
    p2p = c.peak;
    value = smoothing.update(mapClamped((float)p2p, inMin, inMax, outMin, outMax), c.updatedMs, smoothingMs);
  }

  void appendJson(String& json) override {
    appendQuoted(json, name);
    json += ":{";
    json += "\"type\":\"sound\",\"port\":";
    appendQuoted(json, portId);
    json += ",\"raw\":";
    if (valid) json += p2p; else json += "null";
    json += ",\"value\":";
    if (valid) appendFloat(json, value); else json += "null";
    if (!valid) json += ",\"error\":\"sound_not_ready\"";
#if ILAB_STRESS_TEST
    const auto& c = analogSampler.sound(pin);
    json += ",\"diag\":{\"sampleRateHz\":"; json += analogSampler.rate();
    json += ",\"samples\":"; json += c.samples;
    json += ",\"windows\":"; json += c.windows;
    json += ",\"ageMs\":"; json += millis() - c.updatedMs;
    json += ",\"overflows\":"; json += analogSampler.overflows();
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
