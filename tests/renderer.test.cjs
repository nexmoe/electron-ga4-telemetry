const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ElectronGA4Telemetry } = require('../dist/renderer.js');

function emitter() {
  const e = new EventEmitter();
  return {
    addEventListener(name, fn) { e.on(name, fn); },
    removeEventListener(name, fn) { e.off(name, fn); },
    dispatch(name, payload = {}) { e.emit(name, payload); },
  };
}
function fakeBrowser() {
  const winEvents = emitter();
  const docEvents = emitter();
  const scripts = [];
  const sent = [];
  let nativeListener;
  const clientContext = {
    clientId: '654321.1730000000', appVersion: '1.4.0', platform: 'darwin',
    arch: 'arm64', osRelease: '24.1.0', channel: 'stable', firstInstall: true,
    startupMs: 152, launchCampaign: { utm_source: 'github' },
  };
  let pathname = '/';
  const bridge = {
    getContext: async () => clientContext,
    ready: (x) => sent.push(['ready', x]),
    setEnabled: (x) => sent.push(['enabled', x]),
    onEvent: (callback) => { nativeListener = callback; return () => { nativeListener = undefined; }; },
    captureCampaign: (c) => sent.push(['campaign', c]),
    reportActivity: () => sent.push(['activity']),
  };
  const window = {
    ...winEvents,
    electronTelemetry: bridge,
    dataLayer: undefined,
    gtag: undefined,
    location: { get pathname() { return pathname; }, hash: '' },
    innerHeight: 800, scrollY: 0, devicePixelRatio: 2,
  };
  const document = {
    ...docEvents,
    head: { appendChild: (s) => scripts.push(s) },
    querySelector: (selector) => scripts.find((s) => selector.includes(s.dataset.electronGa4)) ?? null,
    createElement: () => ({ dataset: {}, async: false }),
    visibilityState: 'visible', readyState: 'complete',
    hasFocus: () => true,
    documentElement: { scrollHeight: 1600 },
  };
  const history = {
    pushState(_, __, url) { pathname = new URL(url, 'https://desktop.example.com').pathname; },
    replaceState(_, __, url) { pathname = new URL(url, 'https://desktop.example.com').pathname; },
  };
  Object.assign(global, { window, document, history, screen: { width: 1920, height: 1080 } });
  Object.defineProperty(global, 'navigator', { configurable: true, value: { language: 'en-US' } });
  return {
    window, document, scripts, sent, bridge,
    emitNative: (event) => nativeListener?.(event),
    events: () => (window.dataLayer ?? []).map((x) => Array.from(x)).filter((x) => x[0] === 'event').map((x) => ({ name: x[1], params: x[2] })),
    configs: () => (window.dataLayer ?? []).map((x) => Array.from(x)).filter((x) => x[0] === 'config'),
  };
}

test('auto routes, safe event payloads, campaign and consent handling', async () => {
  const fake = fakeBrowser();
  const telemetry = new ElectronGA4Telemetry({
    measurementId: 'G-TEST123', virtualPageOrigin: 'https://desktop.example.com',
    enabled: true, autoClicks: true, autoScroll: true,
  });
  try {
    await telemetry.init();
    assert.equal(fake.scripts.length, 1);
    assert.equal(fake.configs().length, 1);
    assert.equal(fake.configs()[0][2].client_id, '654321.1730000000');
    assert.equal(fake.configs()[0][2].campaign_source, 'github');
    assert.equal(fake.configs()[0][2].send_page_view, false);
    assert.equal(fake.events().filter((x) => x.name === 'page_view').length, 1);
    assert.ok(fake.events().some((x) => x.name === 'desktop_device_info'));
    history.pushState({}, '', '/downloads/8122?token=do-not-send');
    history.pushState({}, '', '/downloads/9922');
    assert.equal(fake.events().filter((x) => x.name === 'page_view').length, 2);
    assert.equal(fake.events().filter((x) => x.name === 'page_view').at(-1).params.page_location,
      'https://desktop.example.com/desktop/downloads/detail');
    telemetry.track('feature_used', { feature_name: 'search', path: '/Users/john/files/video.mp4' });
    assert.deepEqual(fake.events().at(-1).params, {
      feature_name: 'search', send_to: 'G-TEST123', page_title: 'downloads/detail',
      page_location: 'https://desktop.example.com/desktop/downloads/detail',
    });
    fake.document.dispatch('click', {
      target: { closest: () => ({ getAttribute: (key) => key === 'data-ga4-event' ? 'open_settings' : 'core' }) },
    });
    assert.ok(fake.events().some((e) => e.name === 'desktop_ui_click' && e.params.action_name === 'open_settings'));
    fake.window.scrollY = 1200;
    fake.window.dispatch('scroll');
    assert.ok(fake.events().some((e) => e.name === 'desktop_scroll_depth'));
    assert.equal(telemetry.captureAttribution('vidbee://open?utm_source=newsletter&utm_medium=email&user=secret'), true);
    assert.equal(fake.configs().at(-1)[2].campaign_source, 'newsletter');
    assert.deepEqual(fake.sent.findLast((x) => x[0] === 'campaign')[1], { utm_source: 'newsletter', utm_medium: 'email' });
    fake.emitNative({ name: 'renderer_process_gone', params: { reason: 'crashed' } });
    assert.ok(fake.events().some((x) => x.name === 'renderer_process_gone'));
    await telemetry.setEnabled(false);
    const before = fake.events().length;
    telemetry.track('feature_used', { feature_name: 'blocked' });
    assert.equal(fake.events().length, before);
    assert.equal(fake.window['ga-disable-G-TEST123'], true);
    await telemetry.setEnabled(true);
    assert.equal(fake.window['ga-disable-G-TEST123'], false);
    telemetry.feature('reopened');
    assert.equal(fake.events().at(-1).name, 'feature_used');
  } finally { telemetry.destroy(); }
});
