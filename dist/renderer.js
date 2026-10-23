"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElectronGA4Telemetry = void 0;
const enhanced_1 = require("./enhanced");
const gtag_1 = require("./gtag");
const core_1 = require("./core");
const ga4_web_1 = require("./ga4-web");
const DEFAULT_USAGE_INTERVAL = 5 * 60_000;
/** Opt-in, Electron-aware GA4 Web wrapper. No API Secret or Measurement Protocol calls. */
class ElectronGA4Telemetry {
    options;
    id;
    origin;
    enabled;
    context;
    initPromise;
    tagInitialized = false;
    tagScriptLoaded = false;
    lastScreen = '';
    lastLocation = '';
    nativeUnsubscribe;
    cleanup = [];
    lastErrors = new Map();
    lastNative = new Map();
    deviceReported = false;
    constructor(options) {
        this.options = options;
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
    init() {
        if (this.initPromise)
            return this.initPromise;
        this.initPromise = this.initialize().catch((error) => {
            this.initPromise = undefined;
            throw error;
        });
        return this.initPromise;
    }
    async initialize() {
        const bridge = window.electronTelemetry;
        if (!bridge)
            throw new Error('Call installTelemetryPreload() from the preload entrypoint');
        this.context = await bridge.getContext();
        this.nativeUnsubscribe = bridge.onEvent(({ name, params }) => {
            if (name === 'desktop_attribution') {
                const parsed = (0, core_1.parseCampaign)(params);
                if (parsed)
                    this.applyCampaign(parsed);
            }
            this.track(name, params);
        });
        if (this.enabled)
            this.activate();
        bridge.ready(this.enabled);
    }
    initTag() {
        if (!this.context)
            throw new Error('Missing telemetry context');
        if (this.tagInitialized) {
            (0, gtag_1.setGoogleTagEnabled)(this.id, true);
            window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
            return;
        }
        // Custom protocol cookies are not guaranteed. An explicit ID helps device-level deduplication.
        window.gtag = (0, gtag_1.getOrCreateGoogleTag)();
        (0, gtag_1.setGoogleTagEnabled)(this.id, true);
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
            ...(this.context.launchCampaign ? (0, core_1.toGtagCampaign)(this.context.launchCampaign) : {}),
            ...(this.options.debug === true ? { debug_mode: true } : {}),
        });
        (0, gtag_1.loadGoogleTag)(this.id, () => { this.tagScriptLoaded = true; });
        this.tagInitialized = true;
    }
    activate() {
        this.initTag();
        this.watchPages();
        this.watchUsage();
        this.watchErrors();
        if (this.options.autoClicks === true)
            this.watchClicks();
        if (this.options.autoScroll === true)
            this.watchScroll();
        if (this.options.collectWebVitals === true)
            this.watchWebVitals();
        if (this.options.enhancedFallback?.confirmedNativeEnhancedMeasurementDisabled)
            this.watchEnhancedFallback();
        if (!this.deviceReported)
            this.reportDevice();
    }
    async setEnabled(allowed) {
        await this.init();
        if (this.enabled === allowed)
            return;
        this.enabled = allowed;
        if (allowed) {
            this.activate();
        }
        else {
            this.cleanupActive();
            this.lastScreen = '';
            this.lastLocation = '';
            // GA4's disable flag protects this measurement ID, even if gtag.js is already loaded.
            if (this.tagInitialized) {
                (0, gtag_1.setGoogleTagEnabled)(this.id, false);
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
    async diagnostics(timeoutMs = 2000) {
        await this.init();
        const base = {
            enabled: this.enabled,
            protocol: window.location.protocol ?? 'unknown',
            scriptLoaded: this.tagScriptLoaded,
            clientIdMatchesProfile: null,
            sessionIdPresent: false,
            sessionNumberPresent: false,
        };
        if (!this.enabled || !this.tagInitialized || !window.gtag)
            return base;
        const get = (field) => new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve(undefined);
                }
            }, Math.max(100, Math.min(timeoutMs, 5000)));
            window.gtag?.('get', this.id, field, (value) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve(value);
                }
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
    cleanupActive() {
        for (const fn of this.cleanup.splice(0))
            fn();
    }
    /** Official gtag commands, including callbacks and standard nested payloads. */
    gtag(...args) {
        if (this.enabled && this.tagInitialized)
            (0, gtag_1.getOrCreateGoogleTag)()(...args);
    }
    /** User-defined events: never send user content, file paths, URLs, emails, IDs or error stacks. */
    track(name, params = {}) {
        // gtag.js owns these events, and page() manages page_view separately.
        if (!this.enabled || !this.tagInitialized || !core_1.VALID_EVENT.test(name) || ga4_web_1.GTAG_OWNED_EVENTS.has(name))
            return;
        if (name.startsWith('window_')) {
            const now = Date.now();
            if (now - (this.lastNative.get(name) ?? 0) < 1000)
                return;
            this.lastNative.set(name, now);
        }
        const checked = (0, ga4_web_1.cleanGA4WebParams)(params, { allowSearchTerms: this.options.allowSearchTerms });
        // GA4 recommended events rely on required parameters for predefined reports.
        if (name === 'search' && !checked.search_term)
            return;
        if (name === 'purchase' && (!checked.transaction_id || !checked.currency ||
            typeof checked.value !== 'number' || !Array.isArray(checked.items)))
            return;
        if (name === 'refund' && !checked.transaction_id)
            return;
        window.gtag?.('event', name, {
            ...checked,
            send_to: this.id,
            page_location: this.lastLocation || `${this.origin}/desktop/home`,
            page_title: this.lastScreen || 'home',
        });
    }
    /** Static screen names only. E.g. 'downloads', 'settings/privacy'. */
    page(screen) {
        if (!this.enabled || !this.tagInitialized)
            return;
        const normalized = screen.toLowerCase().replace(/^\/+|\/+$/g, '');
        // Explicit pages are trusted route templates, but still restricted to safe tokens.
        const chunks = normalized.split('/');
        if (chunks.length > 3 || chunks.some((s) => !/^[a-z][a-z0-9_-]{0,24}$/.test(s)))
            return;
        if (!normalized || normalized === this.lastScreen)
            return;
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
    pageFromCurrentRoute() {
        const mode = this.options.routeMode ?? 'history';
        try {
            const path = (0, core_1.routeFromLocation)(window.location, mode);
            const mapped = this.options.mapRoute ? this.options.mapRoute(path) : (0, core_1.safeScreen)(path);
            if (mapped !== null)
                this.page(mapped);
        }
        catch (error) {
            if (this.options.debug)
                console.warn('Telemetry route mapping failed', error);
        }
    }
    watchPages() {
        if (this.options.autoPageViews === false)
            return;
        const oldPush = history.pushState;
        const oldReplace = history.replaceState;
        const notify = () => this.pageFromCurrentRoute();
        history.pushState = function (...args) {
            const r = oldPush.apply(this, args);
            notify();
            return r;
        };
        history.replaceState = function (...args) {
            const r = oldReplace.apply(this, args);
            notify();
            return r;
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
    feature(name) {
        const token = (0, core_1.safeToken)(name, 48);
        if (token)
            this.track('feature_used', { feature_name: token });
    }
    download(status, fileFormat, durationMs) {
        const format = (0, core_1.safeToken)(fileFormat, 24);
        this.track(`download_${status}`, {
            ...(format ? { file_format: format } : {}),
            ...(typeof durationMs === 'number' && Number.isFinite(durationMs) ?
                { duration_ms: Math.max(0, Math.round(durationMs)) } : {}),
        });
    }
    /** Track a key event (configure this event as a GA4 Key Event in the GA4 UI). */
    conversion(eventName, params = {}) {
        if (core_1.VALID_EVENT.test(eventName))
            this.track(eventName, params);
    }
    /** GA4 recommended event. Only call on a successful sign-in. */
    login(method) { this.track('login', { method }); }
    /** GA4 recommended event. Only call when account creation succeeds. */
    signUp(method) { this.track('sign_up', { method }); }
    /** GA4 recommended event. User queries may contain personal data. Requires allowSearchTerms. */
    search(term) { if (this.options.allowSearchTerms)
        this.track('search', { search_term: term }); }
    /** GA4 recommended event. contentType/itemId should be anonymous fixed business labels. */
    share(method, contentType, itemId) {
        this.track('share', {
            method, ...(contentType ? { content_type: contentType } : {}),
            ...(itemId ? { item_id: itemId } : {}),
        });
    }
    /** GA4 recommended ecommerce event; uses official items[] semantics. */
    purchase(params) { this.track('purchase', params); }
    /** GA4 recommended refund event; provide transaction_id and optional items/amount. */
    refund(params) { this.track('refund', params); }
    /** GA4 recommended ecommerce event. */
    addToCart(params) {
        this.track('add_to_cart', params);
    }
    /** Desktop file action. Matches Web enhanced file_download name, without PII file paths. */
    fileDownload(fileExtension) {
        const extension = (0, core_1.safeToken)(fileExtension.replace(/^\./, '').toLowerCase(), 12);
        if (extension)
            this.track('file_download', { file_extension: extension });
    }
    /** Explicitly attributed installer/deep link; only recognized UTM keys are retained. */
    captureAttribution(input) {
        const campaign = (0, core_1.parseCampaign)(input);
        if (!campaign || !this.enabled)
            return false;
        this.applyCampaign(campaign);
        window.electronTelemetry?.captureCampaign(campaign);
        return true;
    }
    applyCampaign(campaign) {
        if (!this.enabled || !this.tagInitialized)
            return;
        window.gtag?.('config', this.id, {
            ...(0, core_1.toGtagCampaign)(campaign),
            send_page_view: false,
        });
    }
    reportDevice() {
        if (!this.context || this.deviceReported)
            return;
        this.deviceReported = true;
        const locale = (0, core_1.safeToken)((navigator.language || 'unknown').replaceAll('-', '_'), 24) ?? 'unknown';
        let zone = 'unknown';
        try {
            zone = (0, core_1.safeToken)(Intl.DateTimeFormat().resolvedOptions().timeZone?.replaceAll('/', '_'), 60) ?? 'unknown';
        }
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
    watchClicks() {
        const onClick = (event) => {
            const element = event.target;
            const target = element?.closest?.('[data-ga4-event]');
            if (!target)
                return;
            const action = (0, core_1.safeToken)(target.getAttribute('data-ga4-event'), 40);
            const feature = (0, core_1.safeToken)(target.getAttribute('data-ga4-feature'), 40);
            if (action)
                this.track('desktop_ui_click', {
                    action_name: action, ...(feature ? { feature_name: feature } : {}),
                });
        };
        document.addEventListener('click', onClick, true);
        this.cleanup.push(() => document.removeEventListener('click', onClick, true));
    }
    watchScroll() {
        const thresholds = [25, 50, 75, 90];
        let sent = new Set();
        let lastScreen = this.lastScreen;
        let last = 0;
        const onScroll = () => {
            if (lastScreen !== this.lastScreen) {
                sent = new Set();
                lastScreen = this.lastScreen;
            }
            if (Date.now() - last < 250)
                return;
            last = Date.now();
            const documentHeight = document.documentElement.scrollHeight;
            const visibleHeight = window.innerHeight;
            if (documentHeight <= visibleHeight + 2)
                return;
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
    watchEnhancedFallback() {
        const options = this.options.enhancedFallback;
        if (!options?.confirmedNativeEnhancedMeasurementDisabled)
            return;
        this.cleanup.push((0, enhanced_1.installEnhancedMeasurement)(options, this.origin, () => this.lastScreen, (name, params) => this.track(name, params)));
    }
    watchUsage() {
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
                (foregroundMs >= interval && now - lastInput < idle && activeMs >= 1000))
                flush();
        };
        const onState = () => {
            tick();
            foreground = document.visibilityState === 'visible' && document.hasFocus();
            if (!foreground)
                flush();
            else
                signalActivity();
        };
        const onInput = () => { if (foreground)
            signalActivity(); };
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
        if (foreground)
            signalActivity();
    }
    error(area, error) {
        this.reportError(area, error instanceof Error ? error.name : 'UnknownError');
    }
    reportError(area, kind) {
        const safeArea = (0, core_1.safeToken)(area, 36) ?? 'other';
        const safeKind = (0, core_1.safeToken)(kind, 36) ?? 'UnknownError';
        const key = `${safeArea}:${safeKind}`;
        const now = Date.now();
        if (now - (this.lastErrors.get(key) ?? 0) < 60_000)
            return;
        this.lastErrors.set(key, now);
        this.track('app_js_error', { error_area: safeArea, error_type: safeKind });
        // GA4 standard exception event unlocks the built-in Exceptions report.
        this.track('exception', { description: `${safeArea}_${safeKind}`, fatal: false });
    }
    watchErrors() {
        const onError = (event) => this.reportError('renderer', event.error instanceof Error ? event.error.name : 'Error');
        const onRejection = (event) => this.reportError('promise', event.reason instanceof Error ? event.reason.name : 'Rejection');
        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onRejection);
        this.cleanup.push(() => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
        });
    }
    watchWebVitals() {
        let reported = false;
        let lastLcp = 0;
        let observer;
        if (typeof PerformanceObserver !== 'undefined') {
            try {
                observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.entryType === 'largest-contentful-paint')
                            lastLcp = entry.startTime;
                    }
                });
                observer.observe({ type: 'largest-contentful-paint', buffered: true });
            }
            catch { /* Not available in this Chromium version. */ }
        }
        const report = () => {
            if (reported)
                return;
            reported = true;
            const nav = performance.getEntriesByType('navigation')[0];
            const paint = performance.getEntriesByName('first-contentful-paint')[0];
            if (paint)
                this.track('desktop_web_vital', { metric_name: 'fcp', value_ms: Math.round(paint.startTime) });
            if (nav)
                this.track('desktop_web_vital', { metric_name: 'navigation', value_ms: Math.round(nav.duration) });
            if (lastLcp)
                this.track('desktop_web_vital', { metric_name: 'lcp', value_ms: Math.round(lastLcp) });
            observer?.disconnect();
        };
        const onHidden = () => { if (document.visibilityState === 'hidden')
            report(); };
        let reportTimer;
        const onLoad = () => { reportTimer = setTimeout(report, 5000); };
        window.addEventListener('pagehide', report);
        document.addEventListener('visibilitychange', onHidden);
        this.cleanup.push(() => {
            window.removeEventListener('pagehide', report);
            document.removeEventListener('visibilitychange', onHidden);
            observer?.disconnect();
            if (reportTimer)
                clearTimeout(reportTimer);
            window.removeEventListener('load', onLoad);
        });
        // Allow late LCP observations; pagehide/visibility change can report earlier.
        if (document.readyState === 'complete')
            onLoad();
        else
            window.addEventListener('load', onLoad, { once: true });
    }
    destroy() {
        this.cleanupActive();
        this.nativeUnsubscribe?.();
        this.nativeUnsubscribe = undefined;
        this.enabled = false;
        if (this.tagInitialized) {
            (0, gtag_1.setGoogleTagEnabled)(this.id, false);
        }
        window.electronTelemetry?.ready(false);
    }
}
exports.ElectronGA4Telemetry = ElectronGA4Telemetry;
