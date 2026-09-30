"""Prefer the native ESP USB port over the board's second CH343 port."""
Import("env")

from serial.tools.list_ports import comports

if "upload" in COMMAND_LINE_TARGETS and not env.subst("$UPLOAD_PORT"):
    ports = [p.device for p in comports() if p.vid == 0x303A and p.pid == 0x1001]
    if len(ports) == 1:
        env.Replace(UPLOAD_PORT=ports[0])
        print("Native ESP32-S3 upload port: " + ports[0])
    else:
        raise RuntimeError(
            "Expected one native ESP32-S3 USB port (303A:1001). "
            "Connect the board or specify --upload-port explicitly."
        )
