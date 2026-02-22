#pragma once
#include <Arduino.h>

inline float clampf(float v, float minV, float maxV) {
  if (minV > maxV) {
    const float t = minV;
    minV = maxV;
    maxV = t;
  }
  if (v < minV) return minV;
  if (v > maxV) return maxV;
  return v;
}

inline float mapClamped(float raw, float inMin, float inMax, float outMin, float outMax) {
  if (inMin == inMax) return outMin;
  const float clamped = clampf(raw, inMin, inMax);
  const float norm = (clamped - inMin) / (inMax - inMin);
  return outMin + norm * (outMax - outMin);
}
