// Surface: @ga4-automatic. Explicit real-Google acceptance, excluded from offline *.test.cjs.
const { app, BrowserWindow, protocol } = require('electron');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const { installGoogleAnalytics } = require('../dist/transport.js');
const id = process.env.GA4_MEASUREMENT_ID;
if (!/^G-[A-Z0-9]+$/i.test(id ?? ''))
  throw new Error('Set GA4_MEASUREMENT_ID to an approved test stream');
const directory = mkdtempSync(join(tmpdir(), 'ga4-automatic-'));
app.setPath('userData', join(directory, 'profile'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'ga4test', privileges: { standard: true, secure: true } },
]);
const deadline = setTimeout(() => {
  console.error('FAIL: automatic acceptance exceeded 90 seconds');
  app.exit(1);
}, 90000);
app
  .whenReady()
  .then(async () => {
    let telemetry, main, sibling, denied;
    try {
      // Given only Main configuration and one preload installation; no renderer setup or imports.
    assert.throws(() => installGoogleAnalytics({measurementId: id}), /Provide appOrigins/);
    assert.throws(() => installGoogleAnalytics({measurementId: id, appOrigins: ['file:///private']}), /clean, non-opaque/);
      telemetry = installGoogleAnalytics({
        measurementId: id,
        appOrigins: ['ga4test://desktop'],
        renderer: {
          privacy: 'redacted',
          routes: { '/': 'home', '/notes/*': 'notes/editor' },
        },
      });
      const preload = join(directory, 'preload.cjs');
      writeFileSync(
        preload,
        readFileSync(join(__dirname, '../dist/transport-preload.js'), 'utf8') +
          '\ninstallGoogleTagPreload();',
      );
      protocol.handle(
        'ga4test',
        () =>
          new Response(
            '<!doctype html><title>Automatic GA4</title><body>Acceptance</body>',
            {
              headers: {
                'content-type': 'text/html',
                'content-security-policy':
                  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'",
              },
            },
          ),
      );
      main = new BrowserWindow({
        show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true },
      });
      sibling = new BrowserWindow({show: false, webPreferences: {preload, sandbox: true, contextIsolation: true}});
    await Promise.all([main.loadURL('ga4test://desktop/'), sibling.loadURL('ga4test://desktop/')]);
      assert.equal(
        await main.webContents.executeJavaScript(
          'window.electronGoogleTag.ready()',
        ),
        id,
      );
      await telemetry.ready;
      const identity = () =>
        main.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Google identity timed out')),12000);
      gtag('get',${JSON.stringify(id)},'client_id',cid=>gtag('get',${JSON.stringify(id)},'session_id',sid=>{clearTimeout(timer);resolve({cid,sid})}));
    })`);
      const before = await identity();
    assert.equal(await sibling.webContents.executeJavaScript('window.electronGoogleTag.ready()'), id);
    const siblingId = await sibling.webContents.executeJavaScript(`new Promise(resolve => gtag('get', ${JSON.stringify(id)}, 'client_id', resolve))`);
    assert.equal(siblingId, before.cid);
    for (const window of [main, sibling]) {
      const configuredId = await window.webContents.executeJavaScript(`window.dataLayer.find(args=>args[0]==='config' && args[1]===${JSON.stringify(id)})[2].client_id`);
      assert.equal(configuredId, before.cid);
      assert.equal(await window.webContents.executeJavaScript(`localStorage.getItem('electron-ga4:'+${JSON.stringify(id)}+':client-id')`), before.cid);
    }
      assert.match(before.cid, /^\d+\.\d+$/);
      assert.ok(Number(before.sid) > 0);
      // When navigation, a real inner-pane scroll and an untrusted window occur.
      const events = await main.webContents.executeJavaScript(`(() => {
      history.pushState({},'', '/notes/private-note-id');
      const pane=document.createElement('div');pane.style.cssText='height:100px;overflow:auto';pane.innerHTML='<div style="height:1000px">Content</div>';document.body.append(pane);pane.scrollTop=900;pane.dispatchEvent(new Event('scroll'));
      return window.dataLayer.filter(args=>args[0]==='event').map(args=>Array.from(args));
    })()`);
      assert.equal(
        events.find((e) => e[0] === 'event' && e[1] === 'page_view')[2]
          .page_location,
        'https://electron-ga4.invalid/desktop/notes/editor',
      );
      assert.equal(
        events.find((e) => e[0] === 'event' && e[1] === 'scroll')[2]
          .percent_scrolled,
        90,
      );
      assert.equal(JSON.stringify(events).includes('private-note-id'), false);
      denied = new BrowserWindow({
        show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true },
      });
      await denied.loadURL('ga4test://untrusted/');
      assert.equal(
        await denied.webContents.executeJavaScript(
          'window.electronGoogleTag.ready()',
        ),
        null,
      );
      assert.equal(
        await denied.webContents.executeJavaScript('typeof window.gtag'),
        'undefined',
      );
      assert.equal(
        await denied.webContents.executeJavaScript(
          `window.electronGoogleTag.send(['event','untrusted_probe']).then(()=>false,()=>true)`,
        ),
        true,
      );
      await main.loadURL('ga4test://desktop/');
      assert.equal(
        await main.webContents.executeJavaScript(
          'window.electronGoogleTag.ready()',
        ),
        id,
      );
      // Then native identity/session persist and only the trusted application initializes.
      assert.deepEqual(await identity(), before);
      console.log(
        'PASS: Main + one preload call, automatic renderer and native Google callbacks, default HTTPS origin, sanitized routes, default scroll, untrusted rejection, reload identity, concurrent-window identity',
      );
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      telemetry?.dispose();
      for (const window of [main, sibling, denied])
        if (window && !window.isDestroyed()) window.destroy();
      app.quit();
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    app.quit();
  });
app.on('will-quit', () => {
  clearTimeout(deadline);
  rmSync(directory, { recursive: true, force: true });
  app.exit(Number(process.exitCode) || 0);
});
