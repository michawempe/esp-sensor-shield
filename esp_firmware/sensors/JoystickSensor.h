#pragma once
#include "SensorBase.h"
#include "MappingUtils.h"

class JoystickSensor : public SensorBase {
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
    analogSetPinAttenuation(pinX, ADC_11db);
    analogSetPinAttenuation(pinY, ADC_11db);
  }

  void read() override {
    rawX = analogRead(pinX);
    rawY = analogRead(pinY);

    const float nX = normalizeAxis(rawX, midCutoff, edgeCutoff);
    const float nY = normalizeAxis(rawY, midCutoff, edgeCutoff);

    valueX = mapClamped(nX, -1.0f, 1.0f, outMin, outMax);
    valueY = mapClamped(nY, -1.0f, 1.0f, outMin, outMax);
  }

  void appendJson(String& json) override {
    appendQuoted(json, name);
    json += ":{";
    json += "\"type\":\"joystick\",\"port\":";
    appendQuoted(json, portId);

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

    json += ",\"midCutoff\":";
    json += midCutoff;
    json += ",\"edgeCutoff\":";
    json += edgeCutoff;
    json += ",\"outMin\":";
    appendFloat(json, outMin);
    json += ",\"outMax\":";
    appendFloat(json, outMax);
    json += "}";
  }
};
