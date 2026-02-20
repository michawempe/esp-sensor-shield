#pragma once
#include <Arduino.h>
#include <cstring>

class SensorBase {
public:
  static constexpr size_t NAME_CAPACITY = 32;

  char portId[4];
  char name[NAME_CAPACITY];

  virtual ~SensorBase() {}
  virtual void begin() = 0;
  virtual void read() = 0;
  virtual void appendJson(String& json) = 0;

protected:
  void setPortId(const char* pid) {
    strncpy(portId, pid, sizeof(portId) - 1);
    portId[sizeof(portId) - 1] = '\0';
  }

  void setName(const char* sensorName) {
    strncpy(name, sensorName, sizeof(name) - 1);
    name[sizeof(name) - 1] = '\0';
  }

  static void appendQuoted(String& json, const char* s) {
    json += '"';
    for (size_t i = 0; s[i] != '\0'; i++) {
      const char c = s[i];
      if (c == '"' || c == '\\') {
        json += '\\';
        json += c;
      } else if (c == '\n') {
        json += "\\n";
      } else if (c == '\r') {
        json += "\\r";
      } else if (c == '\t') {
        json += "\\t";
      } else {
        json += c;
      }
    }
    json += '"';
  }

  static void appendFloat(String& json, float value, uint8_t decimals = 3) {
    json += String((double)value, (unsigned int)decimals);
  }
};
