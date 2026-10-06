#pragma once
#include <Arduino.h>
#include <vector>
#include "AnalogSampler.h"
#include "../sensors/SensorBase.h"

class SensorManager {
  std::vector<SensorBase*> sensors;

public:
  void clear() {
    analogSampler.reset();
    for (auto s : sensors) delete s;
    sensors.clear();
  }

  void add(SensorBase* s) {
    sensors.push_back(s);
    s->begin();
  }

  void startSampling() {
    if (!analogSampler.start()) Serial.println("{\"error\":\"adc_start_failed\"}");
  }

  void serviceAll() {
    analogSampler.poll();
    for (auto s : sensors) s->service();
  }

  void readAll() {
    for (auto s : sensors) s->read();
  }

  void appendAllJson(String& json) {
    for (size_t i = 0; i < sensors.size(); i++) {
      if (i > 0) json += ",";
      sensors[i]->appendJson(json);
    }
  }
};

extern SensorManager sensorManager;
