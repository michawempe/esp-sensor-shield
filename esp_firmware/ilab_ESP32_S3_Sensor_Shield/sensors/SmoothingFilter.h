#pragma once
#include <stdint.h>

// First-order low-pass, using elapsed time rather than a fixed sample count.
// Backward Euler avoids exp(), sample buffers and blocking waits.
class SmoothingFilter {
  float filtered = 0.0f;
  uint32_t lastMs = 0;
  bool initialized = false;

public:
  void reset() { initialized = false; }

  float update(float input, uint32_t nowMs, uint32_t smoothingMs) {
    if (!initialized || smoothingMs == 0) {
      filtered = input;
      initialized = true;
    } else {
      const uint32_t elapsedMs = nowMs - lastMs; // Safe across millis() rollover.
      const float alpha = (float)elapsedMs / ((float)smoothingMs + (float)elapsedMs);
      filtered += alpha * (input - filtered);
    }
    lastMs = nowMs;
    return filtered;
  }
};
