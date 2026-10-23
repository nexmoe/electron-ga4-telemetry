// Opt-in user consent parity with unmodified official gtag; no fake Google tag.
const { app } = require('electron');
const { createGoogleTagTransport } = require('../dist/transport.js');
const { mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const id = process.env.GA4_MEASUREMENT_ID;
if (!/^G-[A-Z0-9]+$/.test(id ?? ''))
  throw Error('Set GA4_MEASUREMENT_ID to an approved stream');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'ga4-native-consent-')));
app.whenReady().then(async () => {
  let transport;
  try {
    transport = createGoogleTagTransport({
      measurementId: id,
      origin: 'https://consent.example.com',
      isAllowedSender: () => false,
    });
    await transport.ready;
    const result =
      await transport.collector.webContents.executeJavaScript(`(async()=>{
 gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});gtag('js',new Date());gtag('config',${JSON.stringify(id)},{send_page_view:false});
 const get=()=>new Promise(resolve=>{const timer=setTimeout(()=>resolve('timed-out'),8000);gtag('get',${JSON.stringify(id)},'client_id',value=>{clearTimeout(timer);resolve(typeof value==='string'?'received':'empty')})});
 gtag('event','desktop_consent_native_probe',{validation_run:'native_consent_parity',probe_stage:'initial'});
 // Given the official tag has initialized its real anonymous cookie.
 const initial=await get();
 // When native consent is withdrawn and later granted without any SDK wrapper.
 gtag('consent','update',{analytics_storage:'denied'});gtag('consent','update',{analytics_storage:'granted'});
 const afterConsentOnly=await get();
 gtag('event','desktop_consent_native_probe',{validation_run:'native_consent_parity',probe_stage:'after_grant'});
 // Then a real post-grant event makes native identity available again.
 const afterEvent=await get();return {initial,afterConsentOnly,afterEvent};})()`);
    assert.equal(result.initial, 'received');
    assert.equal(result.afterEvent, 'received');
    console.log(
      JSON.stringify(
        {
          path: 'unmodified official gtag in HTTPS collector; no preload or client wrapper',
          ...result,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    transport?.dispose();
    app.quit();
  }
});

// Electron app.quit does not propagate Node process.exitCode on its own.
app.on('will-quit', () => app.exit(Number(process.exitCode) || 0));
