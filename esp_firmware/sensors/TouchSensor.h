#pragma once
#include "SensorBase.h"

class TouchSensor : public SensorBase {
  uint8_t pin;
  uint32_t raw = 0;
  int value = 0;
  uint32_t threshold;

public:
  TouchSensor(const char* pid, const char* sensorName, uint8_t p, uint32_t cfgThreshold)
    : pin(p), threshold(cfgThreshold) {
    setPortId(pid);
    setName(sensorName);
  }

  void begin() override {}

  void read() override {
    raw = (uint32_t)touchRead(pin);
    value = (raw > threshold) ? 1 : 0;
  }

  void appendJson(String& json) override {
    appendQuoted(json, name);
    json += ":{";
    json += "\"type\":\"touch\",\"port\":";
    appendQuoted(json, portId);
    json += ",\"raw\":";
    json += raw;
    json += ",\"value\":";
    json += value;
    json += ",\"threshold\":";
    json += threshold;
    json += "}";
  }
};
