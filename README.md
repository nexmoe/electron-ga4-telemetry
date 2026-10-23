# Electron GA4 Telemetry

Google's official **gtag.js**, plus an Electron transport and optional desktop instrumentation. Based on the v0.3 starter. Uses a GA4 Web stream; no Measurement Protocol API secret is needed.

## Install

```bash
pnpm add github:nexmoe/electron-ga4-telemetry#v0.3.0
```

Compiled CommonJS and TypeScript declarations are included. Pin a tag or commit. Electron is an optional peer; browser-only consumers can import `/gtag` without loading Electron.

## Automatic Electron setup

Two integration points are sufficient; no renderer import, initialization or DOM adapter code is required:

```ts
// Main, after app.whenReady(), before creating application windows:
import { installGoogleAnalytics } from 'electron-ga4-telemetry/transport';
const analytics = installGoogleAnalytics({
  measurementId: 'G-XXXXXXXXXX',
  appOrigins: ['app://desktop'], // explicitly trusted application documents
});

// Add this to your existing preload and bundle the import for a sandboxed preload:
import { installGoogleTagPreload } from 'electron-ga4-telemetry/transport-preload';
installGoogleTagPreload();
```

The library initializes one renderer client per window/stream, persists anonymous identity, sends the initial PV, and observes sanitized History changes and enhanced DOM events. It runs the unmodified official tag on a locally served HTTPS collector with its own persistent session, while your application's origin and storage stay unchanged. The default collector origin is `https://electron-ga4.invalid`; optionally provide an owned `origin`. No network request is made to that collector page. Native collection traffic still goes to Google.

Only explicitly trusted top-level frames may initialize or send commands. For stricter window policy, supply `isAllowedSender` (combined with `appOrigins` when both are provided). `file://` and other opaque origins are not accepted by `appOrigins`; use an explicit window/URL validator if needed. Initialization executes the packaged static browser runtime in the validated frame; it does not add `unsafe-eval` or weaken the app's CSP. Disposal is automatic on app exit.

The automatic entry enables collection by default and preserves native consent/advertising defaults. Supply `renderer` settings for your application's policy:

```ts
const analytics = installGoogleAnalytics({
  measurementId: 'G-XXXXXXXXXX',
  appOrigins: ['app://desktop'],
  renderer: {
    privacy: 'redacted',
    clientIdStorageKey: 'existing-app-client-id', // optional identity migration
    routes: { '/': 'home', '/notes/new': 'notes/new', '/notes/*': 'notes/editor' },
    consent: { analytics_storage: 'granted', ad_storage: 'denied' },
  },
});
```

`routes` contains fixed screen labels. Exact paths beat trailing `*` patterns, the longest matching prefix wins, and unknown paths are omitted. Alternatively, keep the lower-level renderer API for function-based route mapping. `renderer` may be a function of the trusted sender to choose per-window settings, for example `sendPageView: false, autoPageViews: false` for auxiliary windows; returning `false` skips initialization for that window. `renderer: { enabled: false }` does not create an identity or configure a tag in the page. Initial settings must be JSON-serializable; native callbacks remain available after initialization.

Ordinary events and interactions work without renderer setup. For business events, identity handoff or native commands, wait for the prepared client:

```ts
import { getAutoGoogleAnalytics } from 'electron-ga4-telemetry/desktop';
const analytics = await getAutoGoogleAnalytics(); // null if disabled/unavailable/untrusted
analytics?.track('tutorial_complete');
analytics?.gtag('get', 'G-XXXXXXXXXX', 'session_id', console.log);
analytics?.setClientId(verifiedWebClientId);
```

This waits for Preload/Main initialization, so early business events do not race the initial config. Raw `window.gtag` is also available after `await window.electronGoogleTag.ready()`. An application without automatic setup returns `null` rather than breaking its business flow. Remote frames and third-party pages must never be added to your application's trust policy casually.

## Production identity and recovery

Automatic setup keeps the canonical anonymous ID in Main under `userData/electron-ga4-identities`, using a flushed temporary file and atomic replacement. The first enabled initialization migrates the existing renderer `clientIdStorageKey` if no Main identity exists. Later windows and process restarts use Main's saved ID even if renderer storage is missing, blocked or stale. `setClientId()` persists the verified handoff and synchronizes sibling clients without another page view. Keep `userData`, the collector `partition`, and the identity storage key stable across releases. This assumes one owning Main process, as with Electron's single-instance application model; clearing the application data creates a new installation identity.

`renderer.clientIdStorageKey: false` opts out of Main identity management and leaves identity to Google's persistent collector cookies. Fully manual `/desktop` clients still use their renderer storage; this Main persistence applies to automatic initialization.

If the collector renderer crashes, the transport reloads it in the same persistent session and restores native configuration, global settings and the latest consent state. Recovery forces `send_page_view: false` and never replays events or completed callbacks. Commands dispatched during recovery wait for it; an event already in flight at the crash may be lost. Recovery uses at most three attempts with backoff for consecutive failures; a minute of healthy operation resets that budget. Disposal cancels pending retries. This is process recovery, not offline event storage or guaranteed Google delivery.

For operational visibility, pass `onError(error)` in Main and inspect `analytics.diagnostics()`. Error codes include `IDENTITY_STORAGE_FAILED`, `IDENTITY_SYNC_FAILED`, `COLLECTOR_LOAD_FAILED` and `COLLECTOR_RECOVERY_EXHAUSTED`. Diagnostics return `identityPersistence` (`unused`, `persisted`, `memory`), `collectorStatus` and the total `recoveryAttempts`, without user identifiers. A disk failure retains the current in-memory ID and does not crash the app; it cannot guarantee that ID across a future restart. Collector `ready` status means its local command queue is available, not that Google has processed the events.

## Lower-level integration

Existing `createGoogleTagTransport`, `installGoogleTagPreload` and `GoogleAnalyticsClient` / `getDesktopGoogleAnalytics` remain available. `createGoogleTagTransport` does not automatically initialize renderers unless `renderer` settings are provided. `installGoogleTagPreload({ autoInitialize: false })` disables its initialization request for fully manual integrations.

The `/desktop` factory owns a per-window/stream singleton including module reloads; the first call owns configuration and `destroy()` unregisters it. Anonymous identity is created lazily and stored under `electron-ga4:<MEASUREMENT_ID>:client-id`; use a legacy `clientIdStorageKey` to migrate, or `false` to let Google own identity. Blocked storage falls back to memory. Enhanced defaults merge with individual overrides, so `{ forms: false }` retains other adapters.

The lower-level `/gtag` client keeps its original enabled/identity defaults and forwards native `config`, `set`, `get`, `event`, `consent` and `js`, nested parameters and callbacks. SDK pause/resume does not grant or withdraw native consent. The official tag remains responsible for first-visit, sessions and engagement; no equivalent synthetic events are manufactured.

## Automatic events and boundaries

- Official initial `page_view` defaults on. Set `sendPageView: false` to manage it yourself.
- In bridge mode, History changes send sanitized virtual page views. `autoPageViews: false` disables this. Supply `mapRoute` to define static screen names.
- Bridge mode observes 90% document and inner-pane scroll, outbound anchors, downloads, forms, HTML5 video and URL-based site search. Native mode preserves full link/download metadata and detects ordinary forms without special markers. Set `enhancedMeasurement: { privacy: "redacted", ... }` for origin-only URLs, marked forms/videos and no inferred search terms; the legacy `/renderer` privacy policy retains that behavior. Set individual measurement flags or `enhancedMeasurement: false` to control adapters. These application-DOM adapter flags do not automatically synchronize with GA4 Admin enhanced-measurement switches.
- Site search reads only configured URL query parameters (`q`, `s`, `search`, `query`, `keyword` by default), never arbitrary app input. Redacted mode and the v0.3 API require explicit approved search events. Enable `youtubeVideo` for JS API-enabled YouTube embeds. The adapter uses the official iframe API; the host must allow its scripts/frames in CSP and provide a valid HTTP referrer. In redacted mode, embeds also require `data-ga4-video`. Third-party sign-in or playback restrictions are not bypassed.
- On an ordinary HTTP/HTTPS page without the preload bridge, the official tag runs directly and its stream's enhanced measurement settings apply.

The native command API preserves GA4 command/configuration capabilities, including case-sensitive event names, explicit `send_to` destinations and ecommerce `items[]`. `additionalAllowedOrigins` explicitly allows clean HTTPS first-party collection origins without removing the transport CSP allowlist. Desktop DOM adapters are explicit application policy and do not promise identical automatic collection for every website/OS integration. Do not install another collector for the same stream in the same renderer document.

## Native browser opens and downloads

Native downloads are enabled by default on the transport and `/desktop` entry. Set `nativeDownloads: false` on the transport to opt out. Lower-level renderer clients with custom enhanced options must include `nativeDownloads: true, fileDownloads: true`. The transport observes real `will-download` events only for trusted app windows. Server-provided filenames support extensionless download URLs; local save paths are never sent. `file_download` measures initiation, not successful completion.

Use the transport helper to open the system browser and measure the successful action:

```ts
await transport.openExternal(sourceWindow.webContents, url);
// Existing shell integrations can still call recordExternalOpen(sender, url) after success.
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
# Real Electron persistence/restart/crash acceptance, with all Google requests blocked:
node tests/electron-production.cjs
# Optionally set ELECTRON_BINARY to an existing Electron executable.
# Explicit real-Google acceptance (requires a locally installed Electron binary):
GA4_MEASUREMENT_ID=G-XXXXXXXXXX pnpm exec electron tests/electron-automatic.cjs
GA4_MEASUREMENT_ID=G-XXXXXXXXXX pnpm exec electron tests/electron-transport.cjs
# Optional real YouTube playback; exit 2 means sign-in/playback blocked, not passed:
GA4_MEASUREMENT_ID=G-XXXXXXXXXX pnpm exec electron tests/electron-youtube.cjs
GA4_MEASUREMENT_ID=G-XXXXXXXXXX pnpm exec electron tests/electron-consent.cjs
```

Tests cover the public queue protocol, consent, identity, ecommerce, privacy and desktop adapters. Real Electron network validation is also required: cookie/session state and outgoing payloads do not prove Google has processed the event in reports. The 2026-10-23 Viora acceptance confirmed standard events in GA4 Realtime, including native `first_visit`, `session_start` and `user_engagement`; see [validation](docs/VALIDATION.md). Standard reports, attribution and retention still require separate acceptance.

MIT licensed.
