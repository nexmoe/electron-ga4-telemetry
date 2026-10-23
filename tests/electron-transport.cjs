// Explicit real-Google acceptance; excluded from the offline *.test.cjs suite.
const { app, BrowserWindow, protocol } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createGoogleTagTransport } = require('../dist/transport.js');
const id = process.env.GA4_MEASUREMENT_ID;
if (!/^G-[A-Z0-9]+$/i.test(id ?? '')) throw new Error('Set GA4_MEASUREMENT_ID to an approved test stream');
const directory = mkdtempSync(join(tmpdir(), 'electron-ga4-native-'));
app.setPath('userData', join(directory, 'profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'ga4test', privileges: { standard: true, secure: true } }]);
app.whenReady().then(async () => {
 let transport, main;
 try {
  // Given the real library runs through a sandboxed custom-protocol renderer and HTTPS collector.
  const preload = join(directory, 'preload.cjs');
  writeFileSync(preload, readFileSync(join(__dirname, '../dist/transport-preload.js'), 'utf8') + '\ninstallGoogleTagPreload();\n');
  transport = createGoogleTagTransport({ measurementId: id, origin: 'https://desktop.example.com', isAllowedSender: sender => Boolean(main && sender === main.webContents) });
  protocol.handle('ga4test', () => new Response('<html><body>Native GA4 acceptance</body></html>', {headers:{'content-type':'text/html'}}));
  main = new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true}});
  await main.loadURL('ga4test://desktop/');
  const sources = Object.fromEntries(['core','links','youtube','enhanced','gtag'].map(name => [`./${name}`,readFileSync(join(__dirname,`../dist/${name}.js`),'utf8')]));
  await main.webContents.executeJavaScript(`(() => {
   const sources=${JSON.stringify(sources)}, cache={};
   function require(id) { if(cache[id])return cache[id].exports; const module={exports:{}};cache[id]=module;new Function('require','exports','module',sources[id])(require,module.exports,module);return module.exports; }
   window.GA4=require('./gtag');
  })()`);
  const run = code => main.webContents.executeJavaScript(code);
  await run(`window.client=new GA4.GoogleAnalyticsClient({measurementId:${JSON.stringify(id)},enabled:true,pageLocation:'https://desktop.example.com/',autoPageViews:false,enhancedMeasurement:{scroll:true,scrollContainers:true}});client.initialize();`);
  const identity = () => run(`new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Google identity callback timed out')),12000);
   client.gtag('get',${JSON.stringify(id)},'client_id',cid=>client.gtag('get',${JSON.stringify(id)},'session_id',sid=>{clearTimeout(timer);resolve({cid,sid})}));
  })`);
  const before = await identity();
  // When a real pane scrolls and the application pauses then resumes collection.
  const scroll = await run(`(() => {const pane=document.createElement('div');pane.style.cssText='height:100px;overflow:auto';pane.innerHTML='<div style="height:1000px">Content</div>';document.body.append(pane);pane.scrollTop=900;pane.dispatchEvent(new Event('scroll'));return Array.from(window.dataLayer).map(x=>Array.from(x)).find(x=>x[0]==='event'&&x[1]==='scroll')})()`);
  await run(`client.setEnabled(false);client.track('desktop_disabled_probe');`);
  await run(`window.electronGoogleTag.send(['set',{}])`);
  const paused = await transport.collector.webContents.executeJavaScript(`fetch('https://www.google-analytics.com/g/collect?pause_probe=1',{mode:'no-cors'}).then(()=>false,()=>true)`);
  await run(`client.setEnabled(true);`);
  const after = await identity();
  // Then native identity/session survive, a real nested scroll is measured, and paused traffic is blocked.
  assert.match(before.cid,/^\d+\.\d+$/);
  assert.ok(Number(before.sid)>0);
  assert.deepEqual(after,before);
  assert.equal(scroll?.[2].percent_scrolled,90);
  assert.equal(paused,true);
  assert.equal(await run(`Array.from(window.dataLayer).some(x=>x[0]==='event'&&x[1]==='desktop_disabled_probe')`),false);
  console.log('PASS: native client/session callbacks, pause/resume, blocked paused traffic, nested scroll');
 } catch (error) { console.error(error); process.exitCode=1; }
 finally {transport?.dispose();if(main&&!main.isDestroyed())main.destroy();app.quit();}
}).catch(error=>{console.error(error);process.exitCode=1;app.quit()});
app.on('will-quit',()=>{rmSync(directory,{recursive:true,force:true});app.exit(Number(process.exitCode)||0)});
