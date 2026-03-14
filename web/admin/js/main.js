import {
  PORT_ORDER,
  PORT_TYPE_OPTIONS_WITH_NONE,
  allowedTypesForPort,
  coercePresetObject,
  resolveIlabPortForConnect,
} from "../../shared/core.js";
import { AckTracker, SerialJsonClient } from "../../shared/serial.js";
import { listRelativePresetNames, loadRelativePresetObject } from "../../shared/presets.js";
import { createEditor } from "./editor.js";

const RELATIVE_PRESET_DIR_URL = "presets/";

function init() {
  const els = {
    btnConnect: document.getElementById("btnConnect"),
    notConnectedState: document.getElementById("notConnectedState"),
    groupsSection: document.getElementById("groupsSection"),
    groupA: document.getElementById("groupA"),
    groupB: document.getElementById("groupB"),
    groupC: document.getElementById("groupC"),
    groupD: document.getElementById("groupD"),
    presetSelect: document.getElementById("presetSelect"),
    btnLoadPreset: document.getElementById("btnLoadPreset"),
    presetNameInput: document.getElementById("presetNameInput"),
    btnSavePreset: document.getElementById("btnSavePreset"),
    presetStatus: document.getElementById("presetStatus"),
  };

  const groups = { A: els.groupA, B: els.groupB, C: els.groupC, D: els.groupD };

  let presetItems = [];
  const ackTracker = new AckTracker("No admin response from ESP (timeout)");
  const serialClient = new SerialJsonClient({
    serialApi: navigator.serial,
    onJson: handleJsonObject,
    onTextLine: (line) => logLine(line),
    onReadError: async (err) => {
      logLine(`!! ${err.message}`);
      await disconnect("Serial read error.");
    },
    onDisconnect: () => {
      ackTracker.cancel("USB device disconnected.");
      setConnected(false);
      logLine("disconnected");
      setPresetStatus("USB device disconnected.", true);
    },
    onConnectedStateChange: (on) => {
      // Called by auto-reconnect to restore UI without a full connect() cycle.
      if (on) {
        setConnected(true);
        setPresetStatus("");
        logLine("reconnected");
      }
    },
    autoReconnect: true,
  });

  const editor = createEditor({
    Shared: { allowedTypesForPort },
    PORT_ORDER,
    PORT_TYPE_OPTIONS: PORT_TYPE_OPTIONS_WITH_NONE,
    groups,
    coercePresetObject: (raw) =>
      coercePresetObject(raw, {
        portOrder: PORT_ORDER,
        portTypeOptions: PORT_TYPE_OPTIONS_WITH_NONE,
        noneType: "none",
      }),
    isConnected: () => serialClient.isConnected(),
    sendPayload,
    waitForConfigAck,
    logLine,
  });

  function logLine(line) {
    console.log(line);
  }

  function setConnected(on) {
    els.btnConnect.textContent = on ? "Reconnect" : "Connect";
    if (els.groupsSection) els.groupsSection.hidden = !on;
    if (els.notConnectedState) els.notConnectedState.hidden = on;
  }

  function setPresetStatus(message, isError = false) {
    if (!els.presetStatus) return;
    els.presetStatus.textContent = message;
    els.presetStatus.classList.toggle("status-error", !!isError);
  }

  async function sendPayload(payload) {
    const json = await serialClient.sendJson(payload);
    logLine(`>> ${json}`);
  }

  function waitForConfigAck(timeoutMs = 3000) {
    return ackTracker.wait(timeoutMs);
  }

  function rebuildPresetSelect(selectedId = "") {
    if (!els.presetSelect) return;
    const select = els.presetSelect;
    select.innerHTML = "";
    for (const item of presetItems) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.label;
      select.appendChild(option);
    }
    if (presetItems.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No presets";
      select.appendChild(option);
    }
    if (selectedId && presetItems.some((item) => item.id === selectedId)) select.value = selectedId;
  }

  async function loadRelativeDirectoryPresets() {
    const names = await listRelativePresetNames(RELATIVE_PRESET_DIR_URL, {
      include: new Set(),
      exclude: new Set(["presets.json"]),
    });
    return names.map((name) => ({ id: `relative:${name}`, label: `${name} (project)`, source: "relative", name }));
  }

  async function refreshPresetItems(preferredSelection = "") {
    const current = preferredSelection || els.presetSelect?.value || "";
    const byName = new Map();

    const relativeItems = await loadRelativeDirectoryPresets();
    for (const item of relativeItems) byName.set(item.name.toLowerCase(), item);

    const items = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
    presetItems = items;
    rebuildPresetSelect(current);
    setPresetStatus("");
  }

  async function readPresetObject(item) {
    if (!item) return {};
    if (item.source === "relative") {
      return loadRelativePresetObject(RELATIVE_PRESET_DIR_URL, item.name);
    }
    return {};
  }

  async function loadSelectedPreset() {
    if (!els.presetSelect) return;
    const selectedId = els.presetSelect.value;
    await refreshPresetItems(selectedId);
    const item = presetItems.find((x) => x.id === selectedId);
    if (!item) {
      setPresetStatus("No preset selected.", true);
      return;
    }

    const presetObj = await readPresetObject(item);
    editor.applyPresetObject(presetObj);
    const payload = editor.buildPayload();
    const count = Object.keys(payload).length;
    const isExplicitEmptyPreset = item.name.toLowerCase() === "empty.json";
    if (count === 0 && !isExplicitEmptyPreset) {
      editor.confirmConfigApplied();
      setPresetStatus(`Preset "${item.label}" results in empty config ({}). Not sent.`, true);
      return;
    }
    const ackPromise = waitForConfigAck(3500);
    try {
      await sendPayload(payload);
      await ackPromise;
      setPresetStatus("");
    } finally {
      // Always unlock the editor so applyFrame resumes showing live ESP data,
      // even if the ACK timed out or an error occurred.
      editor.confirmConfigApplied();
    }
  }

  async function saveCurrentPreset() {
    const rawName = (els.presetNameInput?.value || "").trim();
    const autoName = `preset-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

    const baseName = rawName || autoName;
    const fileName = baseName.toLowerCase().endsWith(".json") ? baseName : `${baseName}.json`;
    const payload = editor.buildPayload();
    const jsonText = JSON.stringify(payload, null, 2) + "\n";

    const blob = new Blob([jsonText], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);

    if (els.presetNameInput && !rawName) els.presetNameInput.value = fileName;
    setPresetStatus(`Downloaded "${fileName}"`);
  }

  function handleJsonObject(obj) {
    if (obj?.data) {
      editor.applyFrame(obj);
    } else {
      logLine(JSON.stringify(obj));
    }

    const consumed = ackTracker.consumeJson(obj);
    if (obj?.error && !consumed) {
      const msg = obj.msg ? ` (${obj.msg})` : "";
      setPresetStatus(`ESP error: ${obj.error}${msg}`, true);
    }
  }

  async function connect() {
    if (!("serial" in navigator)) {
      alert("WebSerial is not available here. Please use Chrome or Edge.");
      return;
    }
    await serialClient.connect({
      resolvePort: (currentPort) => resolveIlabPortForConnect(navigator.serial, currentPort),
      baudRate: 115200,
    });
    setConnected(true);
    logLine("connected");
  }

  async function disconnect(ackReason = "Serial connection closed.") {
    ackTracker.cancel(ackReason);
    await serialClient.disconnect();
    setConnected(false);
    logLine("disconnected");
  }

  function bindEvents() {
    els.btnConnect.addEventListener("click", async () => {
      try {
        if (serialClient.isConnected()) {
          await disconnect();
        }
        await connect();
      } catch (err) {
        setPresetStatus(`Connect error: ${err.message}`, true);
      }
    });

    els.presetSelect?.addEventListener("focus", async () => {
      try {
        await refreshPresetItems(els.presetSelect.value);
      } catch (err) {
        setPresetStatus(`Refresh error: ${err.message}`, true);
      }
    });

    els.btnLoadPreset?.addEventListener("click", async () => {
      try {
        await loadSelectedPreset();
      } catch (err) {
        setPresetStatus(`Load error: ${err.message}`, true);
      }
    });

    els.btnSavePreset?.addEventListener("click", async () => {
      try {
        await saveCurrentPreset();
      } catch (err) {
        setPresetStatus(`Save error: ${err.message}`, true);
      }
    });
  }

  function start() {
    setConnected(false);
    editor.initRows();
    bindEvents();
    refreshPresetItems().catch((err) => {
      setPresetStatus(`Preset init error: ${err.message}`, true);
    });
    logLine("ready");
  }

  start();
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
