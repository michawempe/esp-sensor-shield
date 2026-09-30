"""Reset the ESP32 through its CH343 port and verify the persisted two-sensor config."""
import json
import pathlib
import subprocess
import sys
import time

import serial
from serial.tools.list_ports import comports

out = pathlib.Path(sys.argv[1])
uart = [p.device for p in comports() if p.vid == 0x1A86 and p.pid == 0x55D3]
assert len(uart) == 1, uart
reset = subprocess.run([sys.executable, '-m', 'esptool', '--chip', 'esp32s3', '--port', uart[0], '--no-stub', 'run'], capture_output=True, text=True, timeout=30)
(out/'restart.log').write_text(reset.stdout + reset.stderr)
reset.check_returncode()
time.sleep(2)
ports = [p.device for p in comports() if p.vid == 0x303A and p.pid == 0x1001]
assert len(ports) == 1, ports
lines, frames = [], []
with serial.Serial(ports[0], 115200, timeout=.5) as connection:
    connection.dtr = True
    connection.rts = False
    end = time.monotonic() + 20
    while time.monotonic() < end:
        line = connection.readline().decode(errors='replace').strip()
        if not line:
            continue
        lines.append(line)
        try:
            frame = json.loads(line)
        except ValueError:
            continue
        if 'data' in frame:
            frames.append(frame['data'])
(out/'after-restart.jsonl').write_text('\n'.join(lines)+'\n')
result = {'frames': len(frames), 'sensors': {}}
for port in ['C1', 'C2']:
    samples = [sensor for frame in frames for sensor in frame.values() if sensor.get('port') == port]
    result['sensors'][port] = {
        'samples': len(samples),
        'nulls': sum(s.get('raw') is None or s.get('value') is None for s in samples),
        'errors': sorted({s['error'] for s in samples if 'error' in s}),
        'last': samples[-1] if samples else None,
    }
result['pass'] = bool(frames) and all(s['samples'] == len(frames) and not s['nulls'] and not s['errors'] for s in result['sensors'].values())
(out/'restart-summary.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result))
sys.exit(0 if result['pass'] else 1)
