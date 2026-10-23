import { app, BrowserWindow, protocol } from 'electron';
import { join } from 'node:path';
import { installMainTelemetry } from 'electron-ga4-telemetry/main';

// OPTIONAL: register a secure, standard custom scheme before ready.
// This does not register its handler. Provide a handler via protocol.handle/your build tool.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Replace with your actual user settings. The Renderer MUST read the same opt-in value.
const analyticsConsent = false;

// macOS can dispatch open-url before app.whenReady(). Store the initial URL.
let initialDeepLink: string | undefined;
let captureLiveLink: ((url: string) => boolean) | undefined;
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (captureLiveLink) captureLiveLink(url);
  else initialDeepLink = url;
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const telemetry = installMainTelemetry(win, {
    enabled: analyticsConsent,
    channel: 'stable',
    sampleResources: true,
    resourceIntervalMs: 300_000,
    // Set initialCampaign only when this launch actually has valid campaign parameters.
    initialCampaign: initialDeepLink,
  });
  win.on('closed', telemetry.dispose);
  captureLiveLink = telemetry.captureAttribution;
  // Use your working Vite/React/Next development server or a registered app:// handler.
  await win.loadURL('http://localhost:5173');
  telemetry.track('update_check', { update_available: false });

  // For Windows/Linux second-instance URLs, call telemetry.captureAttribution(url).
});
