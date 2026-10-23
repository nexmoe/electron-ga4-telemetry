const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const { Window } = require('happy-dom');

// Exercise the compiled Main transport and packaged renderer against Electron API doubles.
// These tests verify identity/lifecycle behavior, not Google delivery or GA4 reports.
async function fixture(directory, rendererOptions = {}, extra = {}) {
  const handlers = new Map();
  const ipcMain = {
    handle: (name, callback) => handlers.set(name, callback),
    removeHandler: (name) => handlers.delete(name),
  };
  const app = new EventEmitter();
  app.isReady = () => true;
  app.getPath = () => directory;
  const powerMonitor = new EventEmitter();
  const protocol = { handle() {}, unhandle() {} };
  const collectorSession = new EventEmitter();
  collectorSession.protocol = protocol;
  const windows = [];
  let nextId = 1;
  class BrowserWindow extends EventEmitter {
    static getAllWindows() { return windows; }
    static getFocusedWindow() { return undefined; }
    constructor() {
      super();
      this.webContents = new EventEmitter();
      this.webContents.id = nextId++;
      this.webContents.session = collectorSession;
      this.webContents.isDestroyed = () => this.destroyed === true;
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.executeJavaScript = async (code) => vm.runInContext(code, this.context);
      this.loads = 0;
      this.generations = [];
      windows.push(this);
      app.emit('browser-window-created', {}, this);
    }
    isDestroyed() { return this.destroyed === true; }
    isVisible() { return false; }
    isFocused() { return false; }
    async loadURL() {
      this.loads++;
      if (this.failLoad) throw new Error('collector load failed');
      const commands = [];
      this.generations.push(commands);
      this.context = vm.createContext({
        window: {
          gtag: (...args) => commands.push(args),
          __electronGa4SetForeground() {},
        },
        setTimeout, clearTimeout,
      });
    }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const electron = { app, BrowserWindow, ipcMain, powerMonitor,
    session: { fromPartition: () => collectorSession }, shell: { openExternal: async () => {} } };
  const path = require.resolve('../dist/transport.js');
  delete require.cache[path];
  const previous = Module._load;
  Module._load = function (name, ...args) {
    return name === 'electron' ? electron : previous.call(this, name, ...args);
  };
  let install;
  try { install = require(path).installGoogleAnalytics; }
  finally { Module._load = previous; }
  const errors = [];
  const transport = install({ measurementId: 'G-STABLE123', appOrigins: ['app://desktop', 'app://settings'],
    renderer: rendererOptions, onError: (error) => errors.push(error), ...extra });
  await transport.ready;
  const renderers = [];
  const pending = new Set();
  async function renderer(url = 'app://desktop/', stored, blockedStorage = false) {
    const window = new Window({ url, settings: {
      disableJavaScriptFileLoading: true, handleDisabledFileLoadingAsSuccess: true,
    } });
    if (stored) window.localStorage.setItem('electron-ga4:G-STABLE123:client-id', stored);
    if (blockedStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
    const sender = new EventEmitter();
    sender.id = nextId++;
    sender.mainFrame = { executeJavaScript: async (code) => window.eval(code) };
    sender.getURL = () => url;
    sender.isDestroyed = () => false;
    sender.executeJavaScript = sender.mainFrame.executeJavaScript;
    sender.session = collectorSession;
    sender.send = () => {};
    const event = { sender, senderFrame: sender.mainFrame };
    const command = (args) => handlers.get('electron-ga4:command')(event, args);
    window.electronGoogleTag = {
      send(args) {
        const result = command(args);
        pending.add(result);
        void result.finally(() => pending.delete(result)).catch(() => {});
        return result;
      },
    };
    renderers.push(window);
    const result = await handlers.get('electron-ga4:initialize')(event);
    await drain();
    return {
      window, result, sender, command,
      id: () => window.localStorage.getItem('electron-ga4:G-STABLE123:client-id'),
      configuredId: () => Array.from(window.dataLayer ?? []).find(args => args[0] === 'config')?.[2].client_id,
      update: (id) => window.eval(`window[Symbol.for('electron-ga4.desktop.clients')].get('G-STABLE123').setClientId(${JSON.stringify(id)})`),
    };
  }
  async function drain() { while (pending.size) await Promise.allSettled([...pending]); }
  return {
    transport, renderer, errors, drain, app, powerMonitor,
    collector: transport.collector,
    async close() {
      transport.dispose();
      await drain();
      for (const window of renderers) await window.happyDOM.abort();
    },
  };
}

async function withDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'ga4-production-'));
  try { await run(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test('production identity migrates once and survives restart with missing or stale renderer storage', async () => {
  await withDirectory(async (directory) => {
    const first = await fixture(directory);
    try {
      assert.equal((await first.renderer('app://desktop/', '123.456')).id(), '123.456');
    } finally { await first.close(); }
    const restarted = await fixture(directory);
    try {
      // A different first window/origin after an app upgrade must not create a new user.
      assert.equal((await restarted.renderer('app://settings/', '987.654')).id(), '123.456');
      assert.equal((await restarted.renderer()).id(), '123.456');
      assert.equal(restarted.transport.diagnostics().identityPersistence, 'persisted');
    } finally { await restarted.close(); }
  });
});

test('production identity updates synchronize sibling windows and survive a full restart', async () => {
  await withDirectory(async (directory) => {
    const first = await fixture(directory);
    try {
      const [main, sibling] = await Promise.all([first.renderer(), first.renderer('app://settings/')]);
      assert.equal(main.id(), sibling.id());
      main.update('321.654');
      await first.drain();
      assert.equal(sibling.id(), '321.654');
    } finally { await first.close(); }
    const restarted = await fixture(directory);
    try { assert.equal((await restarted.renderer()).id(), '321.654'); }
    finally { await restarted.close(); }
  });
});

test('production storage failures remain observable without breaking analytics or the app', async () => {
  await withDirectory(async (directory) => {
    const blocked = join(directory, 'not-a-directory');
    writeFileSync(blocked, 'blocked');
    const h = await fixture(blocked);
    try {
      const first = await h.renderer();
      assert.match(first.id(), /^\d+\.\d+$/);
      assert.equal((await h.renderer('app://settings/')).id(), first.id());
      assert.equal(h.transport.diagnostics().identityPersistence, 'memory');
      assert.ok(h.errors.some((error) => error.code === 'IDENTITY_STORAGE_FAILED'));
    } finally { await h.close(); }
  });
});

test('blocked renderer storage cannot replace the durable production identity', async () => {
  await withDirectory(async (directory) => {
    const first = await fixture(directory);
    let id;
    try { id = (await first.renderer()).id(); }
    finally { await first.close(); }
    const restarted = await fixture(directory);
    try {
      assert.equal((await restarted.renderer('app://settings/', undefined, true)).configuredId(), id);
      assert.equal(restarted.transport.diagnostics().identityPersistence, 'persisted');
    } finally { await restarted.close(); }
  });
});

test('disabled initialization creates no identity and re-enabling preserves the existing installation', async () => {
  await withDirectory(async (directory) => {
    const disabled = await fixture(directory, { enabled: false });
    try {
      assert.equal((await disabled.renderer()).id(), null);
      assert.equal(disabled.transport.diagnostics().identityPersistence, 'unused');
    } finally { await disabled.close(); }
    const first = await fixture(directory);
    let id;
    try { id = (await first.renderer()).id(); }
    finally { await first.close(); }
    const restarted = await fixture(directory, { enabled: false });
    try {
      const renderer = await restarted.renderer();
      renderer.window.eval(`window[Symbol.for('electron-ga4.desktop.clients')].get('G-STABLE123').setEnabled(true)`);
      await restarted.drain();
      assert.equal(renderer.id(), id);
    } finally { await restarted.close(); }
  });
});

test('native Google identity ownership remains available without Main creating an identity', async () => {
  await withDirectory(async (directory) => {
    const h = await fixture(directory, { clientIdStorageKey: false });
    try {
      assert.equal((await h.renderer()).configuredId(), undefined);
      assert.equal(h.transport.diagnostics().identityPersistence, 'unused');
    } finally { await h.close(); }
  });
});

test('identity changes reach Google before subsequent events while native callbacks remain non-blocking', async () => {
  await withDirectory(async (directory) => {
    const h = await fixture(directory);
    try {
      const renderer = await h.renderer();
      await Promise.all([
        renderer.command(['config', 'G-STABLE123', { client_id: '321.654', send_page_view: false }]),
        renderer.command(['event', 'after_identity', {}]),
      ]);
      const commands = h.collector.generations.at(-1);
      const update = commands.findIndex(args => args[0] === 'config' && args[2].client_id === '321.654');
      assert.ok(update < commands.findIndex(args => args[1] === 'after_identity'));
      const callback = renderer.command(['get', 'G-STABLE123', 'client_id', { __electron_ga4_callback__: 0 }]);
      await renderer.command(['event', 'while_get_pending', {}]);
      assert.ok(commands.some(args => args[1] === 'while_get_pending'));
      commands.find(args => args[0] === 'get')[3]('321.654');
      const result = await callback;
      assert.equal(result.values[0], '321.654');
    } finally { await h.close(); }
  });
});

test('a frozen auxiliary window does not block identity handoff or subsequent collector events', async () => {
  await withDirectory(async (directory) => {
    const h = await fixture(directory);
    try {
      const main = await h.renderer();
      const auxiliary = await h.renderer('app://settings/');
      auxiliary.sender.executeJavaScript = () => new Promise(() => {});
      main.update('321.654');
      await main.command(['event', 'after_handoff', {}]);
      const commands = h.collector.generations.at(-1);
      assert.ok(commands.some(args => args[0] === 'config' && args[2].client_id === '321.654'));
      assert.ok(commands.some(args => args[1] === 'after_handoff'));
    } finally { await h.close(); }
  });
});

test('collector crash restores identity, consent and configuration without replaying business events or PV', async () => {
  await withDirectory(async (directory) => {
    const h = await fixture(directory, { consent: { analytics_storage: 'granted' } });
    try {
      const renderer = await h.renderer();
      await renderer.command(['consent', 'update', { analytics_storage: 'denied' }]);
      await renderer.command(['set', { currency: 'CNY' }]);
      await renderer.command(['config', 'G-STABLE123', { user_id: 'account-42', page_location: 'https://electron-ga4.invalid/settings' }]);
      await renderer.command(['event', 'purchase', { transaction_id: 'once' }]);
      h.collector.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
      // A new command waits for recovery, then is delivered exactly once.
      await renderer.command(['event', 'feature_used', {}]);
      assert.equal(h.collector.loads, 2);
      const recovered = JSON.parse(JSON.stringify(h.collector.generations.at(-1)));
      const config = recovered.find(([name]) => name === 'config')[2];
      assert.equal(config.client_id, renderer.id());
      assert.equal(config.user_id, 'account-42');
      assert.equal(config.send_page_view, false);
      assert.deepEqual(recovered.filter(([name]) => name === 'consent'), [
        ['consent', 'default', { analytics_storage: 'granted' }],
        ['consent', 'update', { analytics_storage: 'denied' }],
      ]);
      assert.ok(recovered.some(([name, values]) => name === 'set' && values.currency === 'CNY'));
      assert.deepEqual(recovered.filter(([name]) => name === 'event').map(([, name]) => name), ['feature_used']);
      assert.equal(h.transport.diagnostics().collectorStatus, 'ready');
    } finally { await h.close(); }
  });
});

test('collector recovery stops after repeated crashes and dispose removes lifecycle listeners', async () => {
  await withDirectory(async (directory) => {
    const h = await fixture(directory);
    try {
      const renderer = await h.renderer();
      for (let i = 0; i < 4; i++) {
        h.collector.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
        await renderer.command(['event', 'probe', {}]).catch(() => {});
      }
      assert.equal(h.collector.loads, 4); // Initial load + at most three recovery attempts.
      assert.equal(h.transport.diagnostics().collectorStatus, 'failed');
      assert.ok(h.errors.some((error) => error.code === 'COLLECTOR_RECOVERY_EXHAUSTED'));
    } finally { await h.close(); }
    assert.equal(h.collector.webContents.listenerCount('render-process-gone'), 0);
    assert.equal(h.powerMonitor.listenerCount('resume'), 0);
  });
});

test('disposing during a failed collector recovery cancels backoff and further loads', async () => {
  await withDirectory(async (directory) => {
    const h = await fixture(directory);
    try {
      await h.renderer();
      h.collector.failLoad = true;
      h.collector.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
      await new Promise(resolve => setImmediate(resolve));
      h.transport.dispose();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.collector.loads, 2);
      assert.equal(h.transport.diagnostics().collectorStatus, 'disposed');
      assert.equal(h.errors.some(error => error.code === 'COLLECTOR_RECOVERY_EXHAUSTED'), false);
    } finally { await h.close(); }
  });
});

test('a collector that crashes again during recovery is retried before accepting new events', async () => {
  await withDirectory(async (directory) => {
    const h = await fixture(directory);
    try {
      const renderer = await h.renderer();
      const load = h.collector.loadURL.bind(h.collector);
      h.collector.loadURL = async () => {
        await load();
        if (h.collector.loads === 2) h.collector.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
      };
      h.collector.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
      await renderer.command(['event', 'after_second_recovery', {}]);
      assert.equal(h.collector.loads, 3);
      assert.equal(h.transport.diagnostics().collectorStatus, 'ready');
      assert.ok(h.collector.generations.at(-1).some(args => args[1] === 'after_second_recovery'));
    } finally { await h.close(); }
  });
});
