#pragma once
#include "../runtime/SensorManager.h"

class DataPublisher {
public:
#if ILAB_STRESS_TEST
  uint32_t stressReadUs = 0;
  uint32_t sequence = 0;
#endif
  void publish() {
    String json;
    json.reserve(2048);
    json += "{";
    json += "\"data\":{";
    sensorManager.appendAllJson(json);
    json += "}";
#if ILAB_STRESS_TEST
    json += ",\"stress\":{\"seq\":"; json += sequence++;
    json += ",\"us\":"; json += micros();
    json += ",\"readUs\":"; json += stressReadUs;
    json += ",\"heap\":"; json += ESP.getFreeHeap();
    json += "}";
#endif
    json += "}";
    Serial.println(json);
  }
};

extern DataPublisher publisher;
