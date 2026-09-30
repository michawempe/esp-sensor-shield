// Host test: c++ -std=c++17 -Wall -Wextra -fsanitize=undefined
// test_smoothing.cpp -o /tmp/test_smoothing && /tmp/test_smoothing
#include "../../esp_firmware/ilab_ESP32_S3_Sensor_Shield/sensors/SmoothingFilter.h"
#include <cassert>
#include <cmath>
#include <cstdio>

int main() {
  SmoothingFilter filter;
  assert(filter.update(42, 1000, 100) == 42); // No ramp from zero on startup.
  assert(filter.update(-12, 1040, 0) == -12); // Disabled passes input through.
  filter.reset();
  assert(filter.update(0, 0, 100) == 0);
  float previous = 0;
  for (uint32_t t = 10; t <= 1000; t += 10) {
    const float value = filter.update(100, t, 100);
    assert(value > previous && value <= 100); // Monotonic, no overshoot.
    if (t == 100) assert(value > 60 && value < 65);
    if (t == 300) assert(value > 94 && value < 96);
    previous = value;
  }
  // Different sampling rates still produce a similar time response.
  SmoothingFilter slower;
  slower.update(0, 0, 100);
  float slow = 0;
  for (uint32_t t = 20; t <= 100; t += 20) slow = slower.update(100, t, 100);
  assert(slow > 59 && slow < 62);
  // Repeated timestamps must not move the result.
  assert(slower.update(-100, 100, 100) == slow);
  // Rollover must act like a normal 40 ms interval.
  SmoothingFilter rollover, normal;
  rollover.update(0, UINT32_MAX - 19, 100);
  normal.update(0, 0, 100);
  assert(rollover.update(100, 20, 100) == normal.update(100, 40, 100));
  // Independent axes and reset after invalid readings.
  SmoothingFilter x, y;
  x.update(1, 0, 100); y.update(-1, 0, 100);
  assert(x.update(1, 40, 100) == 1);
  assert(y.update(-1, 40, 100) == -1);
  x.reset(); assert(x.update(88, 10000, 100) == 88);
  // Alternating noise is strongly reduced after settling.
  filter.reset(); filter.update(50, 0, 100);
  for (uint32_t t = 10; t <= 1000; t += 10) {
    const float input = (t / 10) % 2 ? 60 : 40;
    assert(std::fabs(filter.update(input, t, 100) - 50) < 1);
  }
  puts("Smoothing timing, startup, bypass, reset, rollover and noise: PASS");
}
