# Changelog

## Unreleased

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
