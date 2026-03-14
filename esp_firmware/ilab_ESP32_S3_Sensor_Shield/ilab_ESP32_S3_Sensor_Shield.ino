#include <Arduino.h>
#include <Preferences.h>

#include "PortMap.h"
#include "runtime/SensorManager.h"
#include "config/ConfigManager.h"
#include "output/DataPublisher.h"

SensorManager sensorManager;
ConfigManager configManager;
DataPublisher publisher;

static const uint32_t LOOP_DELAY_MS = 200;

static const char* PREF_NS = "sensor_cfg";
static const char* PREF_KEY_JSON = "json";
static const size_t SERIAL_LINE_MAX = 8192;
static const size_t SERIAL_RX_BUFFER_SIZE = 16384;
static const uint32_t SERIAL_RX_QUIET_MS = 40;
static uint32_t lastPublishMs = 0;
static bool serialRxLineInProgress = false;
static uint32_t lastSerialRxByteMs = 0;

static bool loadStoredConfig(String& outJson) {
  Preferences prefs;
  if (!prefs.begin(PREF_NS, true)) return false;
  outJson = prefs.getString(PREF_KEY_JSON, "");
  prefs.end();
  outJson.trim();
  return outJson.length() > 0;
}

static bool persistConfig(const String& json) {
  Preferences prefs;
  if (!prefs.begin(PREF_NS, false)) return false;
  const size_t written = prefs.putString(PREF_KEY_JSON, json);
  prefs.end();
  return written > 0;
}

static bool eraseStoredConfig() {
  Preferences prefs;
  if (!prefs.begin(PREF_NS, false)) return false;
  const bool ok = prefs.remove(PREF_KEY_JSON);
  prefs.end();
  return ok;
}

static String escapeJson(const String& in) {
  static const char hexDigits[] = "0123456789abcdef";
  String out;
  out.reserve(in.length() + 16);
  for (size_t i = 0; i < in.length(); i++) {
    const char c = in[i];
    if (c == '\"' || c == '\\') {
      out += '\\';
      out += c;
    } else if (c == '\n') {
      out += "\\n";
    } else if (c == '\r') {
      out += "\\r";
    } else if (c == '\t') {
      out += "\\t";
    } else if ((unsigned char)c < 0x20) {
      // Other control characters must be escaped as \u00XX per JSON spec.
      out += "\\u00";
      out += hexDigits[(c >> 4) & 0x0F];
      out += hexDigits[c & 0x0F];
    } else {
      out += c;
    }
  }
  return out;
}

static void printBool(bool value) {
  Serial.print(value ? "true" : "false");
}

static void handleConfigJson(const String& cfgLine) {
  String err;
  if (configManager.apply(cfgLine, err)) {
    const bool persisted = persistConfig(cfgLine);
    Serial.print("{\"status\":\"config_applied\",\"persisted\":");
    printBool(persisted);
    Serial.println("}");
    return;
  }

  Serial.print("{\"error\":\"bad_json\",\"msg\":\"");
  Serial.print(escapeJson(err));
  Serial.println("\",\"persisted\":false}");
}

static bool pollSerialLine(String& outLine) {
  static String rxBuffer;
  static bool rxBufferReserved = false;
  static bool droppingLongLine = false;
  if (!rxBufferReserved) {
    rxBuffer.reserve(SERIAL_LINE_MAX);
    rxBufferReserved = true;
  }

  while (Serial.available() > 0) {
    const char c = (char)Serial.read();
    lastSerialRxByteMs = millis();
    if (c == '\r') continue;

    if (droppingLongLine) {
      if (c == '\n') {
        droppingLongLine = false;
        serialRxLineInProgress = false;
      }
      continue;
    }

    if (c == '\n') {
      outLine = rxBuffer;
      outLine.trim();
      rxBuffer = "";
      serialRxLineInProgress = false;
      return true;
    }

    if (rxBuffer.length() < SERIAL_LINE_MAX) {
      serialRxLineInProgress = true;
      rxBuffer += c;
    } else {
      // Line too long: drop the rest of the current line until '\n'.
      rxBuffer = "";
      serialRxLineInProgress = true;
      droppingLongLine = true;
      Serial.println("{\"error\":\"line_too_long\",\"persisted\":false}");
    }
  }

  return false;
}

void setup() {
  Serial.setRxBufferSize(SERIAL_RX_BUFFER_SIZE);
  Serial.begin(115200);
  delay(200);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  String err;
  String stored;
  bool usingStored = false;
  bool configOk = false;

  if (loadStoredConfig(stored)) {
    if (configManager.apply(stored, err)) {
      usingStored = true;
      configOk = true;
    } else {
      const bool erased = eraseStoredConfig();
      if (!erased) {
        Serial.println("{\"warning\":\"erase_failed\",\"msg\":\"invalid stored config could not be erased from NVS\"}");
      }
      configOk = configManager.applyDefault(err);
    }
  } else {
    configOk = configManager.applyDefault(err);
  }

  if (!configOk) {
    sensorManager.clear();
    Serial.print("{\"error\":\"config_init_failed\",\"msg\":\"");
    Serial.print(escapeJson(err));
    Serial.println("\"}");
  }

  Serial.print("{\"status\":\"ready\",\"config\":\"");
  if (!configOk) {
    Serial.print("none");
  } else {
    Serial.print(usingStored ? "stored" : "default");
  }
  Serial.println("}");

  lastPublishMs = millis();
}

void loop() {
  String line;
  while (pollSerialLine(line)) {
    if (line.length() > 0) {
      if (line.startsWith("{")) {
        handleConfigJson(line);
      } else {
        Serial.println("{\"error\":\"unknown_input\",\"hint\":\"send JSON only\"}");
      }
    }
  }

  const uint32_t now = millis();
  const bool hasIncomingBytes = Serial.available() > 0;
  const bool serialQuiet = (uint32_t)(now - lastSerialRxByteMs) >= SERIAL_RX_QUIET_MS;
  if (!hasIncomingBytes && !serialRxLineInProgress && serialQuiet &&
      (uint32_t)(now - lastPublishMs) >= LOOP_DELAY_MS) {
    sensorManager.readAll();
    publisher.publish();
    lastPublishMs = now;
  }

  delay(1);
}
