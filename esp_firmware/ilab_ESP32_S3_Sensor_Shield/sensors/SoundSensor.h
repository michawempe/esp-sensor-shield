#pragma once
#include "SensorBase.h"
#include "MappingUtils.h"
#include <Arduino.h>

class SoundSensor : public SensorBase {
  uint8_t pin;

  int p2p = 0;
  float value = 0.0f;
  float inMin;
  float inMax;
  float outMin;
  float outMax;

  static constexpr uint16_t WINDOW_MS = 25;
  static constexpr uint16_t SAMPLE_DELAY_US = 0;

public:
  SoundSensor(const char* pid, const char* sensorName, uint8_t p,
              float cfgInMin, float cfgInMax, float cfgOutMin, float cfgOutMax)
    : pin(p), inMin(cfgInMin), inMax(cfgInMax), outMin(cfgOutMin), outMax(cfgOutMax) {
    setPortId(pid);
    setName(sensorName);
  }

  void begin() override {
    analogReadResolution(12);
    analogSetPinAttenuation(pin, ADC_11db);
    pinMode(pin, INPUT);
  }

  void read() override {
    uint32_t start = millis();
    int minV = 4095;
    int maxV = 0;

    while ((millis() - start) < WINDOW_MS) {
      // Prioritize incoming serial config lines over long analog sampling windows.
      if (Serial.available() > 0) break;
      const int v = analogRead(pin);
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
      if (SAMPLE_DELAY_US) delayMicroseconds(SAMPLE_DELAY_US);
    }

    p2p = (maxV >= minV) ? (maxV - minV) : 0;  // Guard: no samples taken if serial interrupted immediately.
    value = mapClamped((float)p2p, inMin, inMax, outMin, outMax);
  }

  void appendJson(String& json) override {
    appendQuoted(json, name);
    json += ":{";
    json += "\"type\":\"sound\",\"port\":";
    appendQuoted(json, portId);
    json += ",\"raw\":";
    json += p2p;
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
    json += "}";
  }
};
