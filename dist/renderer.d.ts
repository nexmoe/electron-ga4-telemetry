import { type GA4EventParams, type GA4Item } from './ga4-web';
import type { Campaign } from './shared';
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
/** Opt-in, Electron-aware GA4 Web wrapper. No API Secret or Measurement Protocol calls. */
export declare class ElectronGA4Telemetry {
    private readonly options;
    private readonly id;
    private readonly origin;
    private enabled;
    private context?;
    private initPromise?;
    private tagInitialized;
    private tagScriptLoaded;
    private lastScreen;
    private lastLocation;
    private nativeUnsubscribe?;
    private cleanup;
    private lastErrors;
    private lastNative;
    private deviceReported;
    constructor(options: RendererTelemetryOptions);
    init(): Promise<void>;
    private initialize;
    private initTag;
    private activate;
    setEnabled(allowed: boolean): Promise<void>;
    /**
     * Local diagnostics for GA4's automatic sessions. This does not transmit IDs
     * anywhere or manufacture the GA4 session_start/user_engagement events.
     * Run from a renderer DevTools console after gtag.js finishes loading.
     */
    diagnostics(timeoutMs?: number): Promise<{
        enabled: boolean;
        protocol: string;
        scriptLoaded: boolean;
        clientIdMatchesProfile: boolean | null;
        sessionIdPresent: boolean;
        sessionNumberPresent: boolean;
    }>;
    private cleanupActive;
    /** Official gtag commands, including callbacks and standard nested payloads. */
    gtag(...args: unknown[]): void;
    /** User-defined events: never send user content, file paths, URLs, emails, IDs or error stacks. */
    track(name: string, params?: GA4EventParams): void;
    /** Static screen names only. E.g. 'downloads', 'settings/privacy'. */
    page(screen: string): void;
    private pageFromCurrentRoute;
    private watchPages;
    feature(name: string): void;
    download(status: 'started' | 'completed' | 'failed', fileFormat: string, durationMs?: number): void;
    /** Track a key event (configure this event as a GA4 Key Event in the GA4 UI). */
    conversion(eventName: string, params?: GA4EventParams): void;
    /** GA4 recommended event. Only call on a successful sign-in. */
    login(method: string): void;
    /** GA4 recommended event. Only call when account creation succeeds. */
    signUp(method: string): void;
    /** GA4 recommended event. User queries may contain personal data. Requires allowSearchTerms. */
    search(term: string): void;
    /** GA4 recommended event. contentType/itemId should be anonymous fixed business labels. */
    share(method: string, contentType?: string, itemId?: string): void;
    /** GA4 recommended ecommerce event; uses official items[] semantics. */
    purchase(params: {
        transaction_id: string;
        currency: string;
        value: number;
        items: GA4Item[];
        coupon?: string;
        shipping?: number;
        tax?: number;
    }): void;
    /** GA4 recommended refund event; provide transaction_id and optional items/amount. */
    refund(params: {
        transaction_id: string;
        currency?: string;
        value?: number;
        items?: GA4Item[];
    }): void;
    /** GA4 recommended ecommerce event. */
    addToCart(params: {
        currency: string;
        value: number;
        items: GA4Item[];
    }): void;
    /** Desktop file action. Matches Web enhanced file_download name, without PII file paths. */
    fileDownload(fileExtension: string): void;
    /** Explicitly attributed installer/deep link; only recognized UTM keys are retained. */
    captureAttribution(input: string | URL | Campaign): boolean;
    private applyCampaign;
    private reportDevice;
    private watchClicks;
    private watchScroll;
    /**
     * Optional compatibility events for native HTML controls. Enabled only when the
     * matching GA4 Enhanced Measurement auto collection is disabled in the stream.
     * Google gtag.js itself stays responsible for GA4 sessions/engagement/first_visit.
     */
    private watchEnhancedFallback;
    private watchUsage;
    error(area: string, error: unknown): void;
    private reportError;
    private watchErrors;
    private watchWebVitals;
    destroy(): void;
}
