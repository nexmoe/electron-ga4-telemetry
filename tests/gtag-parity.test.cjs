const test = require('node:test');
const assert = require('node:assert/strict');
const { Window } = require('happy-dom');
const { GoogleAnalyticsClient } = require('../dist/gtag.js');
function browser() {
  const window = new Window({url:'https://desktop.example.com', settings:{disableJavaScriptFileLoading:true,handleDisabledFileLoadingAsSuccess:true}});
  Object.assign(globalThis, { window, document:window.document });
  return { window, commands:()=>window.dataLayer.map(command=>Array.from(command)) };
}
test('user retains native GA4 defaults without an injected consent or advertising policy', () => {
  // Given an enabled client without an application consent policy.
  const b=browser();const client=new GoogleAnalyticsClient({measurementId:'G-TEST123',enabled:true});
  // When the client initializes the official Google tag.
  client.initialize();
  // Then configuration preserves native defaults and no consent command is invented.
  assert.deepEqual(b.commands().filter(([name])=>name==='consent'),[]);
  assert.deepEqual(b.commands().find(([name])=>name==='config'),['config','G-TEST123',{send_page_view:true}]);
  b.window.happyDOM.abort();
});
test('user supplies consent before configuration and retains it across SDK pause and resume', () => {
  // Given explicit application-owned consent.
  const b=browser();const consent={analytics_storage:'denied',ad_storage:'denied',wait_for_update:500};
  const client=new GoogleAnalyticsClient({measurementId:'G-TEST123',enabled:true,consent});
  // When the application initializes, pauses and resumes its SDK.
  client.initialize();client.setEnabled(false);client.setEnabled(true);
  // Then only the requested native consent policy is queued, before config.
  assert.deepEqual(b.commands()[0],['consent','default',consent]);
  assert.deepEqual(b.commands().filter(([name])=>name==='consent'),[['consent','default',consent]]);
  b.window.happyDOM.abort();
});
test('user sends GA4 case-sensitive events with their explicit destination and ecommerce items', () => {
  // Given a client with one default stream.
  const b=browser();const client=new GoogleAnalyticsClient({measurementId:'G-TEST123',enabled:true});
  const params={send_to:['G-OTHER123','G-ANOTHER123'],items:[{item_id:'plan',quantity:2,price:12}]};
  // When the application selects other destinations and a case-sensitive event name.
  client.track('View_Item',params);
  // Then the native event schema and destination survive unchanged.
  assert.deepEqual(b.commands().at(-1),['event','View_Item',params]);
  b.window.happyDOM.abort();
});

test('user can withdraw native consent while the SDK is paused without an automatic re-grant', () => {
  // Given an initialized client and application-owned consent.
  const b=browser();const client=new GoogleAnalyticsClient({measurementId:'G-TEST123',enabled:true});client.initialize();
  // When the user pauses the SDK, withdraws consent, and resumes delivery.
  client.setEnabled(false);client.gtag('consent','update',{analytics_storage:'denied'});client.setEnabled(true);
  // Then the explicit withdrawal is preserved without any invented grant.
  assert.deepEqual(b.commands().filter(([name])=>name==='consent'),[['consent','update',{analytics_storage:'denied'}]]);b.window.happyDOM.abort();
});
