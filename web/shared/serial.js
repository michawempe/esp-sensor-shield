class AckTracker {
  constructor(defaultTimeoutMessage = "No admin response from ESP (timeout)") {
    this.defaultTimeoutMessage = defaultTimeoutMessage;
    this.pending = null;
  }

  wait(timeoutMs = 3500, timeoutMessage = this.defaultTimeoutMessage) {
    return new Promise((resolve, reject) => {
      if (this.pending) {
        reject(new Error("Another admin update is still pending."));
        return;
      }
      const timer = setTimeout(() => {
        if (!this.pending) return;
        this.pending = null;
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      this.pending = { resolve, reject, timer };
    });
  }

  consumeJson(obj) {
    if (!this.pending || !obj || typeof obj !== "object") return false;
    if (obj.status === "config_applied") {
      clearTimeout(this.pending.timer);
      const resolve = this.pending.resolve;
      this.pending = null;
      resolve(obj);
      return true;
    }
    if (obj.error) {
      clearTimeout(this.pending.timer);
      const reject = this.pending.reject;
      this.pending = null;
      reject(new Error(`${obj.error}${obj.msg ? ` (${obj.msg})` : ""}`));
      return true;
    }
    return false;
  }

  cancel(reason = "Serial connection closed.") {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    const reject = this.pending.reject;
    this.pending = null;
    reject(new Error(reason));
  }
}

class SerialJsonClient {
  constructor({
    serialApi = null,
    onJson = null,
    onTextLine = null,
    onReadError = null,
    onDisconnect = null,
    onConnectedStateChange = null,
    // Auto-reconnect: when the USB device disconnects, wait reconnectDelayMs
    // and attempt to reopen the same port without user interaction.
    autoReconnect = false,
    reconnectDelayMs = 1500,
  } = {}) {
    this.serialApi = serialApi;
    this.onJson = onJson;
    this.onTextLine = onTextLine;
    this.onReadError = onReadError;
    this.onDisconnect = onDisconnect;
    this.onConnectedStateChange = onConnectedStateChange;
    this._autoReconnect = autoReconnect;
    this._reconnectDelayMs = reconnectDelayMs;

    this.port = null;
    this.reader = null;
    this.writer = null;
    this.keepReading = false;
    this.disconnectListener = null;
    this.readLoopPromise = null;

    // Reused across all sendLine calls to avoid per-call allocation.
    this._encoder = new TextEncoder();

    // Stored on connect() to enable auto-reconnect with the same options.
    this._lastBaudRate = 115200;
    this._lastOpenOptions = {};
  }

  isConnected() {
    return !!this.writer;
  }

  currentPort() {
    return this.port;
  }

  _emitConnectedState(isConnected) {
    if (typeof this.onConnectedStateChange !== "function") return;
    try {
      this.onConnectedStateChange(!!isConnected);
    } catch {
      // Ignore callback issues from host app.
    }
  }

  _attachDisconnectListener() {
    if (!this.serialApi?.addEventListener || this.disconnectListener) return;
    this.disconnectListener = async (event) => {
      const disconnectedPort = event?.port || null;
      if (!this.port || disconnectedPort !== this.port) return;

      const savedPort = this.port;
      await this.disconnect();

      if (typeof this.onDisconnect === "function") {
        try {
          this.onDisconnect();
        } catch {
          // Ignore callback issues from host app.
        }
      }

      if (!this._autoReconnect || !savedPort) return;

      await new Promise((r) => setTimeout(r, this._reconnectDelayMs));

      // Abort if the host app already reconnected manually in the meantime.
      if (this.port) return;

      try {
        await savedPort.open({ baudRate: this._lastBaudRate, ...this._lastOpenOptions });
        this.port = savedPort;
        this.writer = this.port.writable.getWriter();
        this.keepReading = true;
        this._emitConnectedState(true);
        // disconnectListener is still registered on serialApi — no need to re-attach.
        this._startReadLoop();
      } catch {
        // Port not yet available after reconnect delay; user must connect manually.
      }
    };
    this.serialApi.addEventListener("disconnect", this.disconnectListener);
  }

  _startReadLoop() {
    if (!this.port?.readable || this.readLoopPromise) return;

    this.readLoopPromise = (async () => {
      this.reader = this.port.readable.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (this.keepReading) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (!value) continue;

          buffer += decoder.decode(value, { stream: true });
          let cut;
          while ((cut = buffer.indexOf("\n")) >= 0) {
            const rawLine = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 1);
            const line = rawLine.replace(/\r/g, "").trim();
            if (!line) continue;

            let parsed = null;
            try {
              parsed = JSON.parse(line);
            } catch {
              parsed = null;
            }

            if (parsed && typeof this.onJson === "function") {
              try {
                this.onJson(parsed, line);
              } catch {
                // Ignore callback issues from host app.
              }
            } else if (!parsed && typeof this.onTextLine === "function") {
              try {
                this.onTextLine(line);
              } catch {
                // Ignore callback issues from host app.
              }
            }
          }
        }
      } catch (err) {
        if (this.keepReading && typeof this.onReadError === "function") {
          try {
            this.onReadError(err);
          } catch {
            // Ignore callback issues from host app.
          }
        }
      } finally {
        try {
          this.reader?.releaseLock();
        } catch {
          // Ignore lock-release issues.
        }
        this.reader = null;
        this.readLoopPromise = null;
      }
    })();
  }

  async connect({ resolvePort, baudRate = 115200, openOptions = {} } = {}) {
    if (typeof resolvePort !== "function") {
      throw new Error("Missing resolvePort callback.");
    }
    const selectedPort = await resolvePort(this.port);
    if (!selectedPort) throw new Error("No USB serial port selected.");

    this._lastBaudRate = baudRate;
    this._lastOpenOptions = openOptions;

    await this.disconnect();
    await selectedPort.open({ baudRate, ...openOptions });

    this.port = selectedPort;
    this.writer = this.port.writable.getWriter();
    this.keepReading = true;
    this._emitConnectedState(true);
    this._attachDisconnectListener();
    this._startReadLoop();
    return selectedPort;
  }

  async disconnect() {
    this.keepReading = false;

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // Ignore cancellation issues.
      }
      try {
        this.reader.releaseLock();
      } catch {
        // Ignore lock-release issues.
      }
      this.reader = null;
    }

    if (this.writer) {
      try {
        this.writer.releaseLock();
      } catch {
        // Ignore lock-release issues.
      }
      this.writer = null;
    }

    if (this.port) {
      try {
        await this.port.close();
      } catch {
        // Ignore close issues.
      }
      this.port = null;
    }

    this._emitConnectedState(false);
  }

  async sendLine(line) {
    if (!this.writer) throw new Error("Not connected");
    const bytes = this._encoder.encode(`${line}\n`);
    await this.writer.write(bytes);
  }

  async sendJson(obj) {
    const json = JSON.stringify(obj || {});
    await this.sendLine(json);
    return json;
  }
}

export { AckTracker, SerialJsonClient };
