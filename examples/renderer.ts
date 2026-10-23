import { ElectronGA4Telemetry } from 'electron-ga4-telemetry/renderer';

// Instantiate once, outside React component rendering.
export const telemetry = new ElectronGA4Telemetry({
  measurementId: 'G-XXXXXXXXXX',
  virtualPageOrigin: 'https://desktop.yourdomain.com',
  enabled: false, // Read the user's persisted opt-in setting.
  autoPageViews: true,
  routeMode: 'history', // HashRouter apps set 'hash'.
  autoClicks: true,
  autoScroll: true,
  collectWebVitals: true,
  mapRoute(path) {
    if (path === '/') return 'home';
    if (path === '/downloads') return 'downloads';
    if (/^\/videos\/[^/]+$/.test(path)) return 'videos/detail';
    if (path.startsWith('/settings')) return 'settings';
    return 'other';
  },
});

void telemetry.init();

// Your application code:
// telemetry.feature('video_download');
// telemetry.download('started', 'mp4');
// telemetry.download('completed', 'mp4', 2400);
// telemetry.signUp('email'); // after successful signup; mark as GA4 Key event if desired.
// telemetry.purchase({transaction_id:'order_123', currency:'USD', value:19.99, items:[{item_id:'pro',item_name:'Pro Plan',quantity:1,price:19.99}]});
// console.table(await telemetry.diagnostics()); // inspect GA4 session/client ID presence
// telemetry.captureAttribution('myapp://open?utm_source=github&utm_medium=release');
// await telemetry.setEnabled(true);  // After the user opts in, persist preference in your app.
// await telemetry.setEnabled(false); // Immediately stop new measurement calls.
