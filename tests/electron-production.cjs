// Real Electron lifecycle acceptance, completely offline: Google's scripts/requests are blocked.
// This verifies persistence, IPC and an actual renderer crash; it does not verify GA4 ingestion.
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'ga4-production-electron-'));
  try {
    for (const phase of ['migrate', 'restart']) {
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(process.env.ELECTRON_BINARY ?? require('electron'), [__filename, directory, phase], {
        env: environment,
        encoding: 'utf8', timeout: 45000,
      });
      if (result.status !== 0) throw new Error(result.error?.message ??
        `Electron ${phase} exited with status ${result.status}, signal ${result.signal}\n${result.stderr}${result.stdout}`);
      process.stdout.write(result.stdout);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow, protocol, session } = require('electron');
  const { installGoogleAnalytics } = require('../dist/transport.js');
  const directory = process.argv[2];
  const phase = process.argv[3];
  const id = 'G-OFFLINE123';
  const key = `electron-ga4:${id}:client-id`;
  app.setPath('userData', join(directory, 'profile'));
  protocol.registerSchemesAsPrivileged([{ scheme: 'ga4production', privileges: { standard: true, secure: true } }]);
  const deadline = setTimeout(() => { console.error('FAIL: production acceptance timed out'); app.exit(1); }, 35000);
  let transport;
  const windows = [];
  const waitFor = async (condition) => {
    const start = Date.now();
    while (!(await condition())) {
      if (Date.now() - start > 8000) throw new Error('Production acceptance condition timed out');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  app.whenReady().then(async () => {
    try {
      // Block before the collector exists: this test sends nothing to Google.
      session.fromPartition(`persist:electron-ga4-${id}`).webRequest.onBeforeRequest(
        { urls: ['https://*.googletagmanager.com/*', 'https://*.google-analytics.com/*', 'https://*.analytics.google.com/*'] },
        (_details, callback) => callback({ cancel: true }),
      );
      const preload = join(directory, 'preload.cjs');
      writeFileSync(preload, readFileSync(join(__dirname, '../dist/transport-preload.js'), 'utf8') + '\ninstallGoogleTagPreload();');
      protocol.handle('ga4production', request => {
        const legacy = new URL(request.url).hostname === 'desktop' && phase === 'migrate' ? '123.456' : '987.654';
        return new Response(`<!doctype html><title>Production acceptance</title><script>localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(legacy)});</script>`,
          { headers: { 'content-type': 'text/html; charset=utf-8' } });
      });
      transport = installGoogleAnalytics({
        measurementId: id, appOrigins: ['ga4production://desktop', 'ga4production://settings'],
        renderer: { enhancedMeasurement: false, consent: { analytics_storage: 'granted' } },
      });
      for (const host of phase === 'migrate' ? ['desktop', 'settings'] : ['settings', 'desktop']) {
        const win = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true } });
        windows.push(win);
        await win.loadURL(`ga4production://${host}/`);
        assert.equal(await win.webContents.executeJavaScript('window.electronGoogleTag.ready()'), id);
      }
      const expected = phase === 'migrate' ? '123.456' : '321.654';
      for (const win of windows) assert.equal(await win.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(key)})`), expected);
      if (phase === 'migrate') {
        await windows[0].webContents.executeJavaScript(`window[Symbol.for('electron-ga4.desktop.clients')].get(${JSON.stringify(id)}).setClientId('321.654')`);
        await waitFor(async () => await windows[1].webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(key)})`) === '321.654');
        await windows[0].webContents.executeJavaScript(`gtag('consent','update',{analytics_storage:'denied'});gtag('event','purchase',{transaction_id:'once'})`);
        await waitFor(async () => await transport.collector.webContents.executeJavaScript(`Array.from(dataLayer).some(args=>args[0]==='event'&&args[1]==='purchase')`));
        const crashed = new Promise(resolve => transport.collector.webContents.once('render-process-gone', resolve));
        transport.collector.webContents.forcefullyCrashRenderer();
        await crashed;
        await waitFor(() => transport.diagnostics().collectorStatus === 'ready');
        const recovered = await transport.collector.webContents.executeJavaScript('Array.from(dataLayer, args=>Array.from(args))');
        const configuration = recovered.find(args => args[0] === 'config')[2];
        assert.equal(configuration.client_id, '321.654');
        assert.equal(configuration.send_page_view, false);
        assert.equal(recovered.some(args => args[0] === 'event'), false);
        assert.ok(recovered.some(args => args[0] === 'consent' && args[1] === 'update' && args[2].analytics_storage === 'denied'));
        await windows[0].webContents.executeJavaScript(`gtag('event','after_recovery',{})`);
        await waitFor(async () => await transport.collector.webContents.executeJavaScript(`Array.from(dataLayer).some(args=>args[1]==='after_recovery')`));
      }
      assert.equal(transport.diagnostics().identityPersistence, 'persisted');
      console.log(`PASS: real offline Electron ${phase}; durable identity, sibling sync${phase === 'migrate' ? ', actual collector crash and state recovery without event replay' : ', full process restart with stale storage and different first window'}`);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      transport?.dispose();
      for (const win of windows) if (!win.isDestroyed()) win.destroy();
      clearTimeout(deadline);
      app.exit(Number(process.exitCode) || 0);
    }
  }).catch(error => { console.error(error); app.exit(1); });
}
