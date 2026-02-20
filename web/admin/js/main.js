import {
  PORT_ORDER,
  PORT_TYPE_OPTIONS_WITH_NONE,
  PRESET_FOLDER_PICKER_ID,
  allowedTypesForPort,
  canonicalParamKey,
  coercePresetObject,
  resolveIlabPortForConnect,
} from "../../shared/core.js";
import { AckTracker, SerialJsonClient } from "../../shared/serial.js";
import { listRelativePresetNames, loadRelativePresetObject } from "../../shared/presets.js";
import { createEditor } from "./editor.js";

const TYPE_EDIT_FIELDS = {
  button: [],
  switch: [],
  slider: ["inMin", "inMax", "outMin", "outMax"],
  light: ["inMin", "inMax", "outMin", "outMax"],
  sound: ["inMin", "inMax", "outMin", "outMax"],
  distance: ["inMin", "inMax", "outMin", "outMax"],
  magnet: ["inMin", "inMax", "outMin", "outMax"],
  joystick: ["midCutoff", "edgeCutoff", "outMin", "outMax"],
  touch: ["threshold"],
  encoder: ["fullRotation", "modulo"],
};
const PARAM_INPUT_ORDER = ["inMin", "inMax", "outMin", "outMax", "midCutoff", "edgeCutoff", "threshold", "fullRotation", "modulo"];
const PARAM_LABELS = {
  inMin: "inmin",
  inMax: "inmax",
  outMin: "outmin",
  outMax: "outmax",
  midCutoff: "midcutoff",
  edgeCutoff: "edgecutoff",
  fullRotation: "fullrotation",
};
const NUMERIC_PARAM_FIELDS = new Set(["inMin", "inMax", "outMin", "outMax", "midCutoff", "edgeCutoff", "threshold", "fullRotation"]);
const BOOLEAN_PARAM_FIELDS = new Set(["modulo"]);
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

  let presetDirHandle = null;
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
  });

  const editor = createEditor({
    Shared: { allowedTypesForPort },
    PORT_ORDER,
    PORT_TYPE_OPTIONS: PORT_TYPE_OPTIONS_WITH_NONE,
    TYPE_EDIT_FIELDS,
    PARAM_INPUT_ORDER,
    PARAM_LABELS,
    NUMERIC_PARAM_FIELDS,
    BOOLEAN_PARAM_FIELDS,
    groups,
    coercePresetObject: (raw) =>
      coercePresetObject(raw, {
        portOrder: PORT_ORDER,
        portTypeOptions: PORT_TYPE_OPTIONS_WITH_NONE,
        noneType: "none",
      }),
    canonicalParamKey,
    isConnected: () => serialClient.isConnected(),
    sendPayload,
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

  async function ensurePresetDirPermission(mode = "read") {
    if (!presetDirHandle) return false;
    if (!presetDirHandle.queryPermission || !presetDirHandle.requestPermission) return true;
    let state = await presetDirHandle.queryPermission({ mode });
    if (state === "granted") return true;
    state = await presetDirHandle.requestPermission({ mode });
    return state === "granted";
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
    let hasRefreshError = false;

    const relativeItems = await loadRelativeDirectoryPresets();
    for (const item of relativeItems) byName.set(item.name.toLowerCase(), item);

    if (presetDirHandle) {
      const hasPermission = await ensurePresetDirPermission("read");
      if (!hasPermission) {
        hasRefreshError = true;
        setPresetStatus("Folder permission denied. Use Save Current to reselect folder.", true);
      } else {
        const dirItems = [];
        for await (const [name, handle] of presetDirHandle.entries()) {
          if (handle.kind !== "file") continue;
          if (!name.toLowerCase().endsWith(".json")) continue;
          if (name.toLowerCase() === "presets.json") continue;
          dirItems.push({ id: `dir:${name}`, label: `${name} (folder)`, source: "dir", name });
        }
        dirItems.sort((a, b) => a.name.localeCompare(b.name));
        for (const item of dirItems) byName.set(item.name.toLowerCase(), item);
      }
    }

    const items = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
    presetItems = items;
    rebuildPresetSelect(current);
    if (!hasRefreshError) setPresetStatus("");
  }

  async function readPresetObject(item) {
    if (!item) return {};
    if (item.source === "relative") {
      return loadRelativePresetObject(RELATIVE_PRESET_DIR_URL, item.name);
    }
    if (item.source === "dir" && presetDirHandle) {
      const hasPermission = await ensurePresetDirPermission("read");
      if (!hasPermission) throw new Error("Folder permission denied");
      const fileHandle = await presetDirHandle.getFileHandle(item.name);
      const file = await fileHandle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed;
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
      setPresetStatus(`Preset "${item.label}" ergibt leere Config ({}). Nicht gesendet.`, true);
      return;
    }
    const ackPromise = waitForConfigAck(3500);
    await sendPayload(payload);
    await ackPromise;
    setPresetStatus("");
  }

  async function saveCurrentPreset() {
    if (!presetDirHandle) await choosePresetFolder();
    if (!presetDirHandle) return;
    const hasWritePermission = await ensurePresetDirPermission("readwrite");
    if (!hasWritePermission) {
      setPresetStatus("Folder write permission denied.", true);
      return;
    }

    const rawName = (els.presetNameInput?.value || "").trim();
    const autoName = `preset-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

    const baseName = rawName || autoName;
    const fileName = baseName.toLowerCase().endsWith(".json") ? baseName : `${baseName}.json`;
    const payload = editor.buildPayload();
    const fileHandle = await presetDirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2) + "\n");
    await writable.close();
    await refreshPresetItems(`dir:${fileName}`);
    if (els.presetNameInput && !rawName) els.presetNameInput.value = fileName;
    setPresetStatus("");
  }

  async function choosePresetFolder() {
    if (!("showDirectoryPicker" in window)) {
      setPresetStatus("Directory picker not supported in this browser.", true);
      return;
    }
    presetDirHandle = await window.showDirectoryPicker({ mode: "readwrite", id: PRESET_FOLDER_PICKER_ID });
    await refreshPresetItems();
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
      alert("WebSerial ist hier nicht verfügbar. Bitte Chrome/Edge nutzen.");
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
