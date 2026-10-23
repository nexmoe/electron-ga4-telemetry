const test = require('node:test');
const assert = require('node:assert/strict');
const { Window } = require('happy-dom');
const { GoogleAnalyticsClient } = require('../dist/gtag.js');

function browser() {
  const window = new Window({ url: 'https://desktop.example.com' });
  Object.assign(globalThis, { window, document: window.document });
  return { window, commands: () => (window.dataLayer ?? []).map((command) => Array.from(command)) };
}

test('user sends events with a stable anonymous ID and one Google tag', () => {
  // Given an installation with an existing anonymous identity.
  const b = browser();
  const client = new GoogleAnalyticsClient({ measurementId: 'G-TEST123', clientId: '123.456',
    pageLocation: 'https://desktop.example.com/', pageTitle: 'Desktop', enabled: true, sendPageView: false });
  // When the application starts repeatedly and sends an activation event.
  client.initialize();
  client.initialize();
  client.track('desktop_activation_completed', { method: 'browser' });
  // Then the public Google tag protocol retains its identity without duplicate scripts or page views.
  assert.equal(b.window.document.querySelectorAll('script').length, 1);
  assert.equal(b.commands().filter(([command]) => command === 'config').length, 1);
  assert.equal(Object.prototype.toString.call(b.window.dataLayer[0]), '[object Arguments]');
  assert.deepEqual(b.commands().find(([command]) => command === 'config')[2], {
    client_id: '123.456', page_location: 'https://desktop.example.com/', page_title: 'Desktop',
    send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
  });
  assert.deepEqual(b.commands().at(-1), ['event', 'desktop_activation_completed', {
    method: 'browser', send_to: 'G-TEST123', page_location: 'https://desktop.example.com/', page_title: 'Desktop',
  }]);
  b.window.happyDOM.abort();
});

test('user joins the Web funnel before the next event and can disable collection', () => {
  // Given an initialized installation.
  const b = browser();
  const client = new GoogleAnalyticsClient({ measurementId: 'G-TEST123', clientId: '123.456',
    pageLocation: 'https://desktop.example.com/', pageTitle: 'Desktop', enabled: true, sendPageView: false });
  client.initialize();
  // When a verified handoff supplies an anonymous Web ID, followed by consent withdrawal.
  assert.equal(client.setClientId('987.654'), true);
  assert.equal(client.setClientId('account-id'), false);
  client.track('desktop_activation_completed');
  client.setEnabled(false);
  const before = b.commands().length;
  client.track('desktop_app_started');
  // Then subsequent events use the new config and disabled collection adds no event.
  assert.equal(b.commands().length, before);
  assert.equal(b.window['ga-disable-G-TEST123'], true);
  assert.deepEqual(b.commands().filter(([command]) => command === 'config').at(-1),
    ['config', 'G-TEST123', { client_id: '987.654', update: true, send_page_view: false }]);
  b.window.happyDOM.abort();
});

test('user without analytics enabled does not load scripts or queue commands', () => {
  // Given a disabled collector.
  const b = browser();
  const client = new GoogleAnalyticsClient({ measurementId: 'G-TEST123', clientId: '123.456',
    pageLocation: 'https://desktop.example.com/', pageTitle: 'Desktop' });
  // When the app tries to initialize and send an event.
  assert.equal(client.initialize(), false);
  client.track('desktop_app_started');
  // Then there is no script or outbound command.
  assert.deepEqual(b.commands(), []);
  assert.equal(b.window.document.querySelectorAll('script').length, 0);
  b.window.happyDOM.abort();
});

test('user retains official page collection and can use the native command API', () => {
  // Given an enabled client with official defaults and a stream configuration.
  const b = browser();
  const client = new GoogleAnalyticsClient({ measurementId: 'G-TEST123', clientId: '123.456',
    pageLocation: 'https://desktop.example.com/', pageTitle: 'Desktop', enabled: true,
    config: { cookie_domain: 'none', debug_mode: true } });
  // When collection starts and the application uses an official get command.
  client.initialize();
  const callback = () => {};
  client.gtag('get', 'G-TEST123', 'session_id', callback);
  // Then the official configuration and command pass through without desktop substitutes.
  assert.equal(b.commands().find(([command]) => command === 'config')[2].send_page_view, true);
  assert.equal(b.commands().find(([command]) => command === 'config')[2].cookie_domain, 'none');
  assert.deepEqual(b.commands().at(-1), ['get', 'G-TEST123', 'session_id', callback]);
  assert.equal(b.commands().filter(([command]) => command === 'event').length, 0);
  b.window.happyDOM.abort();
});
