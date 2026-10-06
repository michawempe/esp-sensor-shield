#include <Arduino.h>
#include <Preferences.h>

#include "PortMap.h"
#include "runtime/SensorManager.h"
#include "config/ConfigManager.h"
#include "output/DataPublisher.h"

SensorManager sensorManager;
ConfigManager configManager;
DataPublisher publisher;

#ifndef ILAB_PUBLISH_INTERVAL_MS
#define ILAB_PUBLISH_INTERVAL_MS 20
#endif
static_assert(ILAB_PUBLISH_INTERVAL_MS >= 1, "Publish interval must be positive");
static uint32_t publishIntervalMs = ILAB_PUBLISH_INTERVAL_MS;

static const char* PREF_NS = "sensor_cfg";
static const char* PREF_KEY_JSON = "json";
static const size_t SERIAL_LINE_MAX = 8192;
static const size_t SERIAL_RX_BUFFER_SIZE = 16384;
static const uint32_t SERIAL_RX_QUIET_MS = 40;
static const uint32_t SERIAL_RX_TIMEOUT_MS = 1000;
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
  // Flash writes suspend non-IRAM ADC interrupts in this Arduino build. Starting
  // DMA before NVS persistence can leave acquisition stalled after a config edit.
  if (configManager.apply(cfgLine, err, false)) {
    const bool persisted = persistConfig(cfgLine);
    // Resume acquisition even when saving fails; the RAM config is still active.
    sensorManager.startSampling();
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

  // A lost newline must not suspend sensor output indefinitely. Discard the
  // abandoned line through its next newline so a suffix cannot become a config.
  if (serialRxLineInProgress && Serial.available() == 0 &&
      (uint32_t)(millis() - lastSerialRxByteMs) >= SERIAL_RX_TIMEOUT_MS) {
    rxBuffer = "";
    droppingLongLine = true;
    serialRxLineInProgress = false;
    Serial.println("{\"error\":\"serial_line_timeout\",\"persisted\":false}");
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

#if ILAB_STRESS_TEST
// Volatile diagnostics: never persist test settings to NVS.
static void handleStressCommand(const String& line) {
  JsonDocument doc;
  if (deserializeJson(doc, line.substring(1))) {
    Serial.println("{\"stress\":\"bad_command\"}");
    return;
  }
  if (doc["intervalMs"].is<uint32_t>()) {
    publishIntervalMs = constrain(doc["intervalMs"].as<uint32_t>(), 1u, 1000u);
  }
  if (doc["distanceBudgetUs"].is<uint32_t>()) {
    VL53L0XSensor::stressBudgetUs = constrain(doc["distanceBudgetUs"].as<uint32_t>(), 20000u, 200000u);
  }
  String err;
  if (doc["config"].is<JsonObject>()) {
    String cfg;
    serializeJson(doc["config"], cfg);
    if (!configManager.apply(cfg, err)) {
      Serial.println("{\"stress\":\"config_failed\"}");
      return;
    }
  }
  Serial.print("{\"stress\":\"ok\",\"intervalMs\":");
  Serial.print(publishIntervalMs);
  Serial.print(",\"config\":");
  Serial.print(configManager.currentConfig());
  Serial.println("}");
}
#endif

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
  Serial.println("\"}");

  lastPublishMs = millis();
}

void loop() {
  String line;
  while (pollSerialLine(line)) {
    if (line.length() > 0) {
#if ILAB_STRESS_TEST
      if (line.startsWith("!")) {
        handleStressCommand(line);
      } else
#endif
      if (line.startsWith("{")) {
        handleConfigJson(line);
      } else {
        Serial.println("{\"error\":\"unknown_input\",\"hint\":\"send JSON only\"}");
      }
    }
  }

  sensorManager.serviceAll();

  const uint32_t now = millis();
  const bool hasIncomingBytes = Serial.available() > 0;
  const bool serialQuiet = (uint32_t)(now - lastSerialRxByteMs) >= SERIAL_RX_QUIET_MS;
  if (!hasIncomingBytes && !serialRxLineInProgress && serialQuiet &&
      (uint32_t)(now - lastPublishMs) >= publishIntervalMs) {
#if ILAB_STRESS_TEST
    const uint32_t readStart = micros();
#endif
    sensorManager.readAll();
#if ILAB_STRESS_TEST
    publisher.stressReadUs = micros() - readStart;
#endif
    publisher.publish();
    // Keep the 20-ms grid despite small loop jitter; skip missed slots after
    // configuration/USB pauses instead of bursting old frames.
    lastPublishMs += ((uint32_t)(now - lastPublishMs) / publishIntervalMs) * publishIntervalMs;
  }

  delay(1);
}
