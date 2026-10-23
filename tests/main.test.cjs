const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, existsSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const Module = require('node:module');

function fixture(dir) {
  const ipcMain = new EventEmitter();
  const handlers = new Map();
  ipcMain.handle = (k, cb) => handlers.set(k, cb);
  ipcMain.removeHandler = (k) => handlers.delete(k);
  const webContents = new EventEmitter();
  webContents.id = 24;
  webContents.isDestroyed = () => false;
  const sent = [];
  webContents.send = (channel, value) => sent.push({ channel, value });
  const win = new EventEmitter();
  Object.assign(win, {
    webContents, isDestroyed: () => false,
    isVisible: () => true, isFocused: () => true,
  });
  return {
    electron: { app: {
      isReady: () => true, getPath: () => dir, getVersion: () => '1.4.0', getAppMetrics: () => [],
    }, ipcMain },
    win, sent,
    send: (name, payload) => ipcMain.emit(`electron-ga4:${name}`, { sender: webContents }, payload),
    getContext: () => handlers.get('electron-ga4:context')({ sender: webContents }),
    events: () => sent.filter((x) => x.channel === 'electron-ga4:event').map((x) => x.value),
  };
}
function getInstaller(electronMock) {
  const request = require.resolve('../dist/main.js');
  delete require.cache[request];
  const previous = Module._load;
  Module._load = function (name, ...args) {
    if (name === 'electron') return electronMock;
    return previous.call(this, name, ...args);
  };
  try { return require(request).installMainTelemetry; }
  finally { Module._load = previous; }
}

test('consent, stable ID across restarts, single daily event, crash retry, UTM', () => {
  const dir = mkdtempSync(join(tmpdir(), 'electron-ga4-test-'));
  try {
    const h = fixture(dir);
    const install = getInstaller(h.electron);
    const tracker = install(h.win, {
      enabled: false,
      initialCampaign: 'vidbee://open?utm_source=github&utm_medium=release',
    });
    const ctx = h.getContext();
    assert.equal(ctx.firstInstall, true);
    assert.match(ctx.clientId, /^\d+\.\d+$/);
    assert.equal(existsSync(join(dir, 'ga4-telemetry-profile.json')), false);
    tracker.track('app_launch');
    assert.equal(h.events().length, 0);
    h.send('ready', true);
    assert.equal(existsSync(join(dir, 'ga4-telemetry-profile.json')), true);
    assert.equal(h.events().filter((e) => e.name === 'app_launch').length, 1);
    assert.equal(h.events().filter((e) => e.name === 'desktop_session_start').length, 1);
    assert.equal(h.events().filter((e) => e.name === 'desktop_daily_active').length, 1);
    assert.ok(h.events().some((e) => e.name === 'desktop_first_install'));
    assert.ok(h.events().some((e) => e.name === 'desktop_attribution'));
    h.send('activity');
    assert.equal(h.events().filter((e) => e.name === 'desktop_daily_active').length, 1);
    tracker.captureAttribution('vidbee://open?utm_source=newsletter&utm_medium=email&token=supersecret');
    assert.ok(h.events().some((e) => e.params?.utm_source === 'newsletter'));
    h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(h.events().filter((e) => e.name === 'renderer_process_gone').length, 0);
    h.send('ready', true);
    assert.equal(h.events().filter((e) => e.name === 'renderer_process_gone').length, 1);
    h.send('enabled', false);
    tracker.track('feature_used', { feature_name: 'test' });
    assert.equal(h.events().some((e) => e.name === 'feature_used'), false);
    tracker.dispose();

    const saved = JSON.parse(readFileSync(join(dir, 'ga4-telemetry-profile.json'), 'utf8'));
    assert.equal(saved.clientId, ctx.clientId);
    assert.equal(saved.firstCampaign.utm_source, 'github');
    assert.equal(saved.lastCampaign.utm_source, 'newsletter');
    const second = fixture(dir);
    const secondTracker = getInstaller(second.electron)(second.win, { enabled: true });
    assert.equal(second.getContext().firstInstall, false);
    assert.equal(second.getContext().clientId, ctx.clientId);
    second.send('ready', true);
    assert.equal(second.events().filter((e) => e.name === 'desktop_daily_active').length, 0);
    assert.equal(second.events().filter((e) => e.name === 'desktop_first_install').length, 0);
    secondTracker.dispose();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
