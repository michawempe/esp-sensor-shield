"""Mixed-sensor 50-Hz test; requires sensor-shield-stress. No NVS writes."""
import json,pathlib,time,statistics,sys
import serial
from serial.tools.list_ports import comports
edges='--edges' in sys.argv
out=pathlib.Path('diagnostics/continuous-test') / ('edges' if edges else '.')
out.mkdir(parents=True,exist_ok=True)
ports=[p for p in comports() if p.vid==0x303A and p.pid==0x1001];assert len(ports)==1
s=serial.Serial(ports[0].device,115200,timeout=.2,write_timeout=5)
s.dtr=True;s.rts=False
results=[]
log=(out/'frames.jsonl').open('w')
def command(obj):
    s.write(('!'+json.dumps(obj)+'\n').encode())
    end=time.monotonic()+10
    while time.monotonic()<end:
        try:f=json.loads(s.readline())
        except ValueError:continue
        if f.get('stress')=='ok':return f
        if isinstance(f.get('stress'),str):raise RuntimeError(f)
        if f.get('error'):raise RuntimeError(f)
    raise TimeoutError(obj)
def capture(label,seconds,settle=.3):
    # Drain warmup rather than leaving USB backpressure during settling.
    until=time.monotonic()+settle
    while time.monotonic()<until:s.readline()
    end=time.monotonic()+seconds
    rows=[];times=[];bad=[];events=[]
    while time.monotonic()<end:
        b=s.readline();t=time.monotonic()
        if not b:continue
        log.write(json.dumps({'phase':label,'t':t,'line':b.decode(errors='replace')})+'\n')
        try:f=json.loads(b)
        except ValueError:bad.append(b.decode(errors='replace')[:100]);continue
        if 'data' in f:rows.append(f);times.append(t)
        else:events.append(f)
    log.flush()
    assert len(rows)>1,label
    elapsed=((rows[-1]['stress']['us']-rows[0]['stress']['us'])&0xffffffff)/1e6
    sensors={}
    for name,v in rows[-1]['data'].items():
        samples=[r['data'][name] for r in rows]
        stats={'errors':sum(bool(x.get('error')) or x.get('value') is None for x in samples)}
        if v['type']=='sound':
            a=samples[0]['diag'];b=v['diag']
            stats.update(sample_hz=(b['samples']-a['samples'])/elapsed,window_hz=(b['windows']-a['windows'])/elapsed,configured_hz=b['sampleRateHz'],age_max_ms=max(x['diag']['ageMs'] for x in samples),overflows=b['overflows']-a['overflows'])
        if v['type']=='distance':
            stats.update(measurement_hz=(v['diag']['measurements']-samples[0]['diag']['measurements'])/elapsed,age_max_ms=max(x['diag']['ageMs'] for x in samples))
        sensors[name]=stats
    gaps=sum(b['stress']['seq']!=a['stress']['seq']+1 for a,b in zip(rows,rows[1:]))
    dt=sorted((b-a)*1000 for a,b in zip(times,times[1:]))
    r={'phase':label,'frames':len(rows),'hz':(len(rows)-1)/(times[-1]-times[0]),'p99_ms':dt[int(.99*(len(dt)-1))],'max_ms':max(dt),'gaps':gaps,'invalid_json':len(bad),'events':events,'heap_first':rows[0]['stress']['heap'],'heap_last':rows[-1]['stress']['heap'],'sensors':sensors}
    results.append(r);(out/'summary.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(r),flush=True)
    assert 49<=r['hz']<=51 and not gaps and not bad and not events,r
    for name,stats in sensors.items():
        assert stats['errors']==0,(label,name,stats)
        if 'sample_hz' in stats:
            assert .95*stats['configured_hz']<stats['sample_hz']<1.05*stats['configured_hz'],stats
            assert 49<=stats['window_hz']<=52 and stats['age_max_ms']<40 and stats['overflows']==0,stats
        if 'measurement_hz' in stats:
            assert stats['measurement_hz']>=49 and stats['age_max_ms']<40,stats
    return r
original=command({})['config'];(out/'original-config.json').write_text(json.dumps(original,indent=2)+'\n')
try:
    if edges:
        for label,cfg in [('single_slider',{'B3':original['B3']}),('single_sound',{'B2':original['B2']}),('empty',{})]:
            command({'config':cfg,'intervalMs':20,'distanceBudgetUs':20000});capture(label,5)
        for i in range(20):
            command({'config':original});capture(f'lifecycle_{i}',2)
        tail=[r['heap_last'] for r in results if r['phase'].startswith('lifecycle_')][5:]
        assert max(tail)-min(tail)<1024,tail
    else:
        command({'config':original,'intervalMs':20,'distanceBudgetUs':20000})
        capture('all_nine_120s',120)
        no_sound={k:v for k,v in original.items() if v['type']!='sound'}
        command({'config':no_sound});capture('without_sound',10)
        five={**original,**{f'B{i}':{'type':'sound','name':f'sound{i}'} for i in range(1,6)},'C4':{'type':'joystick','name':'adc2stick'}}
        command({'config':five});capture('five_sounds_and_adc2',20)
        for i in range(5):
            command({'config':original});capture(f'reapply_{i}',5)
        s.close();time.sleep(2);s.open();s.dtr=True;s.rts=False
        command({});capture('reconnect',10)
        # Force USB backpressure; discard damaged lines/backlog before measuring recovery.
        time.sleep(5)
        capture('after_reader_pause',10,settle=2)
finally:
    if not s.is_open:s.open()
    s.write(b'\n');command({'config':original,'intervalMs':20,'distanceBudgetUs':20000})
    capture('restored',10)
    s.close();log.close()
print('All continuous-acquisition assertions: PASS',flush=True)
