# Electron GA4 Telemetry

Google's official **gtag.js**, plus an Electron transport and optional desktop instrumentation. Based on the v0.3 starter. Uses a GA4 Web stream; no Measurement Protocol API secret is needed.

## Install

```bash
pnpm add github:nexmoe/electron-ga4-telemetry#v0.3.0
```

Compiled CommonJS and TypeScript declarations are included. Pin a tag or commit. Electron is an optional peer; browser-only consumers can import `/gtag` without loading Electron.

## Electron applications using custom protocols

The official tag currently aborts GA4 collection on documents outside HTTP/HTTPS. A virtual `page_location` does not change this. Run the unmodified tag on a dedicated, locally served HTTPS page while your application keeps its own origin and storage.

```ts
// Main, after app.whenReady(), when analytics is enabled:
import { createGoogleTagTransport } from 'electron-ga4-telemetry/transport';
const transport = createGoogleTagTransport({
  measurementId: 'G-XXXXXXXXXX',
  origin: 'https://desktop.example.com', // an origin you control; its page is served locally
  isAllowedSender: sender => trustedApplicationWebContents.has(sender.id),
});
app.once('will-quit', transport.dispose);

// Add to your existing preload. Bundle this entry when using sandboxed preload.
import { installGoogleTagPreload } from 'electron-ga4-telemetry/transport-preload';
installGoogleTagPreload();

// Renderer: keep your existing identity, consent, event names and application policy.
import { GoogleAnalyticsClient } from 'electron-ga4-telemetry/gtag';
const analytics = new GoogleAnalyticsClient({
  measurementId: 'G-XXXXXXXXXX',
  clientId: existingAnonymousClientId, // optional; numeric.numeric
  pageLocation: 'https://desktop.example.com/',
  pageTitle: 'Desktop',
  enabled: analyticsConsent,
});
analytics.initialize();
analytics.track('tutorial_complete');
analytics.gtag('get', 'G-XXXXXXXXXX', 'session_id', console.log);
analytics.gtag('event', 'purchase', {
  transaction_id: 'public_order_id', currency: 'USD', value: 10,
  items: [{ item_id: 'pro', item_name: 'Pro plan', price: 10, quantity: 1 }],
});
analytics.setClientId(verifiedWebClientId); // optional browser-to-app handoff
analytics.setEnabled(false);
```

`gtag(...args)` forwards the native `config`, `set`, `get`, `event`, `consent` and `js` commands, nested parameters and callbacks. `config` accepts official tag settings. Native GA4 first-visit, session and engagement processing stays in Google's script. The native client does not inject consent or advertising-signal settings. Pass `consent` and official `config` values when the application wants to own those policies. SDK pause/resume does not grant or withdraw consent; use native consent commands for that.

The transport uses its own persistent Electron session. Only allowlisted main frames may issue commands; the collector has no Node access or application preload. Foreground visibility follows trusted application windows rather than the invisible collector, and becomes hidden during system suspend or screen lock. Dispose the transport before app shutdown.

## Automatic events and boundaries

- Official initial `page_view` defaults on. Set `sendPageView: false` to manage it yourself.
- In bridge mode, History changes send sanitized virtual page views. `autoPageViews: false` disables this. Supply `mapRoute` to define static screen names.
- Bridge mode observes 90% document and inner-pane scroll, outbound anchors, downloads, forms, HTML5 video and URL-based site search. Native mode preserves full link/download metadata and detects ordinary forms without special markers. Set `enhancedMeasurement: { privacy: "redacted", ... }` for origin-only URLs, marked forms/videos and no inferred search terms; the legacy `/renderer` privacy policy retains that behavior. Set individual measurement flags or `enhancedMeasurement: false` to control adapters. These application-DOM adapter flags do not automatically synchronize with GA4 Admin enhanced-measurement switches.
- Site search reads only configured URL query parameters (`q`, `s`, `search`, `query`, `keyword` by default), never arbitrary app input. Redacted mode and the v0.3 API require explicit approved search events. Enable `youtubeVideo` for JS API-enabled YouTube embeds. The adapter uses the official iframe API; the host must allow its scripts/frames in CSP and provide a valid HTTP referrer. In redacted mode, embeds also require `data-ga4-video`. Third-party sign-in or playback restrictions are not bypassed.
- On an ordinary HTTP/HTTPS page without the preload bridge, the official tag runs directly and its stream's enhanced measurement settings apply.

The native command API preserves GA4 command/configuration capabilities, including case-sensitive event names, explicit `send_to` destinations and ecommerce `items[]`. `additionalAllowedOrigins` explicitly allows clean HTTPS first-party collection origins without removing the transport CSP allowlist. Desktop DOM adapters are explicit application policy and do not promise identical automatic collection for every website/OS integration. Do not install another collector for the same stream in the same renderer document.

## Native browser opens and downloads

Enable `nativeDownloads: true` on the main transport and `nativeDownloads: true, fileDownloads: true` in the renderer's enhanced measurement options. The transport observes real `will-download` events only for trusted app windows. Server-provided filenames support extensionless download URLs; local save paths are never sent. `file_download` measures initiation, not successful completion.

After a successful OS browser open, notify the transport using the originating WebContents:

```ts
await shell.openExternal(url);
transport.recordExternalOpen(sourceWindow.webContents, url);
```

The preload relays these notifications to the renderer, so its current page metadata and privacy policy apply. Only HTTP/HTTPS URLs without credentials are accepted. Matching DOM/native link notifications within 1.5 seconds are coalesced to avoid counting the same action twice. This does not intercept or replace Electron's `shell` implementation. Multiple renderer windows share one collector; configure `sendPageView: false, autoPageViews: false` on auxiliary windows.

## Optional v0.3 desktop instrumentation

`/main`, `/preload` and `/renderer` retain the v0.3 API: anonymous installation profile, native window events, crash reporting, usage time, resource samples, route maps, recommended events, ecommerce helpers and diagnostics. Install the native bridge on **one primary window** as described in [the Chinese guide](README.zh-CN.md). The HTTPS transport preload can coexist with that bridge.

`ElectronGA4Telemetry.track()` applies the v0.3 privacy policy; `ElectronGA4Telemetry.gtag()` exposes the full native command path when explicitly needed. Custom `desktop_*` metrics supplement native GA4 metrics. They do not replace `session_start`, `first_visit` or `user_engagement`.

See [native Web presets](docs/GA4-WEB-PRESETS.md), [dashboard setup](docs/GA4-DASHBOARD.md) and [validation](docs/VALIDATION.md).

## Development

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --ignore-scripts
pnpm run check
pnpm test
pnpm pack
# Explicit real-Google acceptance (requires a locally installed Electron binary):
GA4_MEASUREMENT_ID=G-XXXXXXXXXX pnpm exec electron tests/electron-transport.cjs
# Optional real YouTube playback; exit 2 means sign-in/playback blocked, not passed:
GA4_MEASUREMENT_ID=G-XXXXXXXXXX pnpm exec electron tests/electron-youtube.cjs
GA4_MEASUREMENT_ID=G-XXXXXXXXXX pnpm exec electron tests/electron-consent.cjs
```

Tests cover the public queue protocol, consent, identity, ecommerce, privacy and desktop adapters. Real Electron network validation is also required: cookie/session state and outgoing payloads do not prove Google has processed the event in reports. The 2026-10-23 Viora acceptance confirmed standard events in GA4 Realtime, including native `first_visit`, `session_start` and `user_engagement`; see [validation](docs/VALIDATION.md). Standard reports, attribution and retention still require separate acceptance.

MIT licensed.
