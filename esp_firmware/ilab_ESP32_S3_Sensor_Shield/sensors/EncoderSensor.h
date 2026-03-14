#pragma once
#include "SensorBase.h"
#include <Arduino.h>
#include <math.h>
#include "esp_idf_version.h"

// Select PCNT driver based on ESP-IDF version.
// Arduino-ESP32 3.x ships ESP-IDF 5.x where the legacy driver/pcnt.h is
// deprecated; the new driver/pulse_cnt.h API is used instead.
// Arduino-ESP32 2.x (ESP-IDF 4.x) still uses the legacy API.
#if ESP_IDF_VERSION_MAJOR >= 5
  #define ILAB_USE_NEW_PCNT 1
  #include "driver/pulse_cnt.h"
#else
  #define ILAB_USE_NEW_PCNT 0
  #include "driver/pcnt.h"
  #ifndef PCNT_UNIT_MAX
    #define PCNT_UNIT_MAX 4
  #endif
#endif

class EncoderSensor : public SensorBase {
  uint8_t pinA;
  uint8_t pinB;
  static constexpr float TICKS_PER_ROTATION = 40.0f;

#if ILAB_USE_NEW_PCNT
  pcnt_unit_handle_t    pcntUnit    = nullptr;
  pcnt_channel_handle_t pcntChannel = nullptr;
#else
  pcnt_unit_t unit = PCNT_UNIT_0;

  static bool* usedUnits() {
    static bool flags[PCNT_UNIT_MAX] = {};
    return flags;
  }

  static bool allocUnit(pcnt_unit_t& outUnit) {
    bool* flags = usedUnits();
    for (int i = 0; i < PCNT_UNIT_MAX; i++) {
      if (!flags[i]) {
        flags[i] = true;
        outUnit = (pcnt_unit_t)i;
        return true;
      }
    }
    return false;
  }

  static void freeUnit(pcnt_unit_t u) {
    const int idx = (int)u;
    bool* flags = usedUnits();
    if (idx >= 0 && idx < PCNT_UNIT_MAX) flags[idx] = false;
  }
#endif

  bool unitAllocated = false;

  int  lastCount        = 0;
  long accumulatedCount = 0;
  long rawCount         = 0;
  long value            = 0;
  int  fullRotation;
  bool modulo;

public:
  EncoderSensor(const char* pid, const char* sensorName, uint8_t a, uint8_t b,
                int cfgFullRotation, bool cfgModulo)
    : pinA(a), pinB(b), fullRotation(cfgFullRotation), modulo(cfgModulo) {
    setPortId(pid);
    setName(sensorName);
  }

  ~EncoderSensor() override {
    if (unitAllocated) {
#if ILAB_USE_NEW_PCNT
      pcnt_unit_stop(pcntUnit);
      if (pcntChannel) {
        pcnt_del_channel(pcntChannel);
        pcntChannel = nullptr;
      }
      pcnt_unit_disable(pcntUnit);
      pcnt_del_unit(pcntUnit);
      pcntUnit = nullptr;
#else
      pcnt_counter_pause(unit);
      pcnt_counter_clear(unit);
      freeUnit(unit);
#endif
      unitAllocated = false;
    }
  }

  void begin() override {
    pinMode(pinA, INPUT_PULLUP);
    pinMode(pinB, INPUT_PULLUP);

#if ILAB_USE_NEW_PCNT
    pcnt_unit_config_t unitConfig = {};
    unitConfig.low_limit  = -32768;
    unitConfig.high_limit =  32767;
    if (pcnt_new_unit(&unitConfig, &pcntUnit) != ESP_OK) {
      unitAllocated = false;
      return;
    }

    pcnt_chan_config_t chanConfig = {};
    chanConfig.edge_gpio_num  = pinA;
    chanConfig.level_gpio_num = pinB;
    if (pcnt_new_channel(pcntUnit, &chanConfig, &pcntChannel) != ESP_OK) {
      pcnt_del_unit(pcntUnit);
      pcntUnit = nullptr;
      unitAllocated = false;
      return;
    }

    // Quadrature: rising/falling edge on A increments/decrements;
    // B level keeps or reverses the direction.
    pcnt_channel_set_edge_action(pcntChannel,
      PCNT_CHANNEL_EDGE_ACTION_DECREASE,
      PCNT_CHANNEL_EDGE_ACTION_INCREASE);
    pcnt_channel_set_level_action(pcntChannel,
      PCNT_CHANNEL_LEVEL_ACTION_KEEP,
      PCNT_CHANNEL_LEVEL_ACTION_INVERSE);

    pcnt_unit_enable(pcntUnit);
    pcnt_unit_clear_count(pcntUnit);
    pcnt_unit_start(pcntUnit);

#else
    if (!allocUnit(unit)) {
      unitAllocated = false;
      return;
    }

    pcnt_config_t pcntConfig = {};
    pcntConfig.pulse_gpio_num = pinA;
    pcntConfig.ctrl_gpio_num  = pinB;
    pcntConfig.unit           = unit;
    pcntConfig.channel        = PCNT_CHANNEL_0;
    pcntConfig.pos_mode       = PCNT_COUNT_INC;
    pcntConfig.neg_mode       = PCNT_COUNT_DEC;
    pcntConfig.lctrl_mode     = PCNT_MODE_REVERSE;
    pcntConfig.hctrl_mode     = PCNT_MODE_KEEP;
    pcntConfig.counter_h_lim  =  32767;
    pcntConfig.counter_l_lim  = -32768;

    pcnt_unit_config(&pcntConfig);
    // Disable PCNT glitch filter for broad board/core compatibility.
    // Some ESP32-S3 core combinations report PARAM_ERROR on filter setup.
    pcnt_filter_disable(unit);

    pcnt_counter_pause(unit);
    pcnt_counter_clear(unit);
    pcnt_counter_resume(unit);
#endif

    unitAllocated = true;
    lastCount        = 0;
    accumulatedCount = 0;
  }

  void read() override {
    if (!unitAllocated) {
      rawCount = 0;
      value    = 0;
      return;
    }

    int currentCount = 0;
#if ILAB_USE_NEW_PCNT
    pcnt_unit_get_count(pcntUnit, &currentCount);
#else
    int16_t count16 = 0;
    pcnt_get_counter_value(unit, &count16);
    currentCount = (int)count16;
#endif

    // Delta tracking handles 16-bit counter wrap-around on both APIs.
    int32_t delta = (int32_t)currentCount - (int32_t)lastCount;
    if      (delta >  30000) delta -= 65536;
    else if (delta < -30000) delta += 65536;

    accumulatedCount += (long)delta;
    lastCount = currentCount;
    rawCount  = accumulatedCount;

    // Scale raw ticks to the configured fullRotation.
    // Example: 40 ticks per physical turn, fullRotation=360 => factor 9.
    if (fullRotation > 0) {
      const float scaled = ((float)rawCount * (float)fullRotation) / TICKS_PER_ROTATION;
      value = lroundf(scaled);
    } else {
      value = rawCount;
    }

    if (modulo && fullRotation > 0) {
      long wrapped = value % fullRotation;
      if (wrapped < 0) wrapped += fullRotation;
      value = wrapped;
    }
  }

  void appendJson(String& json) override {
    appendQuoted(json, name);
    json += ":{";
    json += "\"type\":\"encoder\",\"port\":";
    appendQuoted(json, portId);
    json += ",\"raw\":";
    json += rawCount;
    json += ",\"value\":";
    json += value;
    json += ",\"fullRotation\":";
    json += fullRotation;
    json += ",\"modulo\":";
    json += (modulo ? "true" : "false");
    json += "}";
  }
};
