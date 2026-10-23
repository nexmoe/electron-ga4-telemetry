const test = require('node:test');
const assert = require('node:assert/strict');
const { Window } = require('happy-dom');
const { ElectronGA4Telemetry } = require('../dist/renderer.js');

function browser() {
  const win = new Window({
    url: 'app://desktop/index.html',
    settings: { disableJavaScriptFileLoading: true, handleDisabledFileLoadingAsSuccess: true },
  });
  const doc = win.document;
  const ctx = {
    clientId: '654321.1730000000', appVersion: '3.0.0', platform: 'darwin', arch: 'arm64',
    osRelease: '24.1.0', channel: 'stable', firstInstall: true, startupMs: 100,
  };
  win.electronTelemetry = {
    getContext: async () => ctx, ready() {}, setEnabled() {}, onEvent: () => () => {},
    captureCampaign() {}, reportActivity() {},
  };
  Object.assign(globalThis, {window: win, document: doc, history: win.history, screen: win.screen});
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: win.navigator});
  return {
    win, doc,
    get scripts() { return doc.querySelectorAll('script'); },
    events: () => (win.dataLayer ?? []).filter(e => e[0] === 'event')
      .map(e => ({name:e[1], params:e[2]})),
  };
}

test('uses gtag Web recommended and ecommerce event schemas without faking session_start', async () => {
  const f = browser();
  const t = new ElectronGA4Telemetry({
    measurementId:'G-TEST123', virtualPageOrigin:'https://desktop.example.com',
    enabled:true, allowSearchTerms:true,
  });
  try {
    await t.init();
    t.login('Google'); t.signUp('email'); t.search('pink socks');
    t.share('X','video','demo');
    t.purchase({transaction_id:'order_123', currency:'USD', value:19.99,
      items:[{item_id:'pro_monthly',item_name:'Pro Plan',price:19.99,quantity:1}]});
    t.refund({transaction_id:'order_123',currency:'USD',value:19.99});
    t.fileDownload('.mp4');
    t.track('session_start'); t.track('first_visit'); t.track('user_engagement');
    t.track('page_view');
    const events = f.events();
    const names = events.map(e=>e.name);
    for (const name of ['login','sign_up','search','share','purchase','refund','file_download']) {
      assert.ok(names.includes(name), 'missing ' + name);
    }
    const purchase = events.find(e=>e.name==='purchase');
    assert.equal(purchase.params.transaction_id, 'order_123');
    assert.deepEqual(purchase.params.items,[{item_id:'pro_monthly',item_name:'Pro Plan',price:19.99,quantity:1}]);
    assert.equal(events.find(e=>e.name==='search').params.search_term,'pink socks');
    assert.equal(names.filter(x=>x==='page_view').length, 1);
    for (const name of ['session_start','first_visit','user_engagement']) assert.ok(!names.includes(name));

    // Exercise the actual documented GA4 gtag('get') fields.
    f.scripts[0].onload();
    f.win.gtag = (command, _, field, callback) => {
      if (command === 'get') callback(({client_id:'654321.1730000000', session_id:12345678, session_number:2})[field]);
    };
    const d = await t.diagnostics(100);
    assert.deepEqual(d, {enabled:true,protocol:'app:',scriptLoaded:true,
      clientIdMatchesProfile:true,sessionIdPresent:true,sessionNumberPresent:true});
  } finally { t.destroy(); await f.win.happyDOM.abort(); }
});

test('user retains legacy enhanced measurement and redacted URLs with real DOM events', async () => {
  // Given an explicitly enabled legacy fallback and actual DOM event propagation.
  // This contract test covers event metadata; real Electron media playback is verified separately.
  const f = browser();
  const t = new ElectronGA4Telemetry({
    measurementId:'G-TEST123',virtualPageOrigin:'https://desktop.example.com',enabled:true,
    enhancedFallback: {
      confirmedNativeEnhancedMeasurementDisabled:true,
      scroll:true,outboundClicks:true,fileDownloads:true,forms:true,html5Video:true,
    },
  });
  try {
    await t.init();
    // happy-dom has no layout engine, so supply the page's measured geometry.
    Object.defineProperty(f.doc.documentElement, 'scrollHeight', {value: 1600});
    f.win.innerHeight = 800;
    f.win.scrollTo({top: 650, behavior: 'instant'});
    // When the user scrolls, follows a download link, submits a form and plays a marked video.
    f.doc.dispatchEvent(new f.win.Event('scroll'));
    f.doc.dispatchEvent(new f.win.Event('scroll'));
    // Then scrolling is reported once and enhanced events retain their redacted contracts.
    assert.deepEqual(f.events().filter(e => e.name === 'scroll').map(e => e.params.percent_scrolled), [90]);

    const anchor = f.doc.createElement('a');
    anchor.href = 'https://external.example.org/path/video.mp4?private=1';
    anchor.addEventListener('click', event => event.preventDefault());
    f.doc.body.append(anchor);
    anchor.dispatchEvent(new f.win.MouseEvent('click', {bubbles: true, cancelable: true}));
    const click = f.events().find(e=>e.name==='click');
    assert.equal(click.params.link_url,'https://external.example.org');
    assert.equal(click.params.link_domain,'external.example.org');
    assert.equal(f.events().find(e=>e.name==='file_download').params.file_extension,'mp4');
    assert.ok(!JSON.stringify(click).includes('private=1'));

    const form = f.doc.createElement('form');
    form.setAttribute('data-ga4-form', 'signup');
    const input = f.doc.createElement('input');
    input.value = 'private@example.com';
    form.append(input);
    f.doc.body.append(form);
    input.dispatchEvent(new f.win.FocusEvent('focusin', {bubbles: true}));
    input.dispatchEvent(new f.win.FocusEvent('focusin', {bubbles: true}));
    form.dispatchEvent(new f.win.Event('submit', {bubbles: true, cancelable: true}));
    assert.equal(f.events().filter(e=>e.name==='form_start').length,1);
    assert.equal(f.events().filter(e=>e.name==='form_submit').length,1);

    const video = f.doc.createElement('video');
    video.setAttribute('data-ga4-video', 'demo_video');
    f.doc.body.append(video);
    // happy-dom does not decode media; supply metadata from the playback fixture.
    Object.defineProperty(video, 'duration', {value: 100});
    video.dispatchEvent(new f.win.Event('play'));
    video.currentTime = 55;
    video.dispatchEvent(new f.win.Event('timeupdate'));
    video.dispatchEvent(new f.win.Event('ended'));
    assert.equal(f.events().filter(e=>e.name==='video_start').length,1);
    assert.equal(f.events().filter(e=>e.name==='video_progress').length,3);
    assert.equal(f.events().filter(e=>e.name==='video_complete').length,1);
    assert.ok(!JSON.stringify(f.events()).includes('private@example.com'));
    assert.ok(!JSON.stringify(f.events()).includes('private=1'));
  } finally { t.destroy(); await f.win.happyDOM.abort(); }
});
