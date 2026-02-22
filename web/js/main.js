import { resolveIlabPortForConnect } from "../shared/core.js";
import { SerialJsonClient } from "../shared/serial.js";
import { bindSensorRender } from "./render.js";

const SENSOR_IDS = ["button1", "slider1", "distance1", "joystick1", "touch1"];

function init() {
  const app = document.getElementById("app") || document.body;

  app.insertAdjacentHTML("afterbegin", `
    <style>
      @font-face {
        font-family: "GT Haptik";
        src: url("./admin/font/GT-Haptik-Regular-Trial.otf") format("opentype");
        font-style: normal;
        font-weight: 400;
        font-display: swap;
      }

      #startupOverlay {
        --popup-bg: #ffffff;
        --popup-border: #000000;
        --popup-text: #000000;
        --popup-error: #b11c1c;
        --popup-muted: #555555;
        color: var(--popup-text);
        font-family: "GT Haptik", "Avenir Next", "Trebuchet MS", sans-serif;
      }

      #startupOverlay .btn {
        height: 32px;
        border: 1.4px solid var(--popup-border);
        border-radius: 8px;
        background: var(--popup-bg);
        color: var(--popup-text);
        font: inherit;
        font-size: 15px;
        padding: 0 12px;
        cursor: pointer;
        white-space: nowrap;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      #startupOverlay.startup-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.28);
        display: grid;
        place-items: center;
        padding: 20px;
        z-index: 1200;
      }

      #startupOverlay .startup-modal {
        border: 1.4px solid var(--popup-border);
        border-radius: 14px;
        background: var(--popup-bg);
        padding: 20px;
        display: grid;
        gap: 14px;
      }

      #startupOverlay .startup-modal h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 400;
      }

      #startupOverlay .startup-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      #startupOverlay .status {
        font-size: 13px;
        color: var(--popup-muted);
      }
      #startupOverlay .status:empty { display: none; }
      #startupOverlay .status.err { color: var(--popup-error); }
    </style>

    <div id="startupOverlay" class="startup-overlay">
      <div class="startup-modal">
        <h2>ESP32 Sensor Board</h2>
        <div class="startup-actions">
          <button id="btnConnect" class="btn" type="button">Connect</button>
          <a class="btn" href="./admin/">Config Page</a>
        </div>
        <div id="status" class="status"></div>
      </div>
    </div>
  `);

  const els = {
    startupOverlay: document.getElementById("startupOverlay"),
    btnConnect: document.getElementById("btnConnect"),
    status: document.getElementById("status"),
  };

  const state = {
    sensorData: {},
  };

  const serialClient = new SerialJsonClient({
    serialApi: navigator.serial,
    onJson: handleJsonObject,
    onReadError: async (err) => {
      setStatus(`Serial read error: ${err.message}`, true);
      await serialClient.disconnect();
      setConnectedUi(false);
    },
    onDisconnect: () => {
      setConnectedUi(false);
      setStatus("USB device disconnected.", true);
    },
  });

  bindSensorRender({
    ids: SENSOR_IDS,
    getValue,
    eventTarget: window,
  });

  function getValue(sensorName, fallback = undefined) {
    const value = state.sensorData?.[sensorName]?.value;
    return value === undefined ? fallback : value;
  }

  function setStatus(message, isError = false) {
    els.status.textContent = message || "";
    els.status.classList.toggle("err", !!isError);
  }

  function setPopupVisible(visible) {
    if (!els.startupOverlay) return;
    els.startupOverlay.hidden = !visible;
  }

  function dismissPopup() {
    if (!els.startupOverlay) return;
    els.startupOverlay.remove();
    els.startupOverlay = null;
  }

  function setConnectedUi(on) {
    els.btnConnect.textContent = on ? "Reconnect" : "Connect";
  }

  function handleJsonObject(obj) {
    if (obj?.data && typeof obj.data === "object") {
      state.sensorData = obj.data;
      window.dispatchEvent(new CustomEvent("sensor-frame", { detail: obj }));
    }
  }

  async function resolvePortForConnect() {
    return resolveIlabPortForConnect(navigator.serial, serialClient.currentPort());
  }

  async function connectOrReconnect() {
    await serialClient.connect({
      resolvePort: resolvePortForConnect,
      baudRate: 115200,
    });
    setConnectedUi(true);
    setStatus("");
    dismissPopup();
  }

  async function start() {
    setPopupVisible(true);
    setConnectedUi(false);

    if (!navigator.serial) {
      setStatus("WebSerial not supported in this browser.", true);
      els.btnConnect.disabled = true;
      return;
    }

    els.btnConnect.addEventListener("click", async () => {
      try {
        await connectOrReconnect();
      } catch (err) {
        setConnectedUi(false);
        setStatus(`Connect failed: ${err.message}`, true);
        setPopupVisible(true);
      }
    });
  }

  start().catch((err) => {
    setStatus(`Init failed: ${err.message}`, true);
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
