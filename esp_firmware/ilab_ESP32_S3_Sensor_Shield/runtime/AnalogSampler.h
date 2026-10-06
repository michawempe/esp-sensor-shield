#pragma once
#include <Arduino.h>
#include <algorithm>
#include "esp_adc/adc_continuous.h"

// ADC1 belongs exclusively to DMA. Mixing analogRead() on ADC1 with continuous
// conversion is unsupported. ADC2 (C3/C4 joystick pins) stays in oneshot mode.
class AnalogSampler {
public:
  struct Channel {
    bool used = false;
    bool sound = false;
    uint16_t latest = 0;
    uint16_t low = 4095;
    uint16_t high = 0;
    uint16_t count = 0;
    uint16_t peak = 0;
    uint32_t samples = 0;
    uint32_t windows = 0;
    uint32_t updatedMs = 0;
    uint32_t sampleMs = 0;
    bool sampled = false;
  };

private:
  Channel channels[10];
  adc_continuous_handle_t handle = nullptr;
  bool running = false;
  uint32_t channelRate = 0;
  uint16_t windowSamples = 0;
  uint32_t overflowCount = 0;
  uint32_t observedOverflows = 0;
  uint32_t lastDrainMs = 0;

  static bool IRAM_ATTR onOverflow(adc_continuous_handle_t,
                                   const adc_continuous_evt_data_t*, void* ctx) {
    auto* self = static_cast<AnalogSampler*>(ctx);
    __atomic_fetch_add(&self->overflowCount, 1u, __ATOMIC_RELAXED);
    return false;
  }

public:
  void reset() {
    if (handle) {
      if (running) adc_continuous_stop(handle);
      adc_continuous_deinit(handle);
    }
    handle = nullptr;
    running = false;
    channelRate = 0;
    windowSamples = 0;
    __atomic_store_n(&overflowCount, 0u, __ATOMIC_RELAXED);
    observedOverflows = 0;
    for (auto& c : channels) c = Channel{};
  }

  void addPin(uint8_t pin, bool sound = false) {
    pinMode(pin, INPUT);
    if (pin >= 1 && pin <= 10) {
      channels[pin - 1].used = true;
      channels[pin - 1].sound |= sound;
    } else {
      analogSetPinAttenuation(pin, ADC_11db);
    }
  }

  bool start() {
    uint32_t count = 0;
    bool hasSound = false;
    for (const auto& c : channels) {
      if (c.used) ++count;
      hasSound |= c.sound;
    }
    if (!count) return true;
    // ESP32-S3 supports at most 83,333 aggregate conversions/s. Keep margin;
    // 16 kHz/channel for up to five active ADC1 pins, reduce fairly beyond that.
    channelRate = hasSound ? std::min<uint32_t>(16000u, 80000u / count) : 1000u;
    windowSamples = channelRate / 50;
    channelRate = windowSamples * 50; // Each sound window represents 20 ms.
    adc_continuous_handle_cfg_t hc = {};
    hc.max_store_buf_size = 32768;
    hc.conv_frame_size = count * 8 * SOC_ADC_DIGI_RESULT_BYTES;
    hc.flags.flush_pool = true;
    if (adc_continuous_new_handle(&hc, &handle) != ESP_OK) return false;
    adc_digi_pattern_config_t pattern[10] = {};
    uint32_t n = 0;
    for (uint8_t i = 0; i < 10; ++i) {
      if (!channels[i].used) continue;
      pattern[n].atten = ADC_ATTEN_DB_12;
      pattern[n].channel = i;
      pattern[n].unit = ADC_UNIT_1;
      pattern[n].bit_width = ADC_BITWIDTH_12;
      ++n;
    }
    adc_continuous_config_t cfg = {};
    cfg.sample_freq_hz = channelRate * count;
    cfg.conv_mode = ADC_CONV_SINGLE_UNIT_1;
    cfg.format = ADC_DIGI_OUTPUT_FORMAT_TYPE2;
    cfg.pattern_num = count;
    cfg.adc_pattern = pattern;
    adc_continuous_evt_cbs_t callbacks = {};
    callbacks.on_pool_ovf = onOverflow;
    if (adc_continuous_config(handle, &cfg) != ESP_OK ||
        adc_continuous_register_event_callbacks(handle, &callbacks, this) != ESP_OK ||
        adc_continuous_start(handle) != ESP_OK) {
      adc_continuous_deinit(handle);
      handle = nullptr;
      return false;
    }
    lastDrainMs = millis();
    running = true;
    return true;
  }

  void poll() {
    if (!running) return;
    const uint32_t overflows = __atomic_load_n(&overflowCount, __ATOMIC_RELAXED);
    const uint32_t now = millis();
    if (overflows != observedOverflows || (uint32_t)(now - lastDrainMs) > 40) {
      observedOverflows = overflows;
      adc_continuous_flush_pool(handle);
      // Do not combine samples on opposite sides of a lost block into a window.
      for (auto& c : channels) {
        c.count = 0; c.low = 4095; c.high = 0; c.sampled = false;
      }
    }
    lastDrainMs = now;
    alignas(4) uint8_t bytes[2048];
    // Bound work after USB backpressure; ordinary loop iterations drain <1 KB.
    for (int batch = 0; batch < 16; ++batch) {
      uint32_t size = 0;
      if (adc_continuous_read(handle, bytes, sizeof(bytes), &size, 0) != ESP_OK) break;
      for (uint32_t i = 0; i + SOC_ADC_DIGI_RESULT_BYTES <= size; i += SOC_ADC_DIGI_RESULT_BYTES) {
        const auto* sample = reinterpret_cast<const adc_digi_output_data_t*>(bytes + i);
        const uint32_t channel = sample->type2.channel;
        if (sample->type2.unit != 0 || channel >= 10 || !channels[channel].used) continue;
        auto& c = channels[channel];
        const uint16_t value = sample->type2.data;
        c.latest = value;
        c.sampleMs = now;
        c.sampled = true;
        ++c.samples;
        if (!c.sound) continue;
        c.low = std::min(c.low, value);
        c.high = std::max(c.high, value);
        if (++c.count == windowSamples) {
          c.peak = c.high - c.low;
          c.updatedMs = millis();
          ++c.windows;
          c.count = 0; c.low = 4095; c.high = 0;
        }
      }
    }
  }

  bool ready(uint8_t pin) const {
    if (pin < 1 || pin > 10) return true; // ADC2 is read on demand.
    const auto& c = channels[pin - 1];
    return running && c.sampled && (uint32_t)(millis() - c.sampleMs) < 100;
  }

  int read(uint8_t pin) const {
    if (pin >= 1 && pin <= 10) return channels[pin - 1].latest;
    return analogRead(pin);
  }
  const Channel& sound(uint8_t pin) const { return channels[pin - 1]; }
  uint32_t rate() const { return channelRate; }
  uint32_t overflows() const { return __atomic_load_n(&overflowCount, __ATOMIC_RELAXED); }
  bool healthy() const { return running; }
};

inline AnalogSampler analogSampler;
