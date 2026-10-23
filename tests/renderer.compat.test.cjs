const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ElectronGA4Telemetry } = require('../dist/renderer.js');

function emitter() {
  const e = new EventEmitter();
  return {
    addEventListener(name, fn) { e.on(name, fn); },
    removeEventListener(name, fn) { e.off(name, fn); },
    dispatch(name, event) { e.emit(name, event); },
  };
}
function fakeBrowser() {
  const winEvents = emitter(), docEvents = emitter();
  const scripts = [];
  const ctx = {
    clientId: '654321.1730000000', appVersion: '3.0.0', platform: 'darwin', arch: 'arm64',
    osRelease: '24.1.0', channel: 'stable', firstInstall: true, startupMs: 100,
  };
  const bridge = {
    getContext: async () => ctx, ready() {}, setEnabled() {}, onEvent: () => () => {},
    captureCampaign() {}, reportActivity() {},
  };
  let pathname = '/';
  const win = {
    ...winEvents, electronTelemetry: bridge,
    location: { href: 'app://desktop/index.html', protocol:'app:', hostname:'desktop',
      get pathname() { return pathname; }, hash:'' },
    devicePixelRatio:2, innerHeight:800, scrollY:0,
  };
  const doc = {
    ...docEvents,
    head: { appendChild(s) { scripts.push(s); } },
    createElement: () => ({ dataset:{}, async:false }),
    querySelector: () => null,
    visibilityState:'visible', readyState:'complete', hasFocus:() => true,
    documentElement:{scrollHeight:1600},
  };
  const hist = {
    pushState(_, __, path) { pathname = path; },
    replaceState(_, __, path) { pathname = path; },
  };
  Object.assign(global, {window:win,document:doc,history:hist,screen:{width:1920,height:1080}});
  Object.defineProperty(global,'navigator',{configurable:true,value:{language:'en-US'}});
  return {
    win,doc,scripts,
    events: () => (win.dataLayer ?? []).filter(e => e[0] === 'event')
      .map(e => ({name:e[1], params:e[2]})),
  };
}

test('uses gtag Web recommended and ecommerce event schemas without faking session_start', async () => {
  const f = fakeBrowser();
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
  } finally { t.destroy(); }
});

test('explicit enhanced measurement fallback emits Web event names and redacts URL', async () => {
  const f = fakeBrowser();
  const t = new ElectronGA4Telemetry({
    measurementId:'G-TEST123',virtualPageOrigin:'https://desktop.example.com',enabled:true,
    enhancedFallback: {
      confirmedNativeEnhancedMeasurementDisabled:true,
      scroll:true,outboundClicks:true,fileDownloads:true,forms:true,html5Video:true,
    },
  });
  try {
    await t.init();
    f.win.scrollY = 650;
    f.win.dispatch('scroll', {});
    f.win.dispatch('scroll', {});
    assert.equal(f.events().filter(e=>e.name==='scroll').length,1);

    const anchor = { getAttribute: () => 'https://external.example.org/path/video.mp4?private=1' };
    f.doc.dispatch('click', {target:{closest(sel){return sel==='a[href]'?anchor:null;}}});
    const click = f.events().find(e=>e.name==='click');
    assert.equal(click.params.link_url,'https://external.example.org');
    assert.equal(click.params.link_domain,'external.example.org');
    assert.equal(f.events().find(e=>e.name==='file_download').params.file_extension,'mp4');
    assert.ok(!JSON.stringify(click).includes('private=1'));

    const form = {getAttribute:()=> 'signup'};
    const formTarget = {closest:()=>form};
    f.doc.dispatch('focusin',{target:formTarget});
    f.doc.dispatch('focusin',{target:formTarget});
    f.doc.dispatch('submit',{target:formTarget});
    assert.equal(f.events().filter(e=>e.name==='form_start').length,1);
    assert.equal(f.events().filter(e=>e.name==='form_submit').length,1);

    const video = {
      duration:100,currentTime:0,matches:()=>true,getAttribute:()=> 'demo_video',
    };
    f.doc.dispatch('play',{type:'play',target:video});
    video.currentTime=55;
    f.doc.dispatch('timeupdate',{type:'timeupdate',target:video});
    f.doc.dispatch('ended',{type:'ended',target:video});
    assert.equal(f.events().filter(e=>e.name==='video_start').length,1);
    assert.equal(f.events().filter(e=>e.name==='video_progress').length,3);
    assert.equal(f.events().filter(e=>e.name==='video_complete').length,1);
  } finally { t.destroy(); }
});
