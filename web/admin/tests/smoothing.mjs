import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../js/editor.js", import.meta.url), "utf8");
const { createEditor } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

// Minimal DOM for the editor; no browser or extra dependencies required.
class Element {
  children = [];
  events = {};
  attributes = {};
  classList = { add() {}, remove() {}, toggle() {} };
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.append(item); }
  addEventListener(type, handler) { this.events[type] = handler; }
  setAttribute(key, value) { this.attributes[key] = value; }
  set innerHTML(value) { this.children = []; }
  reportValidity() { return true; }
}
globalThis.document = { createElement: () => new Element() };
const group = new Element();
let sent;
const editor = createEditor({
  Shared: { allowedTypesForPort: () => ["none", "slider", "button", "joystick"] },
  PORT_ORDER: ["B1"], PORT_TYPE_OPTIONS: {}, groups: { B: group },
  coercePresetObject: value => value, isConnected: () => true,
  sendPayload: async payload => { sent = payload; }, logLine: message => { throw new Error(message); },
});
editor.initRows();
editor.applyPresetObject({ B1: { type: "slider" } });
assert.equal(editor.buildPayload().B1.smoothingMs, 0);
for (const ms of [0, 100, 10000]) {
  editor.applyPresetObject({ B1: { type: "slider", smoothingMs: ms } });
  assert.equal(editor.buildPayload().B1.smoothingMs, ms);
}
for (const ms of [-1, 1.5, 10001, "100", NaN]) {
  editor.applyPresetObject({ B1: { type: "slider", smoothingMs: ms } });
  assert.throws(() => editor.buildPayload(), /ganze Zahl/);
}
editor.applyPresetObject({ B1: { type: "button" } });
assert.equal(editor.buildPayload().B1.smoothingMs, undefined);
editor.applyPresetObject({ B1: { type: "slider", smoothingMs: 100 } });
editor.confirmConfigApplied();
editor.applyFrame({ data: { slider1: { type: "slider", port: "B1", raw: 2048, value: 0.5, smoothingMs: 300 } } });
assert.equal(editor.buildPayload().B1.smoothingMs, 300);
assert.equal(editor.buildPayload().B1.raw, undefined);

const row = group.children[0];
const [normal, edit] = row.children;
normal.children[0].children[4].children[0].events.click();
const params = edit.children[1];
const field = params.children.find(item => item.children[0]?.textContent === "Glättung (ms):");
assert.ok(field);
const input = field.children[1];
assert.equal(input.min, "0"); assert.equal(input.max, "10000"); assert.equal(input.step, "1");
input.value = "150"; input.events.input(); input.events.blur();
await Promise.resolve();
assert.equal(sent.B1.smoothingMs, 150);
assert.equal(editor.buildPayload().B1.smoothingMs, 150);
console.log("Config defaults, validation, frame/preset round-trip and edit: PASS");
