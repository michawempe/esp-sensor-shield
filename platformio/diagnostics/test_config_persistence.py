"""Normal-firmware regression: change smoothing through the real NVS write path.
Requires an exported config matching the attached sensors. Restores it on exit.
Unlike stress commands, these changes are persisted to flash.
"""
import argparse
import copy
import json
import pathlib
import time
from collections import Counter

import serial
from serial.tools.list_ports import comports

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--config', type=pathlib.Path, required=True)
parser.add_argument('--out', type=pathlib.Path, default=pathlib.Path('diagnostics/config-test'))
parser.add_argument('--cycles', type=int, default=30)
args = parser.parse_args()
original = json.loads(args.config.read_text())
assert isinstance(original, dict) and original
smooth_types = {'slider', 'light', 'sound', 'magnet', 'joystick', 'distance'}
ports = [p for p, v in original.items() if isinstance(v, dict) and v.get('type') in smooth_types]
assert ports, 'Config contains no sensors with smoothing'
expected_ports = {p for p, v in original.items() if isinstance(v, dict) and v.get('type') not in ('none', None)}
usb = [p.device for p in comports() if p.vid == 0x303A and p.pid == 0x1001]
assert len(usb) == 1, usb
args.out.mkdir(parents=True, exist_ok=True)
(args.out / 'original-config.json').write_text(json.dumps(original, indent=2) + '\n')
results = []

def receive(connection):
    try:
        return json.loads(connection.readline())
    except ValueError:
        return {}

def apply_and_check(connection, label, config):
    connection.write((json.dumps(config) + '\n').encode())
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        frame = receive(connection)
        if frame.get('error'):
            raise AssertionError(frame)
        if frame.get('status') == 'config_applied':
            assert frame.get('persisted') is True, frame
            break
    else:
        raise TimeoutError('Missing config acknowledgement')
    # New sound windows and distance measurements need a short warmup.
    ready = time.monotonic() + .3
    while time.monotonic() < ready:
        receive(connection)
    deadline = time.monotonic() + 1.2
    errors = Counter()
    timestamps = []
    while time.monotonic() < deadline:
        frame = receive(connection)
        if frame.get('error'):
            errors[str(frame['error'])] += 1
        if 'data' not in frame:
            continue
        timestamps.append(time.monotonic())
        readings = frame['data']
        if {v.get('port') for v in readings.values()} != expected_ports:
            errors['sensor_set_changed'] += 1
        for name, value in readings.items():
            if value.get('error') or value.get('value') is None or value.get('raw') is None:
                errors[name + ':' + str(value.get('error'))] += 1
            port = value.get('port')
            if port in ports and value.get('smoothingMs') != config[port].get('smoothingMs', 0):
                errors[name + ':wrong_smoothing'] += 1
    hz = (len(timestamps) - 1) / (timestamps[-1] - timestamps[0]) if len(timestamps) > 1 else 0
    result = dict(phase=label, frames=len(timestamps), hz=hz, errors=dict(errors), persisted=True)
    results.append(result)
    (args.out / 'summary.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(result), flush=True)
    assert len(timestamps) >= 50 and 45 < hz < 55 and not errors, result

with serial.Serial(usb[0], 115200, timeout=.2, write_timeout=5) as connection:
    try:
        for i in range(args.cycles):
            config = copy.deepcopy(original)
            port = ports[i % len(ports)]
            ms = [0, 25, 100, 250, 1000, 10000][(i // len(ports)) % 6]
            config[port]['smoothingMs'] = ms
            apply_and_check(connection, f'{i}:{port}:{ms}ms', config)
    finally:
        apply_and_check(connection, 'restored', original)
