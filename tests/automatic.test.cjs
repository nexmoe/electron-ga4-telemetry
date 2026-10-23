const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Window } = require('happy-dom');
const {
  getAutoGoogleAnalytics,
  resolveAnalyticsRoute,
} = require('../dist/desktop.js');

// These protocol/configuration tests complement tests/electron-automatic.cjs;
// only real Electron can validate preload IPC, trusted frames and Google delivery.
test('user bootstraps once from serializable main-process settings without renderer setup', async () => {
  // Given the packaged browser runtime and explicit app-owned identity/consent settings.
  const window = new Window({
    url: 'https://desktop.example.com/',
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
  window.localStorage.setItem('existing:client-id', '123.456');
  const bootstrap = window.eval(
    readFileSync(join(__dirname, '../dist/renderer-bootstrap.js'), 'utf8'),
  );
  const options = {
    measurementId: 'G-TEST123',
    pageLocation: 'https://desktop.example.com/',
    clientIdStorageKey: 'existing:client-id',
    consent: { ad_storage: 'denied' },
  };
  try {
    // When main-process initialization is repeated and the app uses native gtag after setup.
    bootstrap(options);
    bootstrap(options);
    window.gtag('event', 'app_started', { send_to: 'G-TEST123' });
    // Then native configuration and the business event share one retained identity.
    const commands = JSON.parse(
      JSON.stringify(window.dataLayer.map((command) => Array.from(command))),
    );
    assert.deepEqual(
      commands.filter(([name]) => name === 'config'),
      [
        [
          'config',
          'G-TEST123',
          {
            client_id: '123.456',
            page_location: 'https://desktop.example.com/',
            send_page_view: true,
          },
        ],
      ],
    );
    assert.deepEqual(commands[0], [
      'consent',
      'default',
      { ad_storage: 'denied' },
    ]);
    assert.equal(commands.at(-1)[1], 'app_started');
    assert.equal(await getAutoGoogleAnalytics('G-OTHER'), null);
  } finally {
    await window.happyDOM.abort();
  }
});

test('user routes retain exact overrides and approved wildcard screens without exposing identifiers', () => {
  // Given a serializable route policy supplied by main, with an explicit new-page override.
  const routes = {
    '/': 'home',
    '/notes/new': 'notes/new',
    '/notes/*': 'notes/editor',
    '/private/*': null,
  };
  // When a private entity path, an exact route and an unapproved route are resolved.
  const result = [
    '/notes/private-id/edit',
    '/notes/new',
    '/private/secret',
    '/unknown',
    '/',
  ].map((path) => resolveAnalyticsRoute(path, routes));
  // Then only approved fixed labels are returned; unknown paths are not reported.
  assert.deepEqual(result, ['notes/editor', 'notes/new', null, null, 'home']);
});

test('user without automatic initialization receives no client or persistent identity', async () => {
  // Given a document without any analytics setup.
  const window = new Window({ url: 'https://desktop.example.com/' });
  Object.assign(globalThis, {
    window,
    document: window.document,
    history: window.history,
  });
  try {
    // When a business integration asks for the prepared client.
    const client = await getAutoGoogleAnalytics('G-TEST123');
    // Then it can safely omit analytics without creating a tag or identifier.
    assert.equal(client, null);
    assert.equal(window.dataLayer, undefined);
    assert.equal(window.localStorage.length, 0);
  } finally {
    await window.happyDOM.abort();
  }
});
