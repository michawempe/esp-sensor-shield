"""Real AnalogSampler with a simulated DMA driver; tests signal windows and lifecycle."""
import pathlib,subprocess,tempfile
source=pathlib.Path(__file__).resolve().parents[2]/'esp_firmware/ilab_ESP32_S3_Sensor_Shield/runtime/AnalogSampler.h'
arduino=r'''
#pragma once
#include <cstdint>
#define IRAM_ATTR
#define INPUT 0
#define ADC_11db 3
#define SOC_ADC_DIGI_RESULT_BYTES 4
inline uint32_t clockMs=0;
inline uint32_t millis(){return clockMs;}
inline void pinMode(uint8_t,int){}
inline void analogSetPinAttenuation(uint8_t,int){}
inline int analogRead(uint8_t){return 1234;}
'''
driver=r'''
#pragma once
#include <cstdint>
#include <deque>
#include <cstring>
#include <algorithm>
#include <cassert>
#define ESP_OK 0
#define ADC_ATTEN_DB_12 3
#define ADC_BITWIDTH_12 12
#define ADC_UNIT_1 0
#define ADC_CONV_SINGLE_UNIT_1 1
#define ADC_DIGI_OUTPUT_FORMAT_TYPE2 2
using adc_continuous_handle_t=void*;
struct adc_continuous_evt_data_t{};
struct adc_continuous_handle_cfg_t{uint32_t max_store_buf_size,conv_frame_size;struct{bool flush_pool;}flags;};
struct adc_digi_pattern_config_t{uint32_t atten,channel,unit,bit_width;};
struct adc_continuous_config_t{uint32_t sample_freq_hz,conv_mode,format,pattern_num;adc_digi_pattern_config_t* adc_pattern;};
struct adc_digi_output_data_t{struct{uint32_t data:12;uint32_t channel:4;uint32_t unit:1;uint32_t unused:15;}type2;};
using Callback=bool(*)(adc_continuous_handle_t,const adc_continuous_evt_data_t*,void*);
struct adc_continuous_evt_cbs_t{Callback on_conv_done,on_pool_ovf;};
inline std::deque<uint8_t> dma;
inline Callback overflowCallback=nullptr;
inline void* callbackContext=nullptr;
inline bool failStart=false;
inline int handles=0, running=0;
inline uint32_t rate=0;
inline int adc_continuous_new_handle(const adc_continuous_handle_cfg_t*,void** h){++handles;*h=(void*)1;return 0;}
inline int adc_continuous_config(void*,const adc_continuous_config_t* c){rate=c->sample_freq_hz;assert(rate<=83333);return 0;}
inline int adc_continuous_register_event_callbacks(void*,const adc_continuous_evt_cbs_t* c,void* ctx){overflowCallback=c->on_pool_ovf;callbackContext=ctx;return 0;}
inline int adc_continuous_start(void*){if(failStart)return 1;++running;return 0;}
inline int adc_continuous_stop(void*){--running;return 0;}
inline int adc_continuous_deinit(void*){--handles;dma.clear();return 0;}
inline int adc_continuous_flush_pool(void*){dma.clear();return 0;}
inline int adc_continuous_read(void*,uint8_t* b,uint32_t n,uint32_t* size,uint32_t){*size=std::min<size_t>(n,dma.size());for(uint32_t i=0;i<*size;++i){b[i]=dma.front();dma.pop_front();}return *size?0:1;}
inline void sample(uint32_t channel,uint32_t value){adc_digi_output_data_t d={};d.type2.channel=channel;d.type2.data=value;auto* b=reinterpret_cast<uint8_t*>(&d);for(int i=0;i<4;++i)dma.push_back(b[i]);}
'''
test=r'''
#include "AnalogSampler.h"
#include <cassert>
int main(){
  for(int pin:{1,4,5,8,9})analogSampler.addPin(pin,pin==1);
  assert(analogSampler.start());assert(rate==80000&&analogSampler.rate()==16000);
  for(int i=0;i<320;++i){sample(0,i%2?3000:1000);for(int channel:{3,4,7,8})sample(channel,2000+channel);}
  clockMs=20;analogSampler.poll();
  assert(analogSampler.sound(1).peak==2000&&analogSampler.sound(1).windows==1);
  assert(analogSampler.sound(1).samples==320&&analogSampler.ready(1));
  assert(analogSampler.read(8)==2007&&analogSampler.read(17)==1234);
  for(int i=0;i<319;++i)sample(0,1500);
  clockMs=39;analogSampler.poll();assert(analogSampler.sound(1).windows==1);
  sample(0,1700);clockMs=40;analogSampler.poll();assert(analogSampler.sound(1).windows==2&&analogSampler.sound(1).peak==200);
  // Incomplete windows may not straddle lost DMA data.
  sample(0,0);clockMs=41;analogSampler.poll();
  overflowCallback(nullptr,nullptr,callbackContext);analogSampler.poll();
  assert(!analogSampler.ready(1));
  for(int i=0;i<320;++i)sample(0,2000);
  clockMs=61;analogSampler.poll();assert(analogSampler.sound(1).peak==0&&analogSampler.overflows()==1);
  clockMs=162;assert(!analogSampler.ready(1));
  sample(0,4095);analogSampler.poll();assert(!analogSampler.ready(1)); // Old backlog flushed after long scheduling gap.
  analogSampler.reset();assert(handles==0&&running==0);
  // No sound: block size must still permit fresh analog values at 50 Hz.
  analogSampler.addPin(1);assert(analogSampler.start());assert(rate==1000);
  sample(0,2345);++clockMs;analogSampler.poll();assert(analogSampler.read(1)==2345);
  analogSampler.reset();
  for(int pin=1;pin<=9;++pin)analogSampler.addPin(pin,true);
  assert(analogSampler.start());assert(rate<=80000&&analogSampler.rate()>=8000);
  analogSampler.reset();
  failStart=true;analogSampler.addPin(1,true);assert(!analogSampler.start());assert(handles==0&&running==0&&!analogSampler.healthy());
  analogSampler.reset();
}
'''
with tempfile.TemporaryDirectory() as d:
    p=pathlib.Path(d);(p/'esp_adc').mkdir()
    (p/'Arduino.h').write_text(arduino);(p/'esp_adc/adc_continuous.h').write_text(driver)
    (p/'AnalogSampler.h').write_text(source.read_text());(p/'test.cpp').write_text(test)
    subprocess.run(['c++','-std=c++17','-Wall','-Wextra','-fsanitize=undefined','-I'+d,str(p/'test.cpp'),'-o',str(p/'test')],check=True)
    subprocess.run([str(p/'test')],check=True)
print('DMA channel routing, peak windows, stale/overflow recovery, rate cap and cleanup: PASS')
