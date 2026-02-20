function createEditor({
  Shared,
  PORT_ORDER,
  PORT_TYPE_OPTIONS,
  TYPE_EDIT_FIELDS,
  PARAM_INPUT_ORDER,
  PARAM_LABELS,
  NUMERIC_PARAM_FIELDS,
  BOOLEAN_PARAM_FIELDS,
  groups,
  coercePresetObject,
  canonicalParamKey,
  isConnected,
  sendPayload,
  logLine,
}) {
  let editingPort = null;
  let pendingEditSync = null;
  let editDraft = null;

  const rowByPort = new Map();
  const sensorByPort = new Map();
  const configByPort = new Map();

  function fmt(v) {
    if (v === undefined) return "-";
    if (v === null) return "null";
    if (typeof v === "number") return String(Math.round(v * 1000) / 1000);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string") return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  }

  function groupForPort(portId) {
    const l = String(portId || "").charAt(0).toUpperCase();
    return groups[l] || groups.D;
  }

  function allowedTypesForPort(portId) {
    return Shared.allowedTypesForPort(portId, PORT_TYPE_OPTIONS, ["none"]);
  }

  function makeChip(text, cls = "") {
    const d = document.createElement("div");
    d.className = `chip ${cls}`.trim();
    d.textContent = text;
    return d;
  }

  function defaultEntryForType(type, name = "") {
    const out = { type };
    if (name) out.name = name;
    return out;
  }

  function copyConfigFromSensor(sensorName, sensor) {
    const out = { type: sensor?.type || "none", name: sensorName };
    for (const [k, v] of Object.entries(sensor || {})) {
      if (["type", "port", "value", "raw"].includes(k)) continue;
      if (["string", "number", "boolean"].includes(typeof v)) out[k] = v;
    }
    return out;
  }

  function normalizePresetEntry(portId, entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return defaultEntryForType("none", "");
    }

    let type = typeof entry.type === "string" ? entry.type.trim().toLowerCase() : "none";
    if (!allowedTypesForPort(portId).includes(type)) type = "none";

    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const normalized = { ...defaultEntryForType(type, name) };
    for (const [key, value] of Object.entries(entry)) {
      if (key === "type" || key === "name") continue;
      if (["string", "number", "boolean"].includes(typeof value)) {
        normalized[canonicalParamKey(key)] = value;
      }
    }
    return normalized;
  }

  function applyPresetObject(presetConfig) {
    if (editingPort) exitEdit(false);

    const source = coercePresetObject(presetConfig);
    for (const portId of PORT_ORDER) {
      const entry = normalizePresetEntry(portId, source[portId]);
      configByPort.set(portId, entry);
    }

    for (const portId of PORT_ORDER) {
      const ref = rowByPort.get(portId);
      if (ref) renderNormal(ref);
    }
  }

  function buildPayload() {
    const out = {};
    for (const p of PORT_ORDER) {
      const cfg = configByPort.get(p);
      if (!cfg || !cfg.type || cfg.type === "none") continue;
      if (!allowedTypesForPort(p).includes(cfg.type)) continue;

      const entry = { type: cfg.type };
      if (cfg.name && String(cfg.name).trim().length) entry.name = String(cfg.name).trim();

      for (const [k, v] of Object.entries(cfg)) {
        if (["type", "name"].includes(k)) continue;
        if (["string", "number", "boolean"].includes(typeof v)) entry[k] = v;
      }
      out[p] = entry;
    }
    return out;
  }

  function createRow(portId) {
    const row = document.createElement("article");
    row.className = "sensor-row";

    const normal = document.createElement("div");
    normal.className = "normal";
    const normalTop = document.createElement("div");
    normalTop.className = "normal-top";

    const portChip = makeChip("", "port");
    const typeChip = makeChip("", "type");
    const nameChip = makeChip("", "name");
    const valueChip = makeChip("", "value");

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn";
    btnEdit.textContent = "edit";
    const editWrap = document.createElement("div");
    editWrap.className = "normal-edit-wrap";
    editWrap.append(btnEdit);

    normalTop.append(portChip, typeChip, nameChip, valueChip, editWrap);
    normal.append(normalTop);

    const edit = document.createElement("div");
    edit.className = "edit";
    row.append(normal, edit);

    const ref = { portId, row, portChip, typeChip, nameChip, valueChip, btnEdit, edit };
    btnEdit.addEventListener("click", () => enterEdit(portId));

    rowByPort.set(portId, ref);
    groupForPort(portId).appendChild(row);
    return ref;
  }

  function renderNormal(ref) {
    const portId = ref.portId;
    const cfg = configByPort.get(portId) || { type: "none", name: "" };
    const sensor = sensorByPort.get(portId);

    ref.row.classList.remove("editing");
    ref.row.classList.toggle("type-none", (cfg.type || "none") === "none");
    ref.edit.innerHTML = "";
    ref.editLive = null;

    ref.portChip.textContent = portId;
    ref.typeChip.textContent = `type: ${cfg.type || "none"}`;
    ref.nameChip.textContent = `name: ${cfg.name || "-"}`;
    ref.valueChip.textContent = `value: ${fmt(sensor?.value)}`;
    ref.valueChip.classList.toggle("wide", (cfg.type || "") === "joystick");
  }

  async function sendConfig(stayEditing = false) {
    if (!isConnected() || !editingPort || !editDraft) return;
    if (!editDraft.type) editDraft.type = "none";

    configByPort.set(editingPort, { ...editDraft });
    await sendPayload(buildPayload());
    if (!stayEditing) exitEdit(true);
  }

  function renderEdit(ref) {
    const portId = ref.portId;
    const sensor = sensorByPort.get(portId);

    ref.row.classList.add("editing");
    ref.row.classList.toggle("type-none", (editDraft?.type || "none") === "none");
    ref.edit.innerHTML = "";

    const bar = document.createElement("div");
    bar.className = "edit-bar";

    const mkLabelChip = (labelText, chipText, ro = false, extraClass = "") => {
      const wrap = document.createElement("div");
      wrap.className = "eField";
      const lab = document.createElement("label");
      lab.textContent = labelText;
      const chip = document.createElement("div");
      chip.className = `chip${ro ? " ro" : ""}${extraClass ? ` ${extraClass}` : ""}`;
      chip.textContent = chipText;
      wrap.append(lab, chip);
      return { wrap, chip };
    };

    const commitOnBlurOrEnter = (inputEl) => {
      inputEl.addEventListener("blur", () => {
        sendConfig(true).catch((err) => {
          logLine(`Config error: ${err.message}`);
        });
      });
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          inputEl.blur();
        }
      });
    };

    const portRo = mkLabelChip("port:", portId, true);
    bar.appendChild(portRo.wrap);

    {
      const wrap = document.createElement("div");
      wrap.className = "eField";
      const lab = document.createElement("label");
      lab.textContent = "type:";
      const sel = document.createElement("select");
      sel.className = "eCtrl";
      const selectableTypes = allowedTypesForPort(portId);
      for (const t of selectableTypes) {
        const o = document.createElement("option");
        o.value = t;
        o.textContent = t;
        if (t === editDraft.type) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => {
        const nextType = sel.value;
        if (nextType === "none") {
          editDraft = defaultEntryForType("none", "");
          pendingEditSync = null;
        } else {
          // Send only type first, then sync returned defaults from ESP.
          editDraft = defaultEntryForType(nextType, "");
          pendingEditSync = { port: portId, type: nextType };
        }
        renderEdit(ref);
        sendConfig(true).catch((err) => {
          pendingEditSync = null;
          logLine(`Config error: ${err.message}`);
        });
      });
      wrap.append(lab, sel);
      bar.appendChild(wrap);
    }

    {
      const wrap = document.createElement("div");
      wrap.className = "eField";
      const lab = document.createElement("label");
      lab.textContent = "name:";
      const inp = document.createElement("input");
      inp.className = "eCtrl";
      inp.value = editDraft.name || "";
      inp.addEventListener("input", () => { editDraft.name = inp.value.trim(); });
      commitOnBlurOrEnter(inp);
      wrap.append(lab, inp);
      bar.appendChild(wrap);
    }

    const isJoystick = ((editDraft?.type || sensor?.type || "") === "joystick");
    const valueRo = mkLabelChip("value:", fmt(sensor?.value), true, `value-fixed${isJoystick ? " wide" : ""}`);
    const rawRo = mkLabelChip("raw:", fmt(sensor?.raw), true, `raw-fixed${isJoystick ? " wide" : ""}`);
    bar.append(valueRo.wrap, rawRo.wrap);

    const closeWrap = document.createElement("div");
    closeWrap.className = "edit-close-wrap";
    const close = document.createElement("button");
    close.className = "btn";
    close.textContent = "close edit";
    close.addEventListener("click", () => exitEdit(false));
    closeWrap.append(close);
    bar.appendChild(closeWrap);

    ref.editLive = { port: portRo.chip, value: valueRo.chip, raw: rawRo.chip };

    const params = document.createElement("div");
    params.className = "edit-params";
    const declaredFields = TYPE_EDIT_FIELDS[editDraft.type] || [];
    const existingKeys = Object.keys(editDraft).filter((k) => !["type", "name"].includes(k));
    const keysToShow = Array.from(new Set([...declaredFields, ...existingKeys])).sort((a, b) => {
      const ia = PARAM_INPUT_ORDER.indexOf(a);
      const ib = PARAM_INPUT_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    const mkParam = (modelKey) => {
      const wrap = document.createElement("div");
      wrap.className = "eField";
      const lab = document.createElement("label");
      lab.textContent = `${PARAM_LABELS[modelKey] || modelKey}:`;
      const val = editDraft[modelKey];

      if (BOOLEAN_PARAM_FIELDS.has(modelKey) || typeof val === "boolean") {
        const sel = document.createElement("select");
        sel.className = "eCtrl";
        sel.innerHTML = '<option value="">-</option><option value="true">true</option><option value="false">false</option>';
        sel.value = val === true ? "true" : val === false ? "false" : "";
        sel.addEventListener("change", () => {
          if (sel.value === "") delete editDraft[modelKey];
          else editDraft[modelKey] = sel.value === "true";
          sendConfig(true).catch((err) => {
            logLine(`Config error: ${err.message}`);
          });
        });
        wrap.append(lab, sel);
        return wrap;
      }

      const inp = document.createElement("input");
      inp.className = "eCtrl";
      if (NUMERIC_PARAM_FIELDS.has(modelKey) || typeof val === "number") {
        inp.type = "number";
        inp.step = "any";
        inp.value = Number.isFinite(val) ? String(val) : "";
        inp.addEventListener("input", () => {
          const raw = inp.value.trim();
          if (!raw.length) {
            delete editDraft[modelKey];
            return;
          }
          const n = Number(raw);
          if (Number.isFinite(n)) editDraft[modelKey] = n;
        });
      } else {
        inp.type = "text";
        inp.value = String(val ?? "");
        inp.addEventListener("input", () => {
          const raw = inp.value.trim();
          if (!raw.length) delete editDraft[modelKey];
          else editDraft[modelKey] = raw;
        });
      }
      commitOnBlurOrEnter(inp);
      wrap.append(lab, inp);
      return wrap;
    };

    for (const key of keysToShow) {
      params.appendChild(mkParam(key));
    }

    ref.edit.append(bar, params);
  }

  function enterEdit(portId) {
    const ref = rowByPort.get(portId);
    if (!ref) return;

    if (editingPort && editingPort !== portId) exitEdit(false);

    editingPort = portId;
    pendingEditSync = null;
    const cfg = configByPort.get(portId) || defaultEntryForType("none", "");
    editDraft = { ...cfg };
    if (!editDraft.type) editDraft.type = "none";
    if (!allowedTypesForPort(portId).includes(editDraft.type)) {
      editDraft = defaultEntryForType("none", editDraft.name || "");
    }

    renderEdit(ref);
  }

  function exitEdit() {
    if (!editingPort) return;
    const ref = rowByPort.get(editingPort);
    editingPort = null;
    pendingEditSync = null;
    editDraft = null;

    if (ref) renderNormal(ref);
  }

  function updateEditReadonly(ref, sensor) {
    if (!ref?.editLive) return;
    ref.editLive.port.textContent = ref.portId;
    ref.editLive.value.textContent = fmt(sensor?.value);
    ref.editLive.raw.textContent = fmt(sensor?.raw);
  }

  function applyFrame(frame) {
    const data = frame?.data && typeof frame.data === "object" ? frame.data : {};
    sensorByPort.clear();
    let didSyncOpenEditor = false;

    for (const [name, sensor] of Object.entries(data)) {
      const s = sensor || {};
      if (!s.port) continue;
      sensorByPort.set(s.port, { ...s, __name: name });
      const shouldSyncEdit =
        !!pendingEditSync &&
        editingPort === s.port &&
        pendingEditSync.port === s.port &&
        String(s.type || "") === pendingEditSync.type;

      if (shouldSyncEdit) {
        const synced = copyConfigFromSensor(name, s);
        configByPort.set(s.port, synced);
        editDraft = { ...synced };
        pendingEditSync = null;
        didSyncOpenEditor = true;
      } else if (editingPort !== s.port) {
        const existing = configByPort.get(s.port) || defaultEntryForType("none", "");
        configByPort.set(s.port, { ...existing, ...copyConfigFromSensor(name, s) });
      }
    }

    for (const p of PORT_ORDER) {
      const ref = rowByPort.get(p);
      if (!ref) continue;
      if (editingPort === p) {
        if (didSyncOpenEditor) renderEdit(ref);
        else updateEditReadonly(ref, sensorByPort.get(p));
      } else {
        renderNormal(ref);
      }
    }
  }

  function initRows() {
    for (const p of PORT_ORDER) {
      configByPort.set(p, defaultEntryForType("none", ""));
      const ref = createRow(p);
      renderNormal(ref);
    }
  }

  return {
    initRows,
    applyFrame,
    applyPresetObject,
    buildPayload,
  };
}

export { createEditor };
