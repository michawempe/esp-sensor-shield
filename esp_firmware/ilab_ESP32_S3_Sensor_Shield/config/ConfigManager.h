#pragma once
#include <ArduinoJson.h>
#include <memory>
#include <new>
#include <vector>

#include "DefaultConfig.h"
#include "../PortMap.h"
#include "../runtime/SensorManager.h"

#include "../sensors/HallSensor.h"
#include "../sensors/SoundSensor.h"
#include "../sensors/JoystickSensor.h"
#include "../sensors/TouchSensor.h"
#include "../sensors/SharpSensor.h"
#include "../sensors/SliderSensor.h"
#include "../sensors/DigitalInPullup.h"
#include "../sensors/EncoderSensor.h"
#include "../sensors/LightSensor.h"

class ConfigManager {
public:
  bool apply(const String& jsonStr, String& errorMessage) {
    static constexpr size_t CONFIG_DOC_CAPACITY = 8192;
    const size_t jsonLen = jsonStr.length();
    std::unique_ptr<char[]> mutableJson(new (std::nothrow) char[jsonLen + 1]);
    if (!mutableJson) {
      errorMessage = "bad_json: input_oom";
      return false;
    }
    jsonStr.toCharArray(mutableJson.get(), jsonLen + 1);

    DynamicJsonDocument doc(CONFIG_DOC_CAPACITY);
    // Parse from mutable buffer so ArduinoJson can work in zero-copy mode.
    DeserializationError err = deserializeJson(doc, mutableJson.get());
    if (err) {
      errorMessage = String("bad_json: ") + err.c_str();
      return false;
    }

    if (!doc.is<JsonObject>()) {
      errorMessage = "config_root_must_be_object";
      return false;
    }

    JsonObjectConst root = doc.as<JsonObjectConst>();
    for (JsonPairConst kv : root) {
      if (!isKnownPort(kv.key().c_str())) {
        errorMessage = String("unknown_port: ") + kv.key().c_str();
        return false;
      }
    }
    std::vector<SensorBase*> staged;
    std::vector<TypeCounter> typeCounters;
    std::vector<ParsedEntry> parsedEntries;
    std::vector<String> reservedNames;

    // Pass 1: parse entries in deterministic port order and reserve explicit names.
    for (int i = 0; i < PORT_COUNT; i++) {
      const char* portId = PORTS[i].id;
      if (!root.containsKey(portId)) continue;

      JsonVariantConst entry = root[portId];
      if (entry.isNull()) continue;

      String type;
      String name;
      if (!parseEntry(entry, portId, type, name, errorMessage)) {
        deleteSensors(staged);
        return false;
      }

      if (name.length() > 0) {
        if (!validateName(name, errorMessage)) {
          errorMessage = String("port ") + portId + ": " + errorMessage;
          deleteSensors(staged);
          return false;
        }
        if (stringAlreadyUsed(reservedNames, name)) {
          errorMessage = String("duplicate_name: ") + name;
          deleteSensors(staged);
          return false;
        }
        reservedNames.push_back(name);
      }

      parsedEntries.push_back({&PORTS[i], entry, type, name});
    }

    // Pass 2: create sensors, auto-assign missing names while skipping reserved names.
    for (const ParsedEntry& parsed : parsedEntries) {
      String finalName = parsed.name;
      if (finalName.length() == 0) {
        finalName = nextAutoName(parsed.type, typeCounters, reservedNames);
      }

      SensorBase* sensor = createSensor(*parsed.port, parsed.entry, parsed.type, finalName, errorMessage);
      if (!sensor) {
        errorMessage = String("port ") + parsed.port->id + ": " + errorMessage;
        deleteSensors(staged);
        return false;
      }

      staged.push_back(sensor);
    }

    sensorManager.clear();
    for (SensorBase* s : staged) {
      sensorManager.add(s);
    }

    currentConfigJson = jsonStr;
    currentConfigJson.trim();
    return true;
  }

  bool applyDefault(String& errorMessage) {
    return apply(defaultConfig(), errorMessage);
  }

  String defaultConfig() const {
    return String(FPSTR(DEFAULT_CONFIG_JSON));
  }

  const String& currentConfig() const {
    return currentConfigJson;
  }

private:
  struct ParsedEntry {
    const PortDef* port;
    JsonVariantConst entry;
    String type;
    String name;
  };

  struct TypeCounter {
    String type;
    int count;
  };

  String currentConfigJson;

  static void deleteSensors(std::vector<SensorBase*>& sensors) {
    for (SensorBase* s : sensors) {
      delete s;
    }
    sensors.clear();
  }

  static String normalizedType(const char* in) {
    String t = in ? String(in) : String("");
    t.trim();
    t.toLowerCase();
    return t;
  }

  static bool parseEntry(JsonVariantConst entry, const char* portId,
                         String& typeOut, String& nameOut, String& errorMessage) {
    if (!entry.is<JsonObjectConst>()) {
      errorMessage = String("port ") + portId + ": entry_must_be_object";
      return false;
    }

    JsonObjectConst obj = entry.as<JsonObjectConst>();
    const char* type = obj["type"];
    if (!type || strlen(type) == 0) {
      errorMessage = String("port ") + portId + ": missing_type";
      return false;
    }

    typeOut = normalizedType(type);

    if (obj["name"].is<const char*>()) {
      nameOut = obj["name"].as<const char*>();
      nameOut.trim();
    } else {
      nameOut = "";
    }

    return true;
  }

  static bool validateName(const String& name, String& errorMessage) {
    if (name.length() == 0) {
      errorMessage = "empty_name";
      return false;
    }
    if (name.length() >= SensorBase::NAME_CAPACITY) {
      errorMessage = "name_too_long";
      return false;
    }
    return true;
  }

  static bool isKnownPort(const char* portId) {
    return findPortById(portId) != nullptr;
  }

  static int bumpTypeCounter(std::vector<TypeCounter>& counters, const String& type) {
    for (TypeCounter& c : counters) {
      if (c.type == type) {
        c.count += 1;
        return c.count;
      }
    }
    counters.push_back({type, 1});
    return 1;
  }

  static bool stringAlreadyUsed(const std::vector<String>& names, const String& name) {
    for (const String& existing : names) {
      if (name.equals(existing)) return true;
    }
    return false;
  }

  static String nextAutoName(const String& type,
                             std::vector<TypeCounter>& counters,
                             std::vector<String>& reservedNames) {
    while (true) {
      const int typeIndex = bumpTypeCounter(counters, type);
      String candidate = type + String(typeIndex);
      if (!stringAlreadyUsed(reservedNames, candidate)) {
        reservedNames.push_back(candidate);
        return candidate;
      }
    }
  }

  static float getFloatOr(JsonVariantConst entry, const char* key, float fallback) {
    if (!entry.is<JsonObjectConst>()) return fallback;
    JsonVariantConst v = entry[key];
    if (v.is<float>() || v.is<double>() || v.is<int>() || v.is<long>()) {
      return v.as<float>();
    }
    return fallback;
  }

  static int getIntOr(JsonVariantConst entry, const char* key, int fallback) {
    if (!entry.is<JsonObjectConst>()) return fallback;
    JsonVariantConst v = entry[key];
    if (v.is<int>() || v.is<long>()) {
      return v.as<int>();
    }
    return fallback;
  }

  static uint32_t getUIntOr(JsonVariantConst entry, const char* key, uint32_t fallback) {
    if (!entry.is<JsonObjectConst>()) return fallback;
    JsonVariantConst v = entry[key];
    if (v.is<uint32_t>() || v.is<unsigned long>()) {
      return v.as<uint32_t>();
    }
    if (v.is<int>() || v.is<long>()) {
      const long value = v.as<long>();
      return value < 0 ? 0u : (uint32_t)value;
    }
    if (v.is<float>() || v.is<double>()) {
      const double value = v.as<double>();
      if (value <= 0.0) return 0u;
      if (value >= 4294967295.0) return 4294967295u;
      return (uint32_t)value;
    }
    return fallback;
  }

  static bool getBoolOr(JsonVariantConst entry, const char* key, bool fallback) {
    if (!entry.is<JsonObjectConst>()) return fallback;
    JsonVariantConst v = entry[key];
    if (v.is<bool>()) return v.as<bool>();
    return fallback;
  }

  static SensorBase* createSensor(const PortDef& p, JsonVariantConst entry,
                                  const String& type, const String& name,
                                  String& errorMessage) {
    const char* portId = p.id;

    if (type == "button") {
      if (p.type != PORT_2P) {
        errorMessage = "button_requires_2p_port";
        return nullptr;
      }
      return new DigitalInPullup(portId, name.c_str(), "button", p.pins[0]);
    }

    if (type == "switch") {
      if (p.type != PORT_2P) {
        errorMessage = "switch_requires_2p_port";
        return nullptr;
      }
      return new DigitalInPullup(portId, name.c_str(), "switch", p.pins[0]);
    }

    if (type == "touch") {
      if (p.type != PORT_TOUCH) {
        errorMessage = "touch_requires_touch_port";
        return nullptr;
      }
      const uint32_t threshold = getUIntOr(entry, "threshold", SensorDefaults::TOUCH_THRESHOLD);
      return new TouchSensor(portId, name.c_str(), p.pins[0], threshold);
    }

    if (type == "slider") {
      if (p.type != PORT_3P) {
        errorMessage = "slider_requires_3p_port";
        return nullptr;
      }
      const float inMin = getFloatOr(entry, "inMin", SensorDefaults::ANALOG_IN_MIN);
      const float inMax = getFloatOr(entry, "inMax", SensorDefaults::ANALOG_IN_MAX);
      const float outMin = getFloatOr(entry, "outMin", SensorDefaults::ANALOG_OUT_MIN);
      const float outMax = getFloatOr(entry, "outMax", SensorDefaults::ANALOG_OUT_MAX);
      return new SliderSensor(portId, name.c_str(), p.pins[0], inMin, inMax, outMin, outMax);
    }

    if (type == "light") {
      if (p.type != PORT_3P) {
        errorMessage = "light_requires_3p_port";
        return nullptr;
      }
      const float inMin = getFloatOr(entry, "inMin", SensorDefaults::ANALOG_IN_MIN);
      const float inMax = getFloatOr(entry, "inMax", SensorDefaults::ANALOG_IN_MAX);
      const float outMin = getFloatOr(entry, "outMin", SensorDefaults::ANALOG_OUT_MIN);
      const float outMax = getFloatOr(entry, "outMax", SensorDefaults::ANALOG_OUT_MAX);
      return new LightSensor(portId, name.c_str(), p.pins[0], inMin, inMax, outMin, outMax);
    }

    if (type == "sound") {
      if (p.type != PORT_3P) {
        errorMessage = "sound_requires_3p_port";
        return nullptr;
      }
      const float inMin = getFloatOr(entry, "inMin", SensorDefaults::SOUND_IN_MIN);
      const float inMax = getFloatOr(entry, "inMax", SensorDefaults::SOUND_IN_MAX);
      const float outMin = getFloatOr(entry, "outMin", SensorDefaults::SOUND_OUT_MIN);
      const float outMax = getFloatOr(entry, "outMax", SensorDefaults::SOUND_OUT_MAX);
      return new SoundSensor(portId, name.c_str(), p.pins[0], inMin, inMax, outMin, outMax);
    }

    if (type == "distance") {
      if (p.type != PORT_3P) {
        errorMessage = "distance_requires_3p_port";
        return nullptr;
      }
      const float inMin = getFloatOr(entry, "inMin", SensorDefaults::DISTANCE_IN_MIN);
      const float inMax = getFloatOr(entry, "inMax", SensorDefaults::DISTANCE_IN_MAX);
      const float outMin = getFloatOr(entry, "outMin", SensorDefaults::DISTANCE_OUT_MIN);
      const float outMax = getFloatOr(entry, "outMax", SensorDefaults::DISTANCE_OUT_MAX);
      return new SharpSensor(portId, name.c_str(), p.pins[0], inMin, inMax, outMin, outMax);
    }

    if (type == "magnet") {
      if (p.type != PORT_3P) {
        errorMessage = "magnet_requires_3p_port";
        return nullptr;
      }
      const float inMin = getFloatOr(entry, "inMin", SensorDefaults::ANALOG_IN_MIN);
      const float inMax = getFloatOr(entry, "inMax", SensorDefaults::ANALOG_IN_MAX);
      const float outMin = getFloatOr(entry, "outMin", SensorDefaults::ANALOG_OUT_MIN);
      const float outMax = getFloatOr(entry, "outMax", SensorDefaults::ANALOG_OUT_MAX);
      return new HallSensor(portId, name.c_str(), p.pins[0], inMin, inMax, outMin, outMax);
    }

    if (type == "encoder") {
      if (p.type != PORT_4P || p.pinCount != 2) {
        errorMessage = "encoder_requires_4p_port";
        return nullptr;
      }
      const int fullRotation = getIntOr(entry, "fullRotation", SensorDefaults::ENCODER_FULL_ROTATION);
      const bool modulo = getBoolOr(entry, "modulo", SensorDefaults::ENCODER_MODULO);
      return new EncoderSensor(portId, name.c_str(), p.pins[0], p.pins[1], fullRotation, modulo);
    }

    if (type == "joystick") {
      if (p.type != PORT_4P || p.pinCount != 2) {
        errorMessage = "joystick_requires_4p_port";
        return nullptr;
      }
      const int midCutoff = getIntOr(entry, "midCutoff", SensorDefaults::JOYSTICK_MID_CUTOFF);
      const int edgeCutoff = getIntOr(entry, "edgeCutoff", SensorDefaults::JOYSTICK_EDGE_CUTOFF);
      const float outMin = getFloatOr(entry, "outMin", SensorDefaults::JOYSTICK_OUT_MIN);
      const float outMax = getFloatOr(entry, "outMax", SensorDefaults::JOYSTICK_OUT_MAX);
      return new JoystickSensor(portId, name.c_str(), p.pins[0], p.pins[1], midCutoff, edgeCutoff, outMin, outMax);
    }

    errorMessage = String("unknown_sensor_type: ") + type;
    return nullptr;
  }
};

extern ConfigManager configManager;
