"""Run against sensor-shield-stress. Test configuration/rates stay in RAM.
Use --verify after applying RX timeout fixes. Logs contain host and device timing.
"""
import argparse
import json
import pathlib
import statistics
import time
import serial
from serial.tools.list_ports import comports

parser = argparse.ArgumentParser()
parser.add_argument('--out', default='diagnostics/stress-test')
parser.add_argument('--seconds', type=float, default=8)
parser.add_argument('--verify', action='store_true')
args = parser.parse_args()
out = pathlib.Path(args.out)
out.mkdir(parents=True, exist_ok=True)
ports = [p for p in comports() if p.vid == 0x303A and p.pid == 0x1001]
assert len(ports) == 1, ports
(out/'device.json').write_text(json.dumps({'port':ports[0].device,'serial':ports[0].serial_number},indent=2))
s = serial.Serial(ports[0].device,115200,timeout=.2,write_timeout=5)
s.dtr=True
s.rts=False
log=(out/'frames.jsonl').open('w')
results=[]


def command(obj):
    s.write(('!'+json.dumps(obj)+'\n').encode())
    end=time.monotonic()+10
    while time.monotonic()<end:
        try: f=json.loads(s.readline())
        except ValueError: continue
        if f.get('stress')=='ok': return f
        if f.get('stress')=='config_failed': raise RuntimeError(f)
    raise TimeoutError(obj)


def capture(label,seconds,stimulus=None):
    frames,times,sizes,errors,events=[],[],[],[],[]
    started=time.monotonic()
    if stimulus: stimulus()
    while time.monotonic()-started<seconds:
        b=s.readline()
        t=time.monotonic()
        if not b: continue
        log.write(json.dumps({'phase':label,'t':t,'line':b.decode(errors='replace')})+'\n')
        try: f=json.loads(b)
        except ValueError:
            errors.append(b.decode(errors='replace')[:100]);continue
        if 'data' in f and isinstance(f.get('stress'),dict):
            frames.append(f);times.append(t);sizes.append(len(b))
        else: events.append(f)
    log.flush()
    def pct(a,q): return sorted(a)[int((len(a)-1)*q)] if a else None
    host_dt=[(b-a)*1000 for a,b in zip(times,times[1:])]
    device_dt=[((b['stress']['us']-a['stress']['us']) & 0xffffffff)/1000 for a,b in zip(frames,frames[1:])]
    gaps=sum(((b['stress']['seq']-a['stress']['seq']) & 0xffffffff)!=1 for a,b in zip(frames,frames[1:]))
    r={'phase':label,'seconds':time.monotonic()-started,'frames':len(frames),
       'hz':(len(times)-1)/(times[-1]-times[0]) if len(times)>1 else 0,
       'host_p99_ms':pct(host_dt,.99),'host_max_ms':max(host_dt,default=None),
       'device_p99_ms':pct(device_dt,.99),'read_p50_ms':pct([f['stress']['readUs']/1000 for f in frames],.5),
       'bytes_per_frame':statistics.mean(sizes) if sizes else 0,
       'sequence_gap_events':gaps,'invalid_json':len(errors),'invalid_examples':errors[:3],
       'sensor_errors':sum(bool(v.get('error')) for f in frames for v in f['data'].values()),
       'null_values':sum(v.get('value') is None for f in frames for v in f['data'].values()),
       'heap_first':frames[0]['stress']['heap'] if frames else None,
       'heap_last':frames[-1]['stress']['heap'] if frames else None,
       'heap_min':min((f['stress']['heap'] for f in frames),default=None),'events':events}
    results.append(r)
    (out/'summary.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(r),flush=True)
    return r

original=command({})['config']
(out/'original-config.json').write_text(json.dumps(original,indent=2)+'\n')
fast={k:v for k,v in original.items() if v['type'] not in ('distance','sound')}
wide={**{f'A{i}':{'type':'button'} for i in range(1,7)},**{f'B{i}':{'type':'slider'} for i in range(1,6)}}
try:
    if not args.verify:
        for label,config,intervals in [('original',original,[40,20,10]),('fast_attached',fast,[40,20,10,5,2,1]),('11_inputs',wide,[20,10,5,2,1])]:
            for interval in intervals:
                command({'config':config,'intervalMs':interval})
                capture(f'{label}_{interval}ms',args.seconds)
        distance={k:v for k,v in original.items() if v['type']=='distance'}
        if distance:
            for budget in [100000,50000,33000,20000]:
                command({'config':distance,'intervalMs':1,'distanceBudgetUs':budget})
                capture(f'distance_only_budget_{budget}us',args.seconds)
        sounds={k:v for k,v in original.items() if v['type']=='sound'}
        if sounds:
            command({'config':sounds,'intervalMs':20})
            capture('sound_only_20ms',args.seconds)
        command({'config':fast,'intervalMs':20})
        capture('soak_50hz',120)
        capture('invalid_json',3,lambda:s.write(b'{oops}\n'))
        capture('oversize_line',3,lambda:s.write(b'x'*8300+b'\n'))
        capture('partial_line_stall',3,lambda:s.write(b'{'))
        capture('partial_line_recovery',3,lambda:s.write(b'oops}\n'))
        capture('command_burst',3,lambda:s.write(b'not-json\n'*100))
        command({'config':wide,'intervalMs':1})
        capture('reader_pause_5s',9,lambda:time.sleep(5))
        command({'intervalMs':20})
        capture('after_reader_pause',4)
        s.close();time.sleep(2);s.open();s.dtr=True;s.rts=False
        command({'intervalMs':20})
        capture('reopen',4)
    else:
        command({'config':original,'intervalMs':20,'distanceBudgetUs':20000})
        capture('mixed_budget_20000us',10)
        command({'config':fast,'intervalMs':20})
        capture('partial_timeout',4,lambda:s.write(b'{'))
        capture('partial_resync',2,lambda:s.write(b'oops}\n'))
        capture('oversize_timeout',4,lambda:s.write(b'x'*8300))
        capture('oversize_resync',2,lambda:s.write(b'\n'))
        command({'config':fast,'intervalMs':20})
        capture('verified_50hz',60)
finally:
    if not s.is_open: s.open()
    # End abandoned input, restore RAM state; NVS was never changed.
    s.write(b'\n')
    command({'config':original,'intervalMs':40,'distanceBudgetUs':200000})
    capture('restored',5)
    s.close();log.close()

if args.verify:
    checked={r['phase']:r for r in results}
    for label in ('partial_timeout','oversize_timeout'):
        r=checked[label]
        assert r['frames'] >= 100, r
        assert sum(e.get('error')=='serial_line_timeout' for e in r['events'])==1, r
    r=checked['verified_50hz']
    assert 49 <= r['hz'] <= 51, r
    assert r['sequence_gap_events']==r['invalid_json']==r['sensor_errors']==0, r
    assert r['heap_last'] >= r['heap_first']-1024, r
    assert checked['restored']['frames']>0 and checked['restored']['sensor_errors']==0
    print('Verification assertions: PASS',flush=True)
