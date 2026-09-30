// Expose library dependencies to PlatformIO's scanner: the sketch lives
// outside this PlatformIO project directory.
#include <Arduino.h>
#include <Preferences.h>
#include <Wire.h>
#include <ArduinoJson.h>
#include <VL53L0X.h>

// Compile the original sketch directly so Arduino IDE and PlatformIO share it.
// Functions in the sketch must be declared before use (normal C++ rules).
#include "../../esp_firmware/ilab_ESP32_S3_Sensor_Shield/ilab_ESP32_S3_Sensor_Shield.ino"
