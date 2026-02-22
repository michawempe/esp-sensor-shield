#pragma once
#include "SensorBase.h"

class DigitalInPullup : public SensorBase {
  uint8_t pin;
  int value = 0;
  const char* sensorType;

public:
  DigitalInPullup(const char* pid, const char* sensorName, const char* type, uint8_t p)
    : pin(p), sensorType(type) {
    setPortId(pid);
    setName(sensorName);
  }

  void begin() override {
    pinMode(pin, INPUT_PULLUP);
  }

  void read() override {
    value = digitalRead(pin);
  }

  void appendJson(String& json) override {
    appendQuoted(json, name);
    json += ":{";
    json += "\"type\":";
    appendQuoted(json, sensorType);
    json += ",\"port\":";
    appendQuoted(json, portId);
    json += ",\"raw\":";
    json += value;
    json += ",\"value\":";
    json += value;
    json += "}";
  }
};
