#pragma once
#include "../runtime/SensorManager.h"

class DataPublisher {
public:
  void publish() {
    String json;
    json.reserve(2048);
    json += "{";
    json += "\"data\":{";
    sensorManager.appendAllJson(json);
    json += "}}";
    Serial.println(json);
  }
};

extern DataPublisher publisher;
