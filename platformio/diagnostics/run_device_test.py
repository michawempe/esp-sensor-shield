import serial,time,json,pathlib,sys
from serial.tools.list_ports import comports
out=pathlib.Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
require_diag = '--normal' not in sys.argv
config=json.loads(pathlib.Path('diagnostics/device-test/original-config.json').read_text())
assert set(config)=={'C1','C2'} and all(s['type']=='distance' for s in config.values()),config
(out/'original-config.json').write_text(json.dumps(config,indent=2)+'\n')
ports=[p.device for p in comports() if p.vid==0x303a and p.pid==0x1001]
assert len(ports)==1,ports
s=serial.Serial(ports[0],115200,timeout=.5);s.dtr=True;s.rts=False
log=(out/'frames.jsonl').open('w');results=[];configuration_changed=False
def capture(phase,seconds,expected,command=None):
 global configuration_changed
 if command is not None:
  configuration_changed=True
  s.write((json.dumps(command)+'\n').encode());s.flush()
 end=time.monotonic()+seconds; frames=[];events=[];acks=0
 while time.monotonic()<end:
  line=s.readline().decode(errors='replace').strip()
  if not line:continue
  log.write(json.dumps({'phase':phase,'line':line})+'\n');log.flush()
  try:f=json.loads(line)
  except ValueError:continue
  if f.get('status')=='config_applied':acks+=1
  if f.get('diag')=='vl53_lifecycle':events.append(f)
  if 'data' in f and (command is None or acks):frames.append(f['data'])
 stats={}
 for port in expected:
  samples=[sensor for frame in frames for sensor in frame.values() if sensor.get('port')==port]
  stats[port]={'samples':len(samples),'nulls':sum(x.get('raw') is None or x.get('value') is None for x in samples),'errors':sorted(set(x['error'] for x in samples if 'error' in x)),'raw_min':min([x['raw'] for x in samples if x.get('raw') is not None],default=None),'raw_max':max([x['raw'] for x in samples if x.get('raw') is not None],default=None),'last_diag':samples[-1].get('diag') if samples else None}
 r={'phase':phase,'frames':len(frames),'acks':acks,'sensors':stats,'lifecycle':events}
 r['pass']=bool(frames) and (command is None or acks>0) and all(v['samples']==len(frames) and not v['nulls'] and not v['errors'] and (not require_diag or v['last_diag'] is not None) for v in stats.values())
 results.append(r);(out/'summary.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps({k:v for k,v in r.items() if k!='lifecycle'}),flush=True)
 return r['pass']
try:
 if not capture('configure_two',20,['C1','C2'],config):raise RuntimeError('Two-sensor configuration did not produce valid measurements')
 capture('reapply_two',15,['C1','C2'],config)
 capture('one_sensor',8,['C1'],{'C1':config['C1']})
 capture('one_to_two',20,['C1','C2'],config)
 capture('repeat_two',15,['C1','C2'],config)
finally:
 # Restore both original entries even if a phase raises an exception.
 if configuration_changed:
  capture('restored',10,['C1','C2'],config)
 s.close();log.close()
sys.exit(0 if all(r['pass'] for r in results) else 1)
