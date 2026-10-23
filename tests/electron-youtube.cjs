// Opt-in real YouTube + Google acceptance. No player or media events are mocked.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createGoogleTagTransport } = require('../dist/transport.js');
const id = process.env.GA4_MEASUREMENT_ID;
const videoId = process.env.YOUTUBE_VIDEO_ID ?? 'M7lc1UVf-VE';
if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
  console.error('Invalid YouTube video ID');
  app.exit(1);
}
if (!/^G-[A-Z0-9]+$/.test(id || '')) {
  console.error('Set GA4_MEASUREMENT_ID to an approved stream');
  app.exit(1);
}
const directory = mkdtempSync(join(tmpdir(), 'ga4-youtube-'));
app.setPath('userData', join(directory, 'profile'));
setTimeout(() => {
  console.error('YouTube acceptance exceeded 90 seconds');
  app.exit(1);
}, 90000).unref();
app
  .whenReady()
  .then(async () => {
    let main, transport;
    try {
      // Given an actual HTTPS Electron page, real iframe API and approved GA4 stream.
      const preload = join(directory, 'preload.cjs');
      writeFileSync(
        preload,
        readFileSync(join(__dirname, '../dist/transport-preload.js'), 'utf8') +
          '\ninstallGoogleTagPreload();',
      );
      transport = createGoogleTagTransport({
        measurementId: id,
        origin: 'https://collector.example.com',
        isAllowedSender: (s) => Boolean(main && s === main.webContents),
      });
      const { createServer } = require('node:http');
      const server = createServer((_request, response) => {
        response.writeHead(200, {
          'content-type': 'text/html',
          'referrer-policy': 'strict-origin-when-cross-origin',
        });
        response.end(
          `<html><body><iframe id="ga4-youtube" width="480" height="270" allow="autoplay; encrypted-media" title="YouTube API demo" src="https://www.youtube.com/embed/${videoId}?enablejsapi=1&origin=${encodeURIComponent(origin)}&mute=1"></iframe></body></html>`,
        );
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const origin = 'http://127.0.0.1:' + server.address().port;
      app.once('will-quit', () => server.close());
      main = new BrowserWindow({
        show: true,
        webPreferences: { preload, sandbox: true, contextIsolation: true },
      });
      main.webContents.on('console-message', (event) => {
        if (
          event.message &&
          !event.message.includes('Electron Security Warning')
        )
          console.error('renderer:', event.message);
      });
      await main.loadURL(origin);
      const sources = Object.fromEntries(
        ['core', 'links', 'youtube', 'enhanced', 'gtag'].map((name) => [
          './' + name,
          readFileSync(join(__dirname, '../dist/' + name + '.js'), 'utf8'),
        ]),
      );
      const initialization = await main.webContents.executeJavaScript(
        `(()=>{try{const sources=${JSON.stringify(sources)},cache={};function require(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;new Function('require','exports','module',sources[id])(require,module.exports,module);return module.exports;}window.client=new (require('./gtag').GoogleAnalyticsClient)({measurementId:${JSON.stringify(id)},enabled:true,pageLocation:${JSON.stringify(origin)},autoPageViews:false,enhancedMeasurement:{youtubeVideo:true},config:{debug_mode:true,validation_run:'youtube_adapter_20261023'}});client.initialize();}catch(error){console.error(String(error)+' '+error.stack);return {error:String(error),stack:error.stack};}})()`,
      );
      if (initialization?.error) throw Error(JSON.stringify(initialization));
      async function until(expression, timeout = 30000) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
          if (await main.webContents.executeJavaScript(expression)) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw Error('Timed out: ' + expression);
      }
      await until(
        'Boolean(window.YT?.get?.("ga4-youtube") && Number.isFinite(window.YT.get("ga4-youtube").getPlayerState?.()))',
        45000,
      );
      const videoFrame = main.webContents.mainFrame.frames.find((frame) =>
        frame.url.startsWith('https://www.youtube.com/embed/'),
      );
      assert.ok(videoFrame, 'Real YouTube iframe loaded');
      // When the user plays the actual embedded media and seeks through its timeline.
      await main.webContents.executeJavaScript(
        'window.YT.get("ga4-youtube").mute();window.YT.get("ga4-youtube").playVideo();true',
        true,
      );
      console.log(
        'Play requested',
        await main.webContents.executeJavaScript(
          '({state:window.YT.get("ga4-youtube").getPlayerState(),listeners:Object.keys(window).filter(k=>k.startsWith("__electronGa4YouTube"))})',
        ),
      );
      await until('Array.from(dataLayer).some(c=>c[1]==="video_start")');
      console.log('Real YouTube playback started');
      await videoFrame.executeJavaScript(
        'document.querySelector("video").currentTime=document.querySelector("video").duration*.8',
      );
      await until(
        'Array.from(dataLayer).some(c=>c[1]==="video_progress"&&c[2].video_percent===75)',
      );
      await videoFrame.executeJavaScript(
        'document.querySelector("video").currentTime=document.querySelector("video").duration-1',
      );
      await until('Array.from(dataLayer).some(c=>c[1]==="video_complete")');
      // Then standard GA4 events identify the real YouTube playback and native thresholds.
      const events = await main.webContents.executeJavaScript(
        'Array.from(dataLayer).filter(c=>String(c[1]).startsWith("video_")).map(c=>({name:c[1],params:c[2]}))',
      );
      assert.equal(
        events.find((e) => e.name === 'video_start').params.video_provider,
        'youtube',
      );
      assert.deepEqual(
        events
          .filter((e) => e.name === 'video_progress')
          .map((e) => e.params.video_percent),
        [10, 25, 50, 75],
      );
      assert.equal(
        events.find((e) => e.name === 'video_complete').params.video_percent,
        100,
      );
      console.log(JSON.stringify({ status: 'PASS', events }, null, 2));
    } catch (error) {
      console.error(error);
      if (main) {
        console.error(
          await main.webContents.executeJavaScript(
            '({url:location.href,api:!!window.YT,state:window.YT?.get?.("ga4-youtube")?.getPlayerState?.(),duration:window.YT?.get?.("ga4-youtube")?.getDuration?.(),events:Array.from(window.dataLayer||[]).map(c=>[c[0],c[1]])})',
          ),
        );
        const frame = main.webContents.mainFrame.frames.find((frame) =>
          frame.url.startsWith('https://www.youtube.com/embed/'),
        );
        if (frame) {
          const state = await frame.executeJavaScript(
            '({text:document.body.innerText.slice(-1800),media:Array.from(document.querySelectorAll("video")).map(v=>({state:v.readyState,network:v.networkState,error:v.error?.message,paused:v.paused,duration:v.duration,currentTime:v.currentTime}))})',
          );
          console.error(state);
          if (/not a bot|confirm you|Sign in/i.test(state.text)) {
            console.error(
              'BLOCKED: real YouTube playback requires sign-in; adapter is not accepted as passed',
            );
            process.exitCode = 2;
          }
        }
        writeFileSync(
          join(directory, 'window.png'),
          (await main.webContents.capturePage()).toPNG(),
        );
        console.error('Artifacts:', directory);
      }
      process.exitCode ||= 1;
    } finally {
      transport?.dispose();
      if (main && !main.isDestroyed()) main.destroy();
      app.quit();
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    app.quit();
  });

// Electron app.quit does not propagate Node process.exitCode on its own.
app.on('will-quit', () => app.exit(Number(process.exitCode) || 0));
