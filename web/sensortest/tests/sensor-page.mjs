// Run with a local web server and Playwright Core (Chrome installed).
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { chromium } = await import(process.env.ILAB_PLAYWRIGHT_MODULE || 'playwright-core');
const artifactDir = process.env.ILAB_SCREENSHOT_DIR || '/tmp/ilab-sensor-page';
fs.mkdirSync(artifactDir, { recursive: true });
const fixture = JSON.parse(fs.readFileSync(new URL('../../../platformio/diagnostics/continuous-test/normal-verification.json', import.meta.url), 'utf8'))[0].last_frame;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(frame => {
  let controller, timer;
  const encoder = new TextEncoder();
  const push = () => {
    const test = window.__sensorTest;
    if (test.animate) {
      const t = performance.now() / 1000, d = test.frame.data;
      d.slider1.value = .5 + .45 * Math.sin(t * 2);
      d.sound1.value = .5 + .45 * Math.sin(t * 9);
      d.joystick1.value = { x: Math.sin(t), y: Math.cos(t) };
      d.distance1.raw = 30 + (1 + Math.sin(t * 1.5)) * 285;
      d.encoder1.value = t * 90;
    }
    controller.enqueue(encoder.encode(JSON.stringify(test.frame) + '\n'));
  };
  const pause = () => clearInterval(timer);
  const resume = () => { pause(); timer = setInterval(push, 20); };
  const port = {
    getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    async open() {
      this.readable = new ReadableStream({ start(c) { controller = c; }, cancel() { pause(); } });
      this.writable = new WritableStream();
      resume();
    },
    async close() { pause(); },
  };
  const serial = new EventTarget();
  serial.getPorts = async () => [port];
  serial.requestPort = async () => port;
  Object.defineProperty(navigator, 'serial', { value: serial, configurable: true });
  window.__sensorTest = { frame, pause, resume, animate: true };
}, fixture);
try {
  await page.goto(process.env.ILAB_TEST_URL || 'http://127.0.0.1:8765/sensortest/');
  await page.waitForSelector('.sensor-card');
  assert.equal(await page.locator('.sensor-card').count(), 10);
  await page.getByRole('button', { name: 'Board verbinden', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.sensor-card:not(.stale)').length === 9);
  await page.waitForTimeout(3000);
  const performanceSamples = await page.evaluate(() => new Promise(resolve => {
    const samples = [];
    const timer = setInterval(() => {
      samples.push({ rate: Number(document.getElementById('rate').textContent), fps: Number(document.getElementById('fps').textContent) });
      if (samples.length === 10) { clearInterval(timer); resolve(samples); }
    }, 500);
  }));
  assert.ok(performanceSamples.every(s => s.rate >= 43 && s.fps >= 40), JSON.stringify(performanceSamples));
  const rate = Number(await page.locator('#rate').textContent());
  assert.ok(rate >= 43 && rate <= 57, `Unexpected replay rate ${rate}`);
  const card = title => page.locator('.sensor-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await page.evaluate(() => {
    window.__sensorTest.animate = false;
    const d = window.__sensorTest.frame.data;
    d.slider1.value = .5;
    d.joystick1.value = { x: 1, y: 1 };
    d.encoder1.value = 90;
    d.button1.value = 0;
    d.touch1.value = 1;
    d.distance1.raw = 30;
  });
  await page.waitForTimeout(80);
  assert.equal(await card('Slider').locator('.shape').getAttribute('r'), '78');
  assert.equal(await card('Joystick').locator('.shape').getAttribute('cx'), '280');
  assert.equal(await card('Joystick').locator('.shape').getAttribute('cy'), '80');
  assert.equal(await card('Encoder').locator('.marker').getAttribute('cx'), '318');
  assert.notEqual(await card('Encoder').locator('.marker').evaluate(el => getComputedStyle(el).display), 'none');
  assert.equal(await card('Taster').locator('.shape').getAttribute('r'), '146');
  assert.equal(await card('Touch').locator('.shape').getAttribute('r'), '146');
  assert.equal(await card('Abstand').locator('.shape').getAttribute('r'), '146');
  await page.screenshot({ path: `${artifactDir}/desktop.png`, fullPage: false });
  await card('Joystick').getByRole('button').click();
  assert.equal(await card('Joystick').getAttribute('class'), 'sensor-card expanded');
  assert.ok(await card('Joystick').locator('.visual').evaluate(el => el.getBoundingClientRect().width) > 600);
  await card('Joystick').getByRole('button').click();
  await page.evaluate(() => { window.__sensorTest.frame.data.sound1.value = null; window.__sensorTest.frame.data.sound1.error = 'sound_not_ready'; });
  await page.waitForTimeout(80);
  assert.match(await card('Sound').getAttribute('class'), /stale/);
  assert.equal(await card('Sound').locator('.value').textContent(), '—');
  await page.evaluate(() => { delete window.__sensorTest.frame.data.sound1.error; window.__sensorTest.frame.data.sound1.value = .3; window.__sensorTest.pause(); });
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('.sensor-card:not(.stale)').count(), 0);
  assert.equal(await page.locator('#rate').textContent(), '0');
  await page.evaluate(() => window.__sensorTest.resume());
  await page.waitForFunction(() => document.querySelectorAll('.sensor-card:not(.stale)').length === 9);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${artifactDir}/mobile.png`, fullPage: false });
  // A configuration change must remove old cards; names are treated as text.
  await page.evaluate(() => { window.__sensorTest.frame.data = { '<img src=x onerror=alert(1)>': { type: 'slider', port: 'B1', value: .7, raw: 3000 } }; });
  await page.waitForFunction(() => document.querySelectorAll('.sensor-card').length === 1);
  assert.equal(await page.locator('.card-name img').count(), 0);
  await page.evaluate(() => { window.__sensorTest.frame.data = {}; });
  await page.waitForFunction(() => document.querySelectorAll('.sensor-card').length === 0);
  await page.getByRole('button', { name: 'Verbindung trennen', exact: true }).click();
  await page.getByRole('button', { name: 'Board verbinden', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', rate, performanceSamples, scenarios: ['50 Hz WebSerial replay', 'all sensor types', 'zoom', 'invalid values', 'stale/recovery', 'mobile', 'config changes', 'safe names', 'disconnect'], screenshots: artifactDir }, null, 2));
} finally {
  await browser.close();
}
