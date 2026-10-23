// Explicit real-Google acceptance; excluded from the offline *.test.cjs suite.
const { app, BrowserWindow, protocol } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createServer } = require('node:http');
const { createGoogleTagTransport } = require('../dist/transport.js');
const id = process.env.GA4_MEASUREMENT_ID;
if (!/^G-[A-Z0-9]+$/i.test(id ?? '')) throw new Error('Set GA4_MEASUREMENT_ID to an approved test stream');
const directory = mkdtempSync(join(tmpdir(), 'electron-ga4-native-'));
app.setPath('userData', join(directory, 'profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'ga4test', privileges: { standard: true, secure: true } }]);
const deadline=setTimeout(()=>{console.error('FAIL: Electron transport acceptance exceeded 90 seconds');app.exit(1)},90000);
app.whenReady().then(async () => {
 let transport, main, downloadServer;
 try {
  // Given the real library runs through a sandboxed custom-protocol renderer and HTTPS collector.
  const preload = join(directory, 'preload.cjs');
  writeFileSync(preload, readFileSync(join(__dirname, '../dist/transport-preload.js'), 'utf8') + '\ninstallGoogleTagPreload();\n');
  transport = createGoogleTagTransport({ measurementId: id, origin: 'https://desktop.example.com', isAllowedSender: sender => Boolean(main && sender === main.webContents) });
  protocol.handle('ga4test', () => new Response('<html><body>Native GA4 acceptance</body></html>', {headers:{'content-type':'text/html'}}));
  main = new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true}});
  await main.loadURL('ga4test://desktop/');
  const sources = Object.fromEntries(['core','links','youtube','enhanced','gtag','desktop'].map(name => [`./${name}`,readFileSync(join(__dirname,`../dist/${name}.js`),'utf8')]));
  await main.webContents.executeJavaScript(`(() => {
   const sources=${JSON.stringify(sources)}, cache={};
   function require(id) { if(cache[id])return cache[id].exports; const module={exports:{}};cache[id]=module;new Function('require','exports','module',sources[id])(require,module.exports,module);return module.exports; }
   window.GA4=require('./desktop');
  })()`);
  const run = code => main.webContents.executeJavaScript(code);
  await run(`window.desktopOptions={measurementId:${JSON.stringify(id)},pageLocation:'https://desktop.example.com/',autoPageViews:false,privacy:'redacted'};window.client=GA4.getDesktopGoogleAnalytics(desktopOptions);client.initialize();`);
  const identity = () => run(`new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Google identity callback timed out')),12000);
   client.gtag('get',${JSON.stringify(id)},'client_id',cid=>client.gtag('get',${JSON.stringify(id)},'session_id',sid=>{clearTimeout(timer);resolve({cid,sid})}));
  })`);
  await transport.ready;
  const before = await identity();
  assert.equal(await run(`GA4.getDesktopGoogleAnalytics(desktopOptions)===client`),true);
  assert.equal(await run(`localStorage.getItem('electron-ga4:'+desktopOptions.measurementId+':client-id')`),before.cid);
  // The quick entry merges measurement defaults even when only privacy is supplied.
  await transport.openExternal(main.webContents,'https://example.com/ga4-sdk-acceptance?private=1');
  const external = await run(`new Promise((resolve,reject)=>{
   const deadline=Date.now()+5000;
   const inspect=()=>{const event=window.dataLayer.map(x=>Array.from(x)).find(x=>x[0]==='event'&&x[1]==='click');if(event)resolve(event);else if(Date.now()>=deadline)reject(new Error('Native external click missing'));else setTimeout(inspect,25)};inspect();
  })`);
  assert.equal(external[2].link_url,'https://example.com');
  downloadServer=createServer((_request,response)=>{response.writeHead(200,{'content-disposition':'attachment; filename=private-report.pdf','content-type':'application/pdf'});response.end('%PDF-1.4 acceptance')});
  await new Promise(resolve=>downloadServer.listen(0,'127.0.0.1',resolve));
  const downloaded=new Promise((resolve,reject)=>main.webContents.session.once('will-download',(_event,item)=>{
   item.setSavePath(join(directory,'download.pdf'));
   item.once('done',(_event,state)=>state==='completed'?resolve():reject(new Error('Download '+state)));
  }));
  main.webContents.downloadURL('http://127.0.0.1:'+downloadServer.address().port+'/download?private=1');
  await downloaded;
  const download=await run(`new Promise((resolve,reject)=>{
   const deadline=Date.now()+5000;
   const inspect=()=>{const event=window.dataLayer.map(x=>Array.from(x)).find(x=>x[0]==='event'&&x[1]==='file_download');if(event)resolve(event);else if(Date.now()>=deadline)reject(new Error('Native download missing'));else setTimeout(inspect,25)};inspect();
  })`);
  assert.equal(download[2].file_extension,'pdf');
  assert.equal(download[2].file_name,undefined);
  assert.equal(download[2].link_url,undefined);
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
  await run(`client.destroy();window.client=GA4.getDesktopGoogleAnalytics(desktopOptions);client.initialize()`);
  assert.deepEqual(await identity(),before);
  console.log('PASS: desktop quick entry, persisted identity, singleton, native redacted external click, pause/resume, blocked paused traffic, default nested scroll/download');
 } catch (error) { console.error(error); process.exitCode=1; }
 finally {downloadServer?.close();transport?.dispose();if(main&&!main.isDestroyed())main.destroy();app.quit();}
}).catch(error=>{console.error(error);process.exitCode=1;app.quit()});
app.on('will-quit',()=>{clearTimeout(deadline);rmSync(directory,{recursive:true,force:true});app.exit(Number(process.exitCode)||0)});
