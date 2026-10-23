const test = require('node:test');
const assert = require('node:assert/strict');
const { Window } = require('happy-dom');
const { GoogleAnalyticsClient } = require('../dist/gtag.js');

function browser() {
  const window = new Window({
    url: 'https://desktop.example.com',
    settings: {
      disableJavaScriptFileLoading: true,
      handleDisabledFileLoadingAsSuccess: true,
    },
  });
  Object.assign(globalThis, {
    window,
    document: window.document,
    history: window.history,
  });
  return {
    window,
    commands: () =>
      (window.dataLayer ?? []).map((command) => Array.from(command)),
  };
}

// Queue/storage contracts complement the real Electron transport smoke; a DOM runner cannot validate Google delivery.
test('user retains the existing installation identity without application storage code', async () => {
  // Given the app already persisted an anonymous identity under its legacy key.
  const b = browser();
  b.window.localStorage.setItem('app:client-id', '123.456');
  const client = new GoogleAnalyticsClient({
    measurementId: 'G-TEST123',
    enabled: true,
    clientIdStorageKey: 'app:client-id',
  });
  try {
    // When initialization and a verified Web identity handoff use the public client.
    client.initialize();
    const initial = b
      .commands()
      .find(([name]) => name === 'config')[2].client_id;
    assert.equal(initial, '123.456');
    assert.equal(client.setClientId('987.654'), true);
    assert.equal(client.setClientId('private-account-id'), false);
    // Then the handoff persists without creating another page view and survives a new client.
    assert.equal(b.window.localStorage.getItem('app:client-id'), '987.654');
    assert.deepEqual(
      b
        .commands()
        .filter(([name]) => name === 'config')
        .at(-1),
      [
        'config',
        'G-TEST123',
        { client_id: '987.654', update: true, send_page_view: false },
      ],
    );
    client.destroy();
    const reopened = new GoogleAnalyticsClient({
      measurementId: 'G-TEST123',
      enabled: true,
      clientIdStorageKey: 'app:client-id',
    });
    reopened.initialize();
    assert.equal(
      b
        .commands()
        .filter(([name]) => name === 'config')
        .at(-1)[2].client_id,
      '987.654',
    );
    reopened.destroy();
  } finally {
    client.destroy();
    await b.window.happyDOM.abort();
  }
});

test('user uses one desktop client per stream and can recreate it after teardown', async () => {
  // Given desktop quick setup with an invalid stored value and explicit application consent.
  const { getDesktopGoogleAnalytics } = require('../dist/desktop.js');
  const b = browser();
  const options = {
    measurementId: 'G-TEST123',
    pageLocation: 'https://desktop.example.com/',
    clientIdStorageKey: 'app:client-id',
    privacy: 'redacted',
    consent: { ad_storage: 'denied' },
  };
  b.window.localStorage.setItem('app:client-id', 'private-account-id');
  const client = getDesktopGoogleAnalytics(options);
  try {
    // When independent callers initialize and an auxiliary stream is created but remains disabled.
    assert.equal(
      getDesktopGoogleAnalytics({ ...options, measurementId: 'g-test123' }),
      client,
    );
    client.initialize();
    getDesktopGoogleAnalytics(options).initialize();
    const disabled = getDesktopGoogleAnalytics({
      measurementId: 'G-DISABLED',
      pageLocation: options.pageLocation,
      enabled: false,
    });
    assert.equal(disabled.initialize(), false);
    disabled.destroy();
    // Then one official configuration is queued and its valid anonymous ID survives client recreation.
    const configs = b.commands().filter(([name]) => name === 'config');
    assert.equal(configs.length, 1);
    assert.match(configs[0][2].client_id, /^\d+\.\d+$/);
    assert.equal(
      b.window.localStorage.getItem('app:client-id'),
      configs[0][2].client_id,
    );
    assert.equal(
      b.window.localStorage.getItem('electron-ga4:G-DISABLED:client-id'),
      null,
    );
    assert.deepEqual(b.commands()[0], [
      'consent',
      'default',
      { ad_storage: 'denied' },
    ]);
    client.destroy();
    const replacement = getDesktopGoogleAnalytics(options);
    assert.notEqual(replacement, client);
    replacement.initialize();
    assert.equal(
      b
        .commands()
        .filter(([name]) => name === 'config')
        .at(-1)[2].client_id,
      configs[0][2].client_id,
    );
    replacement.destroy();
  } finally {
    client.destroy();
    await b.window.happyDOM.abort();
  }
});

test('user can initialize desktop analytics with blocked storage without breaking the app', async () => {
  // Given an opaque origin whose real DOM storage API rejects access.
  const { getDesktopGoogleAnalytics } = require('../dist/desktop.js');
  const window = new Window({
    url: 'about:blank',
    settings: {
      disableJavaScriptFileLoading: true,
      handleDisabledFileLoadingAsSuccess: true,
    },
  });
  Object.assign(globalThis, {
    window,
    document: window.document,
    history: window.history,
  });
  const client = getDesktopGoogleAnalytics({
    measurementId: 'G-TEST123',
    pageLocation: 'https://desktop.example.com/',
  });
  try {
    // When the app initializes and accepts a verified anonymous identity.
    client.initialize();
    assert.equal(client.setClientId('987.654'), true);
    // Then collection continues with an in-memory identity and native consent defaults.
    const commands = window.dataLayer.map((command) => Array.from(command));
    assert.match(
      commands.find(([name]) => name === 'config')[2].client_id,
      /^\d+\.\d+$/,
    );
    assert.deepEqual(
      commands.filter(([name]) => name === 'consent'),
      [],
    );
    assert.equal(commands.at(-1)[2].client_id, '987.654');
  } finally {
    client.destroy();
    await window.happyDOM.abort();
  }
});
