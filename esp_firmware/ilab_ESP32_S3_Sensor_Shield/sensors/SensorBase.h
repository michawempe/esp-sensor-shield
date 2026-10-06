#pragma once
#include <Arduino.h>
#include <cstring>

class SensorBase {
public:
  static constexpr size_t NAME_CAPACITY   = 32;
  // Port IDs are at most 3 chars (e.g. "A1"–"D4") + null terminator.
  // Widen this constant if longer IDs are ever introduced.
  static constexpr size_t PORTID_CAPACITY = 4;

  char portId[PORTID_CAPACITY];
  char name[NAME_CAPACITY];

  virtual ~SensorBase() {}
  virtual void begin() = 0;
  virtual void read() = 0;
  virtual void service() {}
  virtual void appendJson(String& json) = 0;

  void setSmoothingMs(uint32_t ms) { smoothingMs = ms; }

protected:
  uint32_t smoothingMs = 0;

  void appendSmoothingJson(String& json) const {
    json += ",\"smoothingMs\":";
    json += smoothingMs;
  }

  void setPortId(const char* pid) {
    strncpy(portId, pid, sizeof(portId) - 1);
    portId[sizeof(portId) - 1] = '\0';
  }

  void setName(const char* sensorName) {
    strncpy(name, sensorName, sizeof(name) - 1);
    name[sizeof(name) - 1] = '\0';
  }

  static void appendQuoted(String& json, const char* s) {
    static const char hexDigits[] = "0123456789abcdef";
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
      } else if ((unsigned char)c < 0x20) {
        // Other control characters must be escaped as \u00XX per JSON spec.
        json += "\\u00";
        json += hexDigits[(c >> 4) & 0x0F];
        json += hexDigits[c & 0x0F];
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
