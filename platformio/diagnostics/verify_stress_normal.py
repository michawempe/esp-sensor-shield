"""Final read-only/invalid-input check after uploading the normal build."""
import argparse
import json
import pathlib
import time
import serial
from serial.tools.list_ports import comports
parser=argparse.ArgumentParser()
parser.add_argument('--out',default='diagnostics/stress-test')
parser.add_argument('--min-hz',type=float,default=0)
parser.add_argument('--reapply',action='store_true')
args=parser.parse_args()
out=pathlib.Path(args.out)
original=json.loads((out/'original-config.json').read_text())
expected={cfg['name']:cfg for cfg in original.values()}
ports=[p.device for p in comports() if p.vid==0x303A and p.pid==0x1001]
assert len(ports)==1,ports
results=[]
with serial.Serial(ports[0],115200,timeout=.3) as s:
    s.dtr=True;s.rts=False
    def capture(label,seconds,command=None):
        if command:s.write(command)
        frames=[];events=[];bad=[];times=[]
        started=time.monotonic()
        end=time.monotonic()+seconds
        while time.monotonic()<end:
            b=s.readline()
            if not b:continue
            try:f=json.loads(b)
            except ValueError:bad.append(b.decode(errors='replace'));continue
            if 'data' in f:
                if label=='normal_reapply' and time.monotonic()-started<.25:continue
                assert 'stress' not in f, 'Diagnostic firmware still installed'
                assert set(f['data'])==set(expected), f
                for name,value in f['data'].items():
                    assert value['type']==expected[name]['type']
                    assert value['value'] is not None and not value.get('error'), value
                frames.append(f);times.append(time.monotonic())
            else:events.append(f)
        r={'phase':label,'frames':len(frames),'hz':(len(times)-1)/(times[-1]-times[0]) if len(times)>1 else 0,'invalid':bad,'events':events,'last_frame':frames[-1] if frames else None}
        results.append(r)
        (out/'normal-verification.json').write_text(json.dumps(results,indent=2)+'\n')
        assert frames and not bad,r
        return r
    try:
        first=capture('normal_after_upload',10)
        assert first['hz']>=args.min_hz,first
        if args.reapply:
            r=capture('normal_reapply',5,(json.dumps(original)+'\n').encode())
            assert any(e.get('status')=='config_applied' and e.get('persisted') is True for e in r['events']),r
        r=capture('normal_partial_timeout',4,b'{')
        assert sum(e.get('error')=='serial_line_timeout' for e in r['events'])==1,r
        capture('normal_resync',3,b'\n')
        r=capture('normal_invalid_config',3,b'{"unknown_port":{}}\n')
        assert any(e.get('error')=='bad_json' and e.get('persisted') is False for e in r['events']),r
    finally:
        s.write(b'\n')
print(json.dumps({'result':'PASS','phases':[{k:v for k,v in r.items() if k!='last_frame'} for r in results]},indent=2))
