# Changelog

## Unreleased

- Update development dependencies to Electron 45, TypeScript 7 and happy-dom 21, retain Node 22 types and Electron >=38 peer compatibility, and migrate the compiler to Node16 module resolution.

- Persist automatic installation identity atomically in Main, migrate existing renderer IDs, and retain one identity across stale/blocked storage, sibling windows and application restarts.
- Recover the collector renderer after crashes with bounded backoff, restoring consent/configuration without replaying business events or extra page views; expose non-fatal errors and operational diagnostics.
- Add real offline Electron acceptance for an actual collector crash and full-process restart with a different first window.

- Coordinate automatic anonymous identity across concurrently starting windows and retain verified renderer identity updates in Main.

- Add automatic Main + Preload setup with a packaged browser runtime; no renderer initialization or host-side DOM adapters required.
- Add trusted-frame initialization handshake, ready-client retrieval and serializable route/window policies while retaining manual APIs.
- Verify automatic collection under strict CSP, native Google callbacks, untrusted-window rejection and reload identity in real sandboxed Electron.

- Add `/desktop` quick setup with a per-window/stream singleton, lazy anonymous identity persistence, legacy storage-key migration and merged enhanced-measurement defaults.
- Add `transport.openExternal()` and automatic transport teardown on app exit; observe trusted-window downloads by default with an explicit opt-out.
- Keep low-level `/gtag` defaults and application-owned consent, advertising and business policies intact.

- Add trusted-window native browser-open/download adapters, response filenames and DOM/native deduplication without exposing local save paths.
- Complete standard form metadata and HTML5 playback lifecycle; add an optional official YouTube iframe API adapter.
- Synchronize collector visibility with system suspend/resume and screen lock/unlock.
- Record real Viora/Electron collection and GA4 Realtime acceptance; keep YouTube anti-bot playback blocking explicit.

- Preserve native GA4 consent and advertising defaults, event-name case, explicit destinations and nested ecommerce data.
- Separate SDK pause/resume from consent and retain the initialized Electron tag and native session.
- Add native bridge search/form/link/download metadata and inner-pane scroll; keep redaction explicit and retain the legacy renderer policy.
- Allow explicit validated HTTPS collection origins without relaxing the default CSP allowlist.
- Add focused native/DOM regression tests and an opt-in real Electron/Google acceptance script.

## 0.3.0

- Package the v0.3 starter as a pinned GitHub dependency with compiled exports and CI.
- Preserve native gtag commands and callbacks alongside v0.3 desktop, recommended-event and ecommerce APIs.
- Add an isolated HTTPS transport for custom-protocol Electron apps, persistent native cookies and trusted-window foreground state.
- Adapt application routes, document scroll and approved DOM interactions without migrating application storage.
- Use the official Arguments command queue and expose explicit analytics disable controls.
