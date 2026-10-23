"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGoogleTagTransport = createGoogleTagTransport;
const electron_1 = require("electron");
const COMMAND = 'electron-ga4:command';
const CALLBACK_MARKER = '__electron_ga4_callback__';
/**
 * Run the unmodified official tag on HTTPS, independently of the app's custom protocol.
 * The application keeps its existing origin, storage and security settings.
 */
function createGoogleTagTransport(options) {
    if (!electron_1.app.isReady())
        throw new Error('Call createGoogleTagTransport after app.whenReady()');
    if (!/^G-[A-Z0-9]+$/i.test(options.measurementId))
        throw new Error('Invalid GA4 measurementId');
    const origin = new URL(options.origin);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' ||
        origin.search || origin.hash)
        throw new Error('A clean HTTPS origin is required');
    const additionalOrigins = (options.additionalAllowedOrigins ?? []).map(value => {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
            throw new Error('Additional collection endpoints must be clean HTTPS origins');
        return url.origin;
    }).join(' ');
    const id = options.measurementId.toUpperCase();
    const partition = options.partition ?? `persist:electron-ga4-${id}`;
    if (!partition.startsWith('persist:'))
        throw new Error('The Google tag session must persist');
    const collectorSession = electron_1.session.fromPartition(partition);
    let disposed = false;
    let collectionEnabled = true;
    let suspended = false;
    let locked = false;
    const html = `<!doctype html><meta charset="utf-8"><title>Electron GA4 transport</title>
<style>html,body{margin:0;min-height:200vh}</style>
<script>
let foreground = false;
Object.defineProperty(document, 'visibilityState', { get: () => foreground ? 'visible' : 'hidden' });
Object.defineProperty(document, 'hidden', { get: () => !foreground });
document.hasFocus = () => foreground;
window.__electronGa4SetForeground = (next) => {
  if (foreground === next) return;
  foreground = next;
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event(next ? 'focus' : 'blur'));
};
window.dataLayer = window.dataLayer || [];
window.gtag = function gtag(){window.dataLayer.push(arguments);};
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>`;
    collectorSession.protocol.handle('https', (request) => {
        if (new URL(request.url).origin === origin.origin) {
            return new Response(html, { headers: {
                    'content-type': 'text/html; charset=utf-8',
                    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://www.googletagmanager.com; connect-src https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com ${additionalOrigins}; img-src https://*.google-analytics.com ${additionalOrigins}; base-uri 'none'; form-action 'none'`,
                } });
        }
        // Suspend delivery, keeping Google's initialized tag, cookies and consent intact.
        if (!collectionEnabled && !(new URL(request.url).hostname === 'www.googletagmanager.com' && new URL(request.url).pathname.startsWith('/gtag/')))
            return Response.error();
        return collectorSession.fetch(request, { bypassCustomProtocolHandlers: true });
    });
    const collector = new electron_1.BrowserWindow({
        show: false,
        webPreferences: {
            session: collectorSession, contextIsolation: true, nodeIntegration: false,
            sandbox: true, backgroundThrottling: false,
        },
    });
    collector.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    collector.webContents.on('will-navigate', (event, url) => {
        if (new URL(url).origin !== origin.origin)
            event.preventDefault();
    });
    const ready = collector.loadURL(`${origin.origin}/`);
    // A network/CSP failure must not become an unhandled rejection in the host app.
    void ready.catch(() => undefined);
    let foregroundGeneration = 0;
    const observedWindows = new Map();
    async function updateForeground() {
        const generation = ++foregroundGeneration;
        if (disposed)
            return;
        try {
            await ready;
            if (disposed || generation !== foregroundGeneration)
                return;
            const focused = electron_1.BrowserWindow.getFocusedWindow();
            const active = Boolean(collectionEnabled && !suspended && !locked && focused && !focused.isDestroyed() && focused.isVisible() &&
                focused.isFocused() && !focused.isMinimized() && options.isAllowedSender(focused.webContents));
            await collector.webContents.executeJavaScript(`window.__electronGa4SetForeground(${active})`);
        }
        catch { /* Analytics must not affect the app lifecycle. */ }
    }
    /** Preserve Electron's open behavior; emit telemetry only after the OS accepts the request. */
    async function openExternal(sender, url, openOptions) {
        await electron_1.shell.openExternal(url, openOptions);
        recordExternalOpen(sender, url);
    }
    function recordExternalOpen(sender, url) {
        try {
            if (disposed || !collectionEnabled || sender.isDestroyed() || !options.isAllowedSender(sender))
                return;
            const target = new URL(url);
            if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
                return;
            sender.send('electron-ga4:native-event', { type: 'click', url: target.href });
        }
        catch { /* OS settings schemes and invalid URLs are not outbound web clicks. */ }
    }
    const observedSessions = new Map();
    function observeDownloads(sender) {
        if (options.nativeDownloads === false || observedSessions.has(sender.session))
            return;
        const sourceSession = sender.session;
        const download = (_event, item, source) => {
            try {
                if (disposed || !collectionEnabled || !source || source.isDestroyed() || !options.isAllowedSender(source))
                    return;
                source.send('electron-ga4:native-event', { type: 'download', url: item.getURLChain()[0] ?? item.getURL(), filename: item.getFilename() });
            }
            catch { /* A closing renderer must not affect the download itself. */ }
        };
        sourceSession.on('will-download', download);
        observedSessions.set(sourceSession, () => sourceSession.removeListener('will-download', download));
    }
    const onSuspend = () => { suspended = true; void updateForeground(); };
    const onResume = () => { suspended = false; void updateForeground(); };
    const onLock = () => { locked = true; void updateForeground(); };
    const onUnlock = () => { locked = false; void updateForeground(); };
    electron_1.powerMonitor.on('suspend', onSuspend);
    electron_1.powerMonitor.on('resume', onResume);
    electron_1.powerMonitor.on('lock-screen', onLock);
    electron_1.powerMonitor.on('unlock-screen', onUnlock);
    function observeWindow(_event, window) {
        if (window === collector || observedWindows.has(window))
            return;
        observeDownloads(window.webContents);
        const onChange = () => {
            if (window.isDestroyed()) {
                observedWindows.delete(window);
            }
            void updateForeground();
        };
        window.on('show', onChange);
        window.on('hide', onChange);
        window.on('minimize', onChange);
        window.on('restore', onChange);
        window.on('closed', onChange);
        observedWindows.set(window, () => {
            window.removeListener('show', onChange);
            window.removeListener('hide', onChange);
            window.removeListener('minimize', onChange);
            window.removeListener('restore', onChange);
            window.removeListener('closed', onChange);
        });
    }
    electron_1.app.on('browser-window-created', observeWindow);
    electron_1.app.on('browser-window-focus', updateForeground);
    electron_1.app.on('browser-window-blur', updateForeground);
    for (const window of electron_1.BrowserWindow.getAllWindows())
        observeWindow(undefined, window);
    void updateForeground();
    const onCommand = async (event, args) => {
        if (disposed || !options.isAllowedSender(event.sender) ||
            event.senderFrame !== event.sender.mainFrame)
            throw new Error('Unauthorized Google tag request');
        if (!Array.isArray(args) || args.length > 10 || typeof args[0] !== 'string' ||
            !['config', 'set', 'get', 'event', 'consent', 'js', '__electron_ga4_enabled'].includes(args[0])) {
            throw new Error('Invalid Google tag command');
        }
        if (args[0] === '__electron_ga4_enabled') {
            collectionEnabled = args[1] === true;
            void updateForeground();
            return null;
        }
        if (!collectionEnabled && args[0] === 'event')
            return null;
        const serialized = JSON.stringify(args);
        if (serialized.length > 256_000)
            throw new Error('Google tag command too large');
        await ready;
        if (disposed)
            throw new Error('Google tag transport disposed');
        return collector.webContents.executeJavaScript(`(() => {
      const args = ${serialized};
      let callbackPresent = false;
      let finish;
      const response = new Promise(resolve => { finish = resolve; });
      const revive = value => {
        if (!value || typeof value !== 'object') return value;
        if (Object.keys(value).length === 1 && Number.isInteger(value.${CALLBACK_MARKER})) {
          callbackPresent = true;
          const index = value.${CALLBACK_MARKER};
          return (...values) => finish({ index, values });
        }
        for (const key of Object.keys(value)) value[key] = revive(value[key]);
        return value;
      };
      revive(args);
      if (args[0] === 'js' && typeof args[1] === 'string') args[1] = new Date(args[1]);
      window.gtag(...args);
      if (!callbackPresent) return null;
      const timer = setTimeout(() => finish(null), 10000);
      return response.finally(() => clearTimeout(timer));
    })()`);
    };
    electron_1.ipcMain.handle(COMMAND, onCommand);
    electron_1.app.once('will-quit', dispose);
    function dispose() {
        if (disposed)
            return;
        disposed = true;
        electron_1.app.removeListener('will-quit', dispose);
        electron_1.ipcMain.removeHandler(COMMAND);
        electron_1.app.removeListener('browser-window-created', observeWindow);
        for (const remove of observedWindows.values())
            remove();
        observedWindows.clear();
        for (const remove of observedSessions.values())
            remove();
        observedSessions.clear();
        electron_1.powerMonitor.removeListener('suspend', onSuspend);
        electron_1.powerMonitor.removeListener('resume', onResume);
        electron_1.powerMonitor.removeListener('lock-screen', onLock);
        electron_1.powerMonitor.removeListener('unlock-screen', onUnlock);
        electron_1.app.removeListener('browser-window-focus', updateForeground);
        electron_1.app.removeListener('browser-window-blur', updateForeground);
        if (!collector.isDestroyed())
            collector.destroy();
        collectorSession.protocol.unhandle('https');
    }
    return { ready, dispose, collector, recordExternalOpen, openExternal };
}
