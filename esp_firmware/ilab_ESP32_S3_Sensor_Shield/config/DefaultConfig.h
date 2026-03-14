#pragma once
#include <Arduino.h>

namespace SensorDefaults {
  // Slider / Light / Magnet
  static constexpr float ANALOG_IN_MIN = 0.0f;
  static constexpr float ANALOG_IN_MAX = 4095.0f;
  static constexpr float ANALOG_OUT_MIN = 0.0f;
  static constexpr float ANALOG_OUT_MAX = 1.0f;

  // Distance (VL53L0X, mm-based raw value)
  static constexpr float DISTANCE_IN_MIN = 30.0f;
  static constexpr float DISTANCE_IN_MAX = 600.0f;
  static constexpr float DISTANCE_OUT_MIN = 0.0f;
  static constexpr float DISTANCE_OUT_MAX = 1.0f;

  // Sound
  static constexpr float SOUND_IN_MIN = 100.0f;
  static constexpr float SOUND_IN_MAX = 4095.0f;
  static constexpr float SOUND_OUT_MIN = 0.0f;
  static constexpr float SOUND_OUT_MAX = 1.0f;

  // Touch
  static constexpr uint32_t TOUCH_THRESHOLD = 50000u;

  // Encoder
  static constexpr float ENCODER_FULL_ROTATION = 360.0f;
  static constexpr bool ENCODER_MODULO = false;

  // Joystick
  static constexpr int JOYSTICK_MID_CUTOFF = 100;
  static constexpr int JOYSTICK_EDGE_CUTOFF = 0;
  static constexpr float JOYSTICK_OUT_MIN = -1.0f;
  static constexpr float JOYSTICK_OUT_MAX = 1.0f;
}

static const char DEFAULT_CONFIG_JSON[] PROGMEM = R"json(
{}
)json";
