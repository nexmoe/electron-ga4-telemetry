import { installEnhancedMeasurement } from './enhanced';
import { getOrCreateGoogleTag, loadGoogleTag, setGoogleTagEnabled } from './gtag';
import {
  parseCampaign, routeFromLocation, safeScreen,
  safeToken, toGtagCampaign, VALID_EVENT,
} from './core';
import { cleanGA4WebParams, GTAG_OWNED_EVENTS, type GA4EventParams, type GA4Item } from './ga4-web';
import type { Campaign, TelemetryContext } from './shared';

export interface RendererTelemetryOptions {
  measurementId: string;
  /** An HTTPS origin you control, used only in event page_location values. */
  virtualPageOrigin: string;
  /** Consent preference. Default false. Pass the same value to installMainTelemetry. */
  enabled?: boolean;
  /** Enabled by default; auto instruments pushState, replaceState, popstate, hashchange. */
  autoPageViews?: boolean;
  /** HistoryRouter (default) or HashRouter. */
  routeMode?: 'history' | 'hash';
  /** Turn arbitrary paths into known screen names. Return null to exclude. */
  mapRoute?: (path: string) => string | null;
  /** Opt-in: only elements marked data-ga4-event are counted. */
  autoClicks?: boolean;
  /** Opt-in: scroll % of the document. Not inner scroll containers. */
  autoScroll?: boolean;
  /** Opt-in: first contentful paint, last LCP, approximate navigation timing. */
  collectWebVitals?: boolean;
  /** Seconds are sent in one event on blur, close or this interval; default 5 minutes. */
  usageReportIntervalMs?: number;
  /** Inactivity threshold for counting desktop_active_seconds. Default 60s. */
  inputIdleMs?: number;
  debug?: boolean;
  /** Protect privacy: only transmit free-text search_term with explicit opt-in. */
  allowSearchTerms?: boolean;
  /**
   * Optional GA4 Enhanced Measurement fallback for Electron pages using app:// or
   * file://. ONLY use after switching off the matching Enhanced Measurement
   * options in the GA4 Web stream; otherwise events may be counted twice.
   */
  enhancedFallback?: {
    /** Set true only after disabling the corresponding native enhanced events in GA4. */
    confirmedNativeEnhancedMeasurementDisabled: true;
    scroll?: boolean;
    outboundClicks?: boolean;
    fileDownloads?: boolean;
    forms?: boolean;
    html5Video?: boolean;
  };
}

type Cleanup = () => void;
const DEFAULT_USAGE_INTERVAL = 5 * 60_000;

/** Opt-in, Electron-aware GA4 Web wrapper. No API Secret or Measurement Protocol calls. */
export class ElectronGA4Telemetry {
  private readonly id: string;
  private readonly origin: string;
  private enabled: boolean;
  private context?: TelemetryContext;
  private initPromise?: Promise<void>;
  private tagInitialized = false;
  private tagScriptLoaded = false;
  private lastScreen = '';
  private lastLocation = '';
  private nativeUnsubscribe?: Cleanup;
  private cleanup: Cleanup[] = [];
  private lastErrors = new Map<string, number>();
  private lastNative = new Map<string, number>();
  private deviceReported = false;

  constructor(private readonly options: RendererTelemetryOptions) {
    if (!/^G-[A-Z0-9]+$/i.test(options.measurementId)) {
      throw new Error('measurementId must look like G-XXXXXXXXXX');
    }
    this.id = options.measurementId.toUpperCase();
    const url = new URL(options.virtualPageOrigin);
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      throw new Error('virtualPageOrigin must be a clean HTTPS origin');
    }
    this.origin = url.origin;
    this.enabled = options.enabled === true;
  }

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initialize().catch((error) => {
      this.initPromise = undefined;
      throw error;
    });
    return this.initPromise;
  }

  private async initialize() {
    const bridge = window.electronTelemetry;
    if (!bridge) throw new Error('Call installTelemetryPreload() from the preload entrypoint');
    this.context = await bridge.getContext();
    this.nativeUnsubscribe = bridge.onEvent(({ name, params }) => {
      if (name === 'desktop_attribution') {
        const parsed = parseCampaign(params as Campaign);
        if (parsed) this.applyCampaign(parsed);
      }
      this.track(name, params);
    });
    if (this.enabled) this.activate();
    bridge.ready(this.enabled);
  }

  private initTag() {
    if (!this.context) throw new Error('Missing telemetry context');
    if (this.tagInitialized) {
      setGoogleTagEnabled(this.id, true);
      window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
      return;
    }
    // Custom protocol cookies are not guaranteed. An explicit ID helps device-level deduplication.
    window.gtag = getOrCreateGoogleTag();
    setGoogleTagEnabled(this.id, true);
    window.gtag('consent', 'default', {
      analytics_storage: 'granted', ad_storage: 'denied',
      ad_user_data: 'denied', ad_personalization: 'denied',
    });
    window.gtag('js', new Date());
    window.gtag('config', this.id, {
      send_page_view: false,
      client_id: this.context.clientId,
      cookie_domain: 'none',
      page_location: `${this.origin}/desktop/home`,
      page_title: 'Desktop App',
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      user_properties: {
        desktop_os: this.context.platform,
        app_version: this.context.appVersion,
        cpu_arch: this.context.arch,
        release_channel: this.context.channel,
      },
      ...(this.context.launchCampaign ? toGtagCampaign(this.context.launchCampaign) : {}),
      ...(this.options.debug === true ? { debug_mode: true } : {}),
    });
    loadGoogleTag(this.id, () => { this.tagScriptLoaded = true; });
    this.tagInitialized = true;
  }

  private activate() {
    this.initTag();
    this.watchPages();
    this.watchUsage();
    this.watchErrors();
    if (this.options.autoClicks === true) this.watchClicks();
    if (this.options.autoScroll === true) this.watchScroll();
    if (this.options.collectWebVitals === true) this.watchWebVitals();
    if (this.options.enhancedFallback?.confirmedNativeEnhancedMeasurementDisabled) this.watchEnhancedFallback();
    if (!this.deviceReported) this.reportDevice();
  }

  async setEnabled(allowed: boolean) {
    await this.init();
    if (this.enabled === allowed) return;
    this.enabled = allowed;
    if (allowed) {
      this.activate();
    } else {
      this.cleanupActive();
      this.lastScreen = '';
      this.lastLocation = '';
      // GA4's disable flag protects this measurement ID, even if gtag.js is already loaded.
      if (this.tagInitialized) {
        setGoogleTagEnabled(this.id, false);
        window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
      }
    }
    window.electronTelemetry?.setEnabled(allowed);
  }

  /**
   * Local diagnostics for GA4's automatic sessions. This does not transmit IDs
   * anywhere or manufacture the GA4 session_start/user_engagement events.
   * Run from a renderer DevTools console after gtag.js finishes loading.
   */
  async diagnostics(timeoutMs = 2000): Promise<{
    enabled: boolean;
    protocol: string;
    scriptLoaded: boolean;
    clientIdMatchesProfile: boolean | null;
    sessionIdPresent: boolean;
    sessionNumberPresent: boolean;
  }> {
    await this.init();
    const base = {
      enabled: this.enabled,
      protocol: window.location.protocol ?? 'unknown',
      scriptLoaded: this.tagScriptLoaded,
      clientIdMatchesProfile: null as boolean | null,
      sessionIdPresent: false,
      sessionNumberPresent: false,
    };
    if (!this.enabled || !this.tagInitialized || !window.gtag) return base;
    const get = (field: string): Promise<unknown> => new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve(undefined); }
      }, Math.max(100, Math.min(timeoutMs, 5000)));
      window.gtag?.('get', this.id, field, (value: unknown) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(value); }
      });
    });
    const [client, session, number] = await Promise.all([
      get('client_id'), get('session_id'), get('session_number'),
    ]);
    return {
      ...base,
      clientIdMatchesProfile: typeof client === 'string' ? client === this.context?.clientId : null,
      sessionIdPresent: session !== undefined && session !== null && String(session) !== '',
      sessionNumberPresent: number !== undefined && number !== null && String(number) !== '',
    };
  }

  private cleanupActive() {
    for (const fn of this.cleanup.splice(0)) fn();
  }

  /** Official gtag commands, including callbacks and standard nested payloads. */
  gtag(...args: unknown[]): void {
    if (this.enabled && this.tagInitialized) getOrCreateGoogleTag()(...args);
  }

  /** User-defined events: never send user content, file paths, URLs, emails, IDs or error stacks. */
  track(name: string, params: GA4EventParams = {}) {
    // gtag.js owns these events, and page() manages page_view separately.
    if (!this.enabled || !this.tagInitialized || !VALID_EVENT.test(name) || GTAG_OWNED_EVENTS.has(name)) return;
    if (name.startsWith('window_')) {
      const now = Date.now();
      if (now - (this.lastNative.get(name) ?? 0) < 1000) return;
      this.lastNative.set(name, now);
    }
    const checked = cleanGA4WebParams(params, { allowSearchTerms: this.options.allowSearchTerms });
    // GA4 recommended events rely on required parameters for predefined reports.
    if (name === 'search' && !checked.search_term) return;
    if (name === 'purchase' && (!checked.transaction_id || !checked.currency ||
        typeof checked.value !== 'number' || !Array.isArray(checked.items))) return;
    if (name === 'refund' && !checked.transaction_id) return;
    window.gtag?.('event', name, {
      ...checked,
      send_to: this.id,
      page_location: this.lastLocation || `${this.origin}/desktop/home`,
      page_title: this.lastScreen || 'home',
    });
  }

  /** Static screen names only. E.g. 'downloads', 'settings/privacy'. */
  page(screen: string) {
    if (!this.enabled || !this.tagInitialized) return;
    const normalized = screen.toLowerCase().replace(/^\/+|\/+$/g, '');
    // Explicit pages are trusted route templates, but still restricted to safe tokens.
    const chunks = normalized.split('/');
    if (chunks.length > 3 || chunks.some((s) => !/^[a-z][a-z0-9_-]{0,24}$/.test(s))) return;
    if (!normalized || normalized === this.lastScreen) return;
    const previous = this.lastLocation;
    this.lastScreen = normalized;
    this.lastLocation = `${this.origin}/desktop/${normalized}`;
    window.gtag?.('event', 'page_view', {
      send_to: this.id,
      page_location: this.lastLocation,
      page_title: normalized,
      ...(previous ? { page_referrer: previous } : {}),
    });
  }

  private pageFromCurrentRoute() {
    const mode = this.options.routeMode ?? 'history';
    try {
      const path = routeFromLocation(window.location, mode);
      const mapped = this.options.mapRoute ? this.options.mapRoute(path) : safeScreen(path);
      if (mapped !== null) this.page(mapped);
    } catch (error) {
      if (this.options.debug) console.warn('Telemetry route mapping failed', error);
    }
  }

  private watchPages() {
    if (this.options.autoPageViews === false) return;
    const oldPush = history.pushState;
    const oldReplace = history.replaceState;
    const notify = () => this.pageFromCurrentRoute();
    history.pushState = function (...args: Parameters<History['pushState']>) {
      const r = oldPush.apply(this, args); notify(); return r;
    };
    history.replaceState = function (...args: Parameters<History['replaceState']>) {
      const r = oldReplace.apply(this, args); notify(); return r;
    };
    window.addEventListener('popstate', notify);
    window.addEventListener('hashchange', notify);
    this.cleanup.push(() => {
      history.pushState = oldPush;
      history.replaceState = oldReplace;
      window.removeEventListener('popstate', notify);
      window.removeEventListener('hashchange', notify);
    });
    this.pageFromCurrentRoute();
  }

  feature(name: string) {
    const token = safeToken(name, 48);
    if (token) this.track('feature_used', { feature_name: token });
  }

  download(status: 'started' | 'completed' | 'failed', fileFormat: string, durationMs?: number) {
    const format = safeToken(fileFormat, 24);
    this.track(`download_${status}`, {
      ...(format ? { file_format: format } : {}),
      ...(typeof durationMs === 'number' && Number.isFinite(durationMs) ?
        { duration_ms: Math.max(0, Math.round(durationMs)) } : {}),
    });
  }

  /** Track a key event (configure this event as a GA4 Key Event in the GA4 UI). */
  conversion(eventName: string, params: GA4EventParams = {}) {
    if (VALID_EVENT.test(eventName)) this.track(eventName, params);
  }

  /** GA4 recommended event. Only call on a successful sign-in. */
  login(method: string) { this.track('login', { method }); }

  /** GA4 recommended event. Only call when account creation succeeds. */
  signUp(method: string) { this.track('sign_up', { method }); }

  /** GA4 recommended event. User queries may contain personal data. Requires allowSearchTerms. */
  search(term: string) { if (this.options.allowSearchTerms) this.track('search', { search_term: term }); }

  /** GA4 recommended event. contentType/itemId should be anonymous fixed business labels. */
  share(method: string, contentType?: string, itemId?: string) {
    this.track('share', {
      method, ...(contentType ? { content_type: contentType } : {}),
      ...(itemId ? { item_id: itemId } : {}),
    });
  }

  /** GA4 recommended ecommerce event; uses official items[] semantics. */
  purchase(params: {
    transaction_id: string; currency: string; value: number; items: GA4Item[];
    coupon?: string; shipping?: number; tax?: number;
  }) { this.track('purchase', params); }

  /** GA4 recommended refund event; provide transaction_id and optional items/amount. */
  refund(params: {
    transaction_id: string; currency?: string; value?: number; items?: GA4Item[];
  }) { this.track('refund', params); }

  /** GA4 recommended ecommerce event. */
  addToCart(params: { currency: string; value: number; items: GA4Item[] }) {
    this.track('add_to_cart', params);
  }

  /** Desktop file action. Matches Web enhanced file_download name, without PII file paths. */
  fileDownload(fileExtension: string) {
    const extension = safeToken(fileExtension.replace(/^\./, '').toLowerCase(), 12);
    if (extension) this.track('file_download', { file_extension: extension });
  }

  /** Explicitly attributed installer/deep link; only recognized UTM keys are retained. */
  captureAttribution(input: string | URL | Campaign): boolean {
    const campaign = parseCampaign(input);
    if (!campaign || !this.enabled) return false;
    this.applyCampaign(campaign);
    window.electronTelemetry?.captureCampaign(campaign);
    return true;
  }

  private applyCampaign(campaign: Campaign) {
    if (!this.enabled || !this.tagInitialized) return;
    window.gtag?.('config', this.id, {
      ...toGtagCampaign(campaign),
      send_page_view: false,
    });
  }

  private reportDevice() {
    if (!this.context || this.deviceReported) return;
    this.deviceReported = true;
    const locale = safeToken((navigator.language || 'unknown').replaceAll('-', '_'), 24) ?? 'unknown';
    let zone = 'unknown';
    try { zone = safeToken(Intl.DateTimeFormat().resolvedOptions().timeZone?.replaceAll('/', '_'), 60) ?? 'unknown'; }
    catch { /* Incomplete Intl implementations must not break analytics. */ }
    const releaseMajor = this.context.osRelease.split('.')[0];
    this.track('desktop_device_info', {
      desktop_os: this.context.platform,
      os_major: releaseMajor,
      cpu_arch: this.context.arch,
      app_version: this.context.appVersion,
      release_channel: this.context.channel,
      locale,
      timezone: zone,
      screen_width: Math.round(screen.width),
      screen_height: Math.round(screen.height),
      pixel_ratio: Math.round(window.devicePixelRatio * 100) / 100,
    });
  }

  private watchClicks() {
    const onClick = (event: MouseEvent) => {
      const element = event.target as Element | null;
      const target = element?.closest?.('[data-ga4-event]');
      if (!target) return;
      const action = safeToken(target.getAttribute('data-ga4-event'), 40);
      const feature = safeToken(target.getAttribute('data-ga4-feature'), 40);
      if (action) this.track('desktop_ui_click', {
        action_name: action, ...(feature ? { feature_name: feature } : {}),
      });
    };
    document.addEventListener('click', onClick, true);
    this.cleanup.push(() => document.removeEventListener('click', onClick, true));
  }

  private watchScroll() {
    const thresholds = [25, 50, 75, 90];
    let sent = new Set<number>();
    let lastScreen = this.lastScreen;
    let last = 0;
    const onScroll = () => {
      if (lastScreen !== this.lastScreen) { sent = new Set(); lastScreen = this.lastScreen; }
      if (Date.now() - last < 250) return;
      last = Date.now();
      const documentHeight = document.documentElement.scrollHeight;
      const visibleHeight = window.innerHeight;
      if (documentHeight <= visibleHeight + 2) return;
      const percent = Math.min(100, 100 * (window.scrollY + visibleHeight) / documentHeight);
      for (const threshold of thresholds) {
        if (percent >= threshold && !sent.has(threshold)) {
          sent.add(threshold);
          this.track('desktop_scroll_depth', { scroll_percent: threshold });
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    this.cleanup.push(() => window.removeEventListener('scroll', onScroll));
  }

  /**
   * Optional compatibility events for native HTML controls. Enabled only when the
   * matching GA4 Enhanced Measurement auto collection is disabled in the stream.
   * Google gtag.js itself stays responsible for GA4 sessions/engagement/first_visit.
   */
  private watchEnhancedFallback() {
    const options = this.options.enhancedFallback;
    if (!options?.confirmedNativeEnhancedMeasurementDisabled) return;
    this.cleanup.push(installEnhancedMeasurement(
      options, this.origin, () => this.lastScreen, (name, params) => this.track(name, params),
    ));
  }

  private watchUsage() {
    const interval = Math.max(60_000, this.options.usageReportIntervalMs ?? DEFAULT_USAGE_INTERVAL);
    const idle = Math.max(5_000, this.options.inputIdleMs ?? 60_000);
    let foreground = document.visibilityState === 'visible' && document.hasFocus();
    let lastTick = performance.now();
    let lastInput = lastTick;
    let foregroundMs = 0;
    let activeMs = 0;
    let lastSignal = 0;
    const signalActivity = () => {
      const now = performance.now();
      lastInput = now;
      if (now - lastSignal >= 60_000) {
        lastSignal = now;
        window.electronTelemetry?.reportActivity();
      }
    };
    const flush = () => {
      // Avoid sending idle keep-alive events that could inflate GA4 sessions.
      if (activeMs >= 1000) {
        this.track('desktop_usage_time', {
          foreground_seconds: Math.round(foregroundMs / 1000),
          active_seconds: Math.round(activeMs / 1000),
        });
      }
      foregroundMs = 0;
      activeMs = 0;
    };
    const tick = () => {
      const now = performance.now();
      // Capped gap avoids treating OS sleep, suspended processes or debugger pauses as activity.
      const elapsed = Math.max(0, Math.min(20_000, now - lastTick));
      if (foreground) {
        foregroundMs += elapsed;
        activeMs += Math.max(0, Math.min(now, lastInput + idle) - Math.max(lastTick, now - elapsed));
      }
      lastTick = now;
      // Flush once engagement has stopped, or periodically only while active.
      // Idle-only foreground time is deliberately not sent to GA4 as a heartbeat.
      if ((activeMs >= 1000 && now - lastInput >= idle) ||
          (foregroundMs >= interval && now - lastInput < idle && activeMs >= 1000)) flush();
    };
    const onState = () => {
      tick();
      foreground = document.visibilityState === 'visible' && document.hasFocus();
      if (!foreground) flush();
      else signalActivity();
    };
    const onInput = () => { if (foreground) signalActivity(); };
    const onHide = () => { tick(); flush(); };
    const timer = setInterval(tick, 10_000);
    window.addEventListener('focus', onState);
    window.addEventListener('blur', onState);
    document.addEventListener('visibilitychange', onState);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pointerdown', onInput, { passive: true });
    window.addEventListener('mousemove', onInput, { passive: true });
    window.addEventListener('keydown', onInput);
    window.addEventListener('scroll', onInput, { passive: true });
    this.cleanup.push(() => {
      clearInterval(timer);
      tick();
      flush();
      window.removeEventListener('focus', onState);
      window.removeEventListener('blur', onState);
      document.removeEventListener('visibilitychange', onState);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pointerdown', onInput);
      window.removeEventListener('mousemove', onInput);
      window.removeEventListener('keydown', onInput);
      window.removeEventListener('scroll', onInput);
    });
    if (foreground) signalActivity();
  }

  error(area: string, error: unknown) {
    this.reportError(area, error instanceof Error ? error.name : 'UnknownError');
  }

  private reportError(area: string, kind: string) {
    const safeArea = safeToken(area, 36) ?? 'other';
    const safeKind = safeToken(kind, 36) ?? 'UnknownError';
    const key = `${safeArea}:${safeKind}`;
    const now = Date.now();
    if (now - (this.lastErrors.get(key) ?? 0) < 60_000) return;
    this.lastErrors.set(key, now);
    this.track('app_js_error', { error_area: safeArea, error_type: safeKind });
    // GA4 standard exception event unlocks the built-in Exceptions report.
    this.track('exception', { description: `${safeArea}_${safeKind}`, fatal: false });
  }

  private watchErrors() {
    const onError = (event: ErrorEvent) =>
      this.reportError('renderer', event.error instanceof Error ? event.error.name : 'Error');
    const onRejection = (event: PromiseRejectionEvent) =>
      this.reportError('promise', event.reason instanceof Error ? event.reason.name : 'Rejection');
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    this.cleanup.push(() => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    });
  }

  private watchWebVitals() {
    let reported = false;
    let lastLcp = 0;
    let observer: PerformanceObserver | undefined;
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'largest-contentful-paint') lastLcp = entry.startTime;
          }
        });
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch { /* Not available in this Chromium version. */ }
    }
    const report = () => {
      if (reported) return;
      reported = true;
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const paint = performance.getEntriesByName('first-contentful-paint')[0];
      if (paint) this.track('desktop_web_vital', { metric_name: 'fcp', value_ms: Math.round(paint.startTime) });
      if (nav) this.track('desktop_web_vital', { metric_name: 'navigation', value_ms: Math.round(nav.duration) });
      if (lastLcp) this.track('desktop_web_vital', { metric_name: 'lcp', value_ms: Math.round(lastLcp) });
      observer?.disconnect();
    };
    const onHidden = () => { if (document.visibilityState === 'hidden') report(); };
    let reportTimer: ReturnType<typeof setTimeout> | undefined;
    const onLoad = () => { reportTimer = setTimeout(report, 5000); };
    window.addEventListener('pagehide', report);
    document.addEventListener('visibilitychange', onHidden);
    this.cleanup.push(() => {
      window.removeEventListener('pagehide', report);
      document.removeEventListener('visibilitychange', onHidden);
      observer?.disconnect();
      if (reportTimer) clearTimeout(reportTimer);
      window.removeEventListener('load', onLoad);
    });
    // Allow late LCP observations; pagehide/visibility change can report earlier.
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
  }

  destroy() {
    this.cleanupActive();
    this.nativeUnsubscribe?.();
    this.nativeUnsubscribe = undefined;
    this.enabled = false;
    if (this.tagInitialized) {
      setGoogleTagEnabled(this.id, false);
    }
    window.electronTelemetry?.ready(false);
  }
}
