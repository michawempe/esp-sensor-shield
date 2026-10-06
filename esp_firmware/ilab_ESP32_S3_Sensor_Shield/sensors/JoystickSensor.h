#pragma once
#include "SensorBase.h"
#include "../runtime/AnalogSampler.h"
#include "MappingUtils.h"
#include "SmoothingFilter.h"

class JoystickSensor : public SensorBase {
  SmoothingFilter smoothing;
  SmoothingFilter smoothingY;
  bool valid = false;
  uint8_t pinX;
  uint8_t pinY;

  int rawX = 0;
  int rawY = 0;
  float valueX = 0.0f;
  float valueY = 0.0f;

  int midCutoff;
  int edgeCutoff;
  float outMin;
  float outMax;

  static float normalizeAxis(int raw, int midCutoff, int edgeCutoff) {
    const int center = 2048;
    int offset = raw - center;
    const int absOffset = abs(offset);

    if (absOffset <= midCutoff) return 0.0f;

    int edgeLimit = 2047 - edgeCutoff;
    if (edgeLimit < 1) edgeLimit = 1;

    float span = (float)(edgeLimit - midCutoff);
    if (span < 1.0f) span = 1.0f;

    float distance = (float)(absOffset - midCutoff);
    if (distance < 0.0f) distance = 0.0f;

    float norm = distance / span;
    norm = clampf(norm, 0.0f, 1.0f);

    return offset >= 0 ? norm : -norm;
  }

public:
  JoystickSensor(const char* pid, const char* sensorName, uint8_t px, uint8_t py,
                 int cfgMidCutoff, int cfgEdgeCutoff, float cfgOutMin, float cfgOutMax)
    : pinX(px), pinY(py), midCutoff(cfgMidCutoff), edgeCutoff(cfgEdgeCutoff),
      outMin(cfgOutMin), outMax(cfgOutMax) {
    setPortId(pid);
    setName(sensorName);
  }

  void begin() override {
    smoothing.reset();
    smoothingY.reset();
    analogSampler.addPin(pinX);
    analogSampler.addPin(pinY);
  }

  void read() override {
    valid = analogSampler.ready(pinX) && analogSampler.ready(pinY);
    if (!valid) { smoothing.reset(); smoothingY.reset(); return; }
    rawX = analogSampler.read(pinX);
    rawY = analogSampler.read(pinY);

    const float nX = normalizeAxis(rawX, midCutoff, edgeCutoff);
    const float nY = normalizeAxis(rawY, midCutoff, edgeCutoff);

    const uint32_t nowMs = millis();
    valueX = smoothing.update(mapClamped(nX, -1.0f, 1.0f, outMin, outMax), nowMs, smoothingMs);
    valueY = smoothingY.update(mapClamped(nY, -1.0f, 1.0f, outMin, outMax), nowMs, smoothingMs);
  }

  void appendJson(String& json) override {
    appendQuoted(json, name);
    json += ":{";
    json += "\"type\":\"joystick\",\"port\":";
    appendQuoted(json, portId);

    if (valid) {
      json += ",\"raw\":{\"x\":";
      json += rawX;
      json += ",\"y\":";
      json += rawY;
      json += "}";
      json += ",\"value\":{\"x\":";
      appendFloat(json, valueX);
      json += ",\"y\":";
      appendFloat(json, valueY);
      json += "}";
    } else {
      json += ",\"raw\":null,\"value\":null,\"error\":\"adc_not_ready\"";
    }

    json += ",\"midCutoff\":";
    json += midCutoff;
    json += ",\"edgeCutoff\":";
    json += edgeCutoff;
    json += ",\"outMin\":";
    appendFloat(json, outMin);
    json += ",\"outMax\":";
    appendFloat(json, outMax);
    appendSmoothingJson(json);
    json += "}";
  }
};
