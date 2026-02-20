const Shared = window.ConfigPageShared;
if (!Shared) throw new Error("Missing ConfigPageShared. Load shared-core.js before index-app.js.");
const SerialShared = window.ConfigPageSerial;
if (!SerialShared) throw new Error("Missing ConfigPageSerial. Load shared-serial.js before index-app.js.");
const PresetShared = window.ConfigPagePresets;
if (!PresetShared) throw new Error("Missing ConfigPagePresets. Load shared-presets.js before index-app.js.");

const RELATIVE_PRESET_DIR_URL = "./config/presets/";
const TOOLBAR_HIDDEN_KEY = "index_toolbar_hidden_v1";
const app = document.getElementById("app") || document.body;

app.insertAdjacentHTML("afterbegin", `
  <style>
    @font-face {
      font-family: "GT Haptik";
      src: url("./configpage/font/GT-Haptik-Regular-Trial.otf") format("opentype");
      font-style: normal;
      font-weight: 400;
      font-display: swap;
    }

    :root{
      --bg: #e6e6e6;
      --chip: #ffffff;
      --chip-border: #000000;
      --text: #000000;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "GT Haptik", "Avenir Next", "Trebuchet MS", sans-serif;
    }

    #app { min-height: 100vh; }

    .toolbar {
      position: fixed;
      top: 16px;
      right: 16px;
      left: auto;
      width: auto;
      max-width: calc(100vw - 32px);
      border: 1.4px solid var(--chip-border);
      border-radius: 12px;
      background: var(--chip);
      padding: 8px;
      display: grid;
      gap: 8px;
      z-index: 1000;
    }
    .toolbar.hidden { display: none; }

    .toolbar-row {
      display: flex;
      gap: 0;
      align-items: center;
      flex-wrap: nowrap;
      justify-content: flex-end;
    }
    .toolbar-row > * + * {
      margin-left: 30px;
    }
    #presetSelect + #btnLoadPreset {
      margin-left: 8px;
    }

    .btn,
    .preset-select {
      height: 32px;
      border: 1.4px solid var(--chip-border);
      border-radius: 8px;
      background: var(--chip);
      color: var(--text);
      font: inherit;
      font-size: 15px;
      padding: 0 12px;
    }

    .btn {
      cursor: pointer;
      white-space: nowrap;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
    }

    .preset-select {
      width: auto;
      min-width: 0;
      flex: 0 0 auto;
    }
    .status { min-height: 16px; font-size: 13px; color: #555; }
    .status.err { color: #b11c1c; }
    #status,
    #dataProbe {
      display: none !important;
    }
    .toolbar-open {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 1001;
    }
    .toolbar-open[hidden] { display: none; }

    .probe {
      position: fixed;
      left: 16px;
      bottom: 16px;
      border: 1.4px solid var(--chip-border);
      border-radius: 10px;
      background: var(--chip);
      padding: 8px 10px;
      display: inline-flex;
      gap: 8px;
      align-items: center;
      font-size: 14px;
      z-index: 1000;
    }
    .probe-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      border: 1.4px solid var(--chip-border);
      background: #c8c8c8;
      display: inline-block;
    }
    .probe-dot.live { background: #22b14c; }
    .probe-dot.waiting { background: #f0b429; }
    .probe-dot.offline { background: #c8c8c8; }
  </style>

  <div id="toolbar" class="toolbar">
    <div class="toolbar-row">
      <button id="btnConnect" class="btn" type="button">Connect</button>
      <select id="presetSelect" class="preset-select"></select>
      <button id="btnLoadPreset" class="btn" type="button">Load Preset</button>
      <a class="btn" href="./configpage/">Config Page</a>
      <button id="btnHideToolbar" class="btn" type="button">Hide</button>
    </div>
    <div id="status" class="status"></div>
  </div>
  <button id="btnShowToolbar" class="btn toolbar-open" type="button" hidden>Show Controls</button>
  <div id="dataProbe" class="probe">
    <span id="dataProbeDot" class="probe-dot offline"></span>
    <span id="dataProbeText">Data: not connected</span>
  </div>
`);

const els = {
  toolbar: document.getElementById("toolbar"),
  btnConnect: document.getElementById("btnConnect"),
  presetSelect: document.getElementById("presetSelect"),
  btnLoadPreset: document.getElementById("btnLoadPreset"),
  btnHideToolbar: document.getElementById("btnHideToolbar"),
  btnShowToolbar: document.getElementById("btnShowToolbar"),
  status: document.getElementById("status"),
  dataProbeDot: document.getElementById("dataProbeDot"),
  dataProbeText: document.getElementById("dataProbeText"),
};

const state = {
  sensorGlobalNames: new Set(),
  frameCount: 0,
  lastFrameAt: 0,
  probeTimer: null,
};

const ackTracker = new SerialShared.AckTracker("No config response from ESP (timeout)");
const serialClient = new SerialShared.SerialJsonClient({
  serialApi: navigator.serial,
  onJson: handleJsonObject,
  onReadError: async (err) => {
    setStatus(`Serial read error: ${err.message}`, true);
    await closeSerial("Serial read error.");
    setConnectedUi(false);
    updateDataProbe();
  },
  onDisconnect: () => {
    ackTracker.cancel("USB device disconnected.");
    setConnectedUi(false);
    setStatus("USB device disconnected.", true);
    updateDataProbe();
  },
});

window.SENSORS = { data: {} };
window.getValue = (sensorName, fallback = undefined) => {
  const value = window.SENSORS?.data?.[sensorName]?.value;
  return value === undefined ? fallback : value;
};

function setStatus(message, isError = false) {
  els.status.textContent = message || "";
  els.status.classList.toggle("err", !!isError);
}

function setToolbarHidden(hidden) {
  els.toolbar.classList.toggle("hidden", hidden);
  els.btnShowToolbar.hidden = !hidden;
  try {
    localStorage.setItem(TOOLBAR_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    // Ignore localStorage issues.
  }
}

function setConnectedUi(on) {
  els.btnConnect.textContent = on ? "Reconnect" : "Connect";
}

function updateDataProbe() {
  const connected = serialClient.isConnected();
  const now = Date.now();
  const age = state.lastFrameAt ? (now - state.lastFrameAt) : Number.POSITIVE_INFINITY;
  const isLive = connected && age <= 1500;

  els.dataProbeDot.className = "probe-dot";
  if (!connected) {
    els.dataProbeDot.classList.add("offline");
    els.dataProbeText.textContent = "Data: not connected";
    return;
  }
  if (isLive) {
    els.dataProbeDot.classList.add("live");
    els.dataProbeText.textContent = `Data: live (${state.frameCount} frames)`;
    return;
  }
  els.dataProbeDot.classList.add("waiting");
  els.dataProbeText.textContent = `Data: waiting (${state.frameCount} frames)`;
}

function syncSensorGlobals(dataObj) {
  for (const name of state.sensorGlobalNames) {
    try { delete window[name]; } catch {}
  }
  state.sensorGlobalNames.clear();

  for (const [name, sensor] of Object.entries(dataObj || {})) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
    if (Object.prototype.hasOwnProperty.call(window, name)) continue;
    window[name] = sensor;
    state.sensorGlobalNames.add(name);
  }
}

function handleJsonObject(obj) {
  if (obj?.data && typeof obj.data === "object") {
    window.SENSORS = obj;
    state.frameCount += 1;
    state.lastFrameAt = Date.now();
    updateDataProbe();
    syncSensorGlobals(obj.data);
    if (typeof window.onSensorFrame === "function") {
      try { window.onSensorFrame(obj); } catch {}
    }
    window.dispatchEvent(new CustomEvent("sensor-frame", { detail: obj }));
  }

  ackTracker.consumeJson(obj);
}

async function closeSerial(ackReason = "Serial connection closed.") {
  ackTracker.cancel(ackReason);
  await serialClient.disconnect();
  updateDataProbe();
}

async function resolvePortForConnect() {
  return Shared.resolveIlabPortForConnect(navigator.serial, serialClient.currentPort());
}

async function connectOrReconnect() {
  await serialClient.connect({
    resolvePort: resolvePortForConnect,
    baudRate: 115200,
  });
  setConnectedUi(true);
  setStatus("");
  updateDataProbe();
}

function waitForConfigAck(timeoutMs = 3500) {
  return ackTracker.wait(timeoutMs);
}

async function sendPayload(payloadObj) {
  await serialClient.sendJson(payloadObj);
}

async function refreshPresetSelect(keepValue = "") {
  const names = await PresetShared.listRelativePresetNames(RELATIVE_PRESET_DIR_URL, {
    include: new Set(["default.json", "empty.json"]),
    exclude: new Set(["presets.json"]),
  });

  const selected = keepValue || els.presetSelect.value || "";
  els.presetSelect.innerHTML = "";
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    els.presetSelect.appendChild(option);
  }
  if (selected && names.includes(selected)) {
    els.presetSelect.value = selected;
  }
}

async function loadSelectedPreset() {
  if (!serialClient.isConnected()) throw new Error("Connect first, then load a preset.");
  const presetName = els.presetSelect.value;
  if (!presetName) throw new Error("No preset selected.");

  const parsed = await PresetShared.loadRelativePresetObject(RELATIVE_PRESET_DIR_URL, presetName);
  const payload = Shared.buildPayloadFromPresetObject(parsed, {
    portOrder: Shared.PORT_ORDER,
    portTypeOptions: Shared.PORT_TYPE_OPTIONS_BASE,
    noneType: "none",
  });

  const ackPromise = waitForConfigAck(4000);
  await sendPayload(payload);
  await ackPromise;
  setStatus("");
}

async function init() {
  if (!navigator.serial) {
    setStatus("WebSerial not supported in this browser.", true);
    els.btnConnect.disabled = true;
    els.btnLoadPreset.disabled = true;
    els.btnHideToolbar.disabled = true;
    updateDataProbe();
    return;
  }

  setConnectedUi(false);
  await refreshPresetSelect();
  updateDataProbe();

  const initiallyHidden = (() => {
    try {
      return localStorage.getItem(TOOLBAR_HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  })();
  setToolbarHidden(initiallyHidden);
  state.probeTimer = window.setInterval(updateDataProbe, 400);

  els.btnConnect.addEventListener("click", async () => {
    try {
      await connectOrReconnect();
    } catch (err) {
      setConnectedUi(false);
      setStatus(`Connect failed: ${err.message}`, true);
      updateDataProbe();
    }
  });

  els.btnLoadPreset.addEventListener("click", async () => {
    try {
      await loadSelectedPreset();
    } catch (err) {
      setStatus(`Load preset failed: ${err.message}`, true);
    }
  });

  els.presetSelect.addEventListener("focus", () => {
    refreshPresetSelect(els.presetSelect.value).catch(() => {});
  });

  els.btnHideToolbar.addEventListener("click", () => setToolbarHidden(true));
  els.btnShowToolbar.addEventListener("click", () => setToolbarHidden(false));
}

init().catch((err) => {
  setStatus(`Init failed: ${err.message}`, true);
});
