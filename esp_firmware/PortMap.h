#pragma once
#include <Arduino.h>

enum PortType : uint8_t {
  PORT_2P,
  PORT_3P,
  PORT_4P,
  PORT_TOUCH
};

struct PortDef {
  const char* id;      // "A1", "B3", ...
  PortType type;
  uint8_t pins[2];     // up to 2 pins (4P uses 2)
  uint8_t pinCount;
};

static const PortDef PORTS[] = {
  // --- 2-pol A1..A6 ---
  {"A1", PORT_2P, {42, 0}, 1},
  {"A2", PORT_2P, {41, 0}, 1},
  {"A3", PORT_2P, {40, 0}, 1},
  {"A4", PORT_2P, {39, 0}, 1},
  {"A5", PORT_2P, {37, 0}, 1},
  {"A6", PORT_2P, {21, 0}, 1},

  // --- 3-pol B1..B5 ---
  {"B1", PORT_3P, {2, 0}, 1},
  {"B2", PORT_3P, {1, 0}, 1},
  {"B3", PORT_3P, {8, 0}, 1},
  {"B4", PORT_3P, {9, 0}, 1},
  {"B5", PORT_3P, {10,0}, 1},

  // --- 4-pol C1..C4 ---
  {"C1", PORT_4P, {4, 5}, 2},
  {"C2", PORT_4P, {6, 7}, 2},
  {"C3", PORT_4P, {15,16},2},
  {"C4", PORT_4P, {17,18},2},

  // --- Touch D1..D4 ---
  {"D1", PORT_TOUCH, {11,0}, 1},
  {"D2", PORT_TOUCH, {12,0}, 1},
  {"D3", PORT_TOUCH, {13,0}, 1},
  {"D4", PORT_TOUCH, {14,0}, 1},
};

static const int PORT_COUNT = (int)(sizeof(PORTS) / sizeof(PORTS[0]));

inline const PortDef* findPortById(const char* id) {
  for (int i = 0; i < PORT_COUNT; i++) {
    if (strcmp(PORTS[i].id, id) == 0) return &PORTS[i];
  }
  return nullptr;
}
