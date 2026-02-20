#pragma once
#include "SensorBase.h"
#include <Arduino.h>
#include <math.h>
#include "driver/pcnt.h"

#ifndef PCNT_UNIT_MAX
#define PCNT_UNIT_MAX 4
#endif

class EncoderSensor : public SensorBase {
  uint8_t pinA;
  uint8_t pinB;
  static constexpr float TICKS_PER_ROTATION = 40.0f;

  pcnt_unit_t unit = PCNT_UNIT_0;
  bool unitAllocated = false;

  int16_t count16 = 0;
  int16_t lastCount16 = 0;
  long accumulatedCount = 0;
  long rawCount = 0;
  long value = 0;
  int fullRotation;
  bool modulo;

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

public:
  EncoderSensor(const char* pid, const char* sensorName, uint8_t a, uint8_t b,
                int cfgFullRotation, bool cfgModulo)
    : pinA(a), pinB(b), fullRotation(cfgFullRotation), modulo(cfgModulo) {
    setPortId(pid);
    setName(sensorName);
  }

  ~EncoderSensor() override {
    if (unitAllocated) {
      pcnt_counter_pause(unit);
      pcnt_counter_clear(unit);
      freeUnit(unit);
      unitAllocated = false;
    }
  }

  void begin() override {
    if (!allocUnit(unit)) {
      unitAllocated = false;
      return;
    }
    unitAllocated = true;

    pinMode(pinA, INPUT_PULLUP);
    pinMode(pinB, INPUT_PULLUP);

    pcnt_config_t pcntConfig = {};
    pcntConfig.pulse_gpio_num = pinA;
    pcntConfig.ctrl_gpio_num = pinB;
    pcntConfig.unit = unit;
    pcntConfig.channel = PCNT_CHANNEL_0;
    pcntConfig.pos_mode = PCNT_COUNT_INC;
    pcntConfig.neg_mode = PCNT_COUNT_DEC;
    pcntConfig.lctrl_mode = PCNT_MODE_REVERSE;
    pcntConfig.hctrl_mode = PCNT_MODE_KEEP;
    pcntConfig.counter_h_lim = 32767;
    pcntConfig.counter_l_lim = -32768;

    pcnt_unit_config(&pcntConfig);
    // Disable legacy PCNT glitch filter for broad board/core compatibility.
    // Some ESP32-S3 core combinations report PARAM ERROR on filter setup.
    pcnt_filter_disable(unit);

    pcnt_counter_pause(unit);
    pcnt_counter_clear(unit);
    pcnt_counter_resume(unit);
    count16 = 0;
    lastCount16 = 0;
    accumulatedCount = 0;
  }

  void read() override {
    if (!unitAllocated) {
      rawCount = 0;
      value = 0;
      return;
    }

    pcnt_get_counter_value(unit, &count16);
    int32_t delta = (int32_t)count16 - (int32_t)lastCount16;
    if (delta > 30000) {
      delta -= 65536;
    } else if (delta < -30000) {
      delta += 65536;
    }
    accumulatedCount += (long)delta;
    lastCount16 = count16;
    rawCount = accumulatedCount;
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
