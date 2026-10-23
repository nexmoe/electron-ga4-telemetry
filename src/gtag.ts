import { installEnhancedMeasurement, type EnhancedMeasurementOptions } from './enhanced';
import { safeScreen } from './core';
/** The official gtag command queue. This module does not import Electron. */
export type GoogleTag = (...args: unknown[]) => void;

interface GoogleTagWindow extends Window {
  dataLayer?: unknown[];
  gtag?: GoogleTag;
  electronGoogleTag?: {
    send(args: unknown[]): Promise<{ index: number; values: unknown[] } | null>;
  };
}

export interface GoogleAnalyticsOptions {
  measurementId: string;
  clientId?: string;
  /** Opt into library-owned anonymous identity storage; false leaves identity to Google. */
  clientIdStorageKey?: string | false;
  pageLocation?: string;
  pageTitle?: string;
  /** Persisted consent. No script or command is created until enabled. */
  enabled?: boolean;
  /** Default true: let the official tag send its initial page_view. */
  sendPageView?: boolean;
  /** Forward official gtag configuration, e.g. cookie settings or debug_mode. */
  config?: Record<string, unknown>;
  /** Optional application-owned consent defaults; omitted preserves native Google defaults. */
  consent?: Record<string, unknown>;
  /** Bridge mode observes the application's DOM, since the HTTPS collector has no app DOM. */
  enhancedMeasurement?: EnhancedMeasurementOptions | false;
  /** Bridge mode sends one virtual page view for each mapped History route. */
  autoPageViews?: boolean;
  mapRoute?: (path: string) => string | null;
}

export function getOrCreateGoogleTag(): GoogleTag {
  const target = window as GoogleTagWindow;
  target.dataLayer ??= [];
  if (!target.gtag) {
    if (target.electronGoogleTag) {
      target.gtag = function gtag() {
        target.dataLayer!.push(arguments);
        if (target.dataLayer!.length > 200) target.dataLayer!.splice(0, target.dataLayer!.length - 200);
        const callbacks: Array<(...args: unknown[]) => void> = [];
        const args = JSON.parse(JSON.stringify(Array.from(arguments), (_key, value) => {
          if (typeof value !== 'function') return value;
          const index = callbacks.push(value) - 1;
          return { __electron_ga4_callback__: index };
        }));
        void target.electronGoogleTag!.send(args).then((result) => {
          if (result) callbacks[result.index]?.(...result.values);
        }).catch(() => undefined);
      };
    } else {
      target.gtag = function gtag() {
        target.dataLayer!.push(arguments);
      };
    }
  }
  return target.gtag;
}

export function loadGoogleTag(measurementId: string, onLoad?: () => void): void {
  const bridge = (window as GoogleTagWindow).electronGoogleTag;
  if (bridge) {
    void bridge.send(['set', {}]).then(() => onLoad?.()).catch(() => undefined);
    return;
  }
  if (document.querySelector(`script[data-electron-ga4="${measurementId}"]`)) return;
  const script = document.createElement('script');
  script.async = true;
  script.onload = () => onLoad?.();
  script.dataset.electronGa4 = measurementId;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
}

/** Pause delivery without changing application-owned consent or rebuilding the Electron tag. */
export function setGoogleTagEnabled(measurementId: string, enabled: boolean): void {
  (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = !enabled;
  const bridge = (window as GoogleTagWindow).electronGoogleTag;
  if (bridge) void bridge.send(['__electron_ga4_enabled', enabled]).catch(() => undefined);
}

/**
 * Official gtag transport for applications that already own identity and event policy.
 * Automatic and enhanced measurement remain owned by Google and the GA4 stream settings.
 * Callers must supply safe page metadata and non-identifying event parameters.
 */
export class GoogleAnalyticsClient {
  private initialized = false;
  private enabled: boolean;
  private clientId: string | undefined;
  private readonly id: string;
  private cleanup: Array<() => void> = [];
  private pageLocation?: string;
  private pageTitle?: string;

  constructor(private readonly options: GoogleAnalyticsOptions) {
    if (!/^G-[A-Z0-9]+$/i.test(options.measurementId)) throw new Error('Invalid GA4 measurementId');
    if (options.clientId !== undefined && !/^\d+\.\d+$/.test(options.clientId)) throw new Error('Invalid anonymous GA4 clientId');
    if (options.pageLocation) {
      const page = new URL(options.pageLocation);
      if (!['http:', 'https:'].includes(page.protocol) || page.username || page.password) {
        throw new Error('pageLocation must use HTTP/HTTPS without credentials');
      }
    }
    this.pageLocation = options.pageLocation;
    this.pageTitle = options.pageTitle ?? (
      typeof window !== 'undefined' && typeof document !== 'undefined' &&
      (window as GoogleTagWindow).electronGoogleTag && options.config?.page_title === undefined
        ? document.title : undefined
    );
    this.id = options.measurementId.toUpperCase();
    this.clientId = options.clientId;
    this.enabled = options.enabled === true;
  }

  initialize(): boolean {
    if (!this.enabled) return false;
    if (this.initialized) return true;
    this.initializeIdentity();
    const gtag = getOrCreateGoogleTag();
    setGoogleTagEnabled(this.id, true);
    if (this.options.consent) gtag('consent', 'default', this.options.consent);
    gtag('js', new Date());
    gtag('config', this.id, {
      ...this.options.config,
      ...(this.clientId ? { client_id: this.clientId } : {}),
      ...(this.pageLocation ? { page_location: this.pageLocation } : {}),
      ...(this.pageTitle ? { page_title: this.pageTitle } : {}),
      send_page_view: this.options.sendPageView ?? this.options.config?.send_page_view ?? true,
    });
    loadGoogleTag(this.id);
    this.initialized = true;
    this.watchApplication();
    return true;
  }

  private persistIdentity(): void {
    if (!this.clientId || !this.options.clientIdStorageKey) return;
    try { window.localStorage.setItem(this.options.clientIdStorageKey, this.clientId); }
    catch { /* Storage restrictions must not prevent in-memory analytics. */ }
  }

  private initializeIdentity(): void {
    const key = this.options.clientIdStorageKey;
    if (!key) return;
    if (!this.clientId) {
      try {
        const stored = window.localStorage.getItem(key);
        if (stored && /^\d+\.\d+$/.test(stored)) this.clientId = stored;
      } catch { /* Opaque origins can deny localStorage. */ }
      if (!this.clientId) {
        let random: number;
        try { random = window.crypto.getRandomValues(new Uint32Array(1))[0]; }
        catch { random = Math.floor(Math.random() * 0x100000000); }
        this.clientId = `${random}.${Math.floor(Date.now() / 1000)}`;
      }
    }
    this.persistIdentity();
  }

  setClientId(clientId: string): boolean {
    return this.applyClientId(clientId, true);
  }

  /** @internal Main synchronizes siblings without echoing another native config command. */
  synchronizeClientId(clientId: string): boolean {
    return this.applyClientId(clientId, false);
  }

  private applyClientId(clientId: string, configure: boolean): boolean {
    if (!/^\d+\.\d+$/.test(clientId)) return false;
    this.clientId = clientId;
    this.persistIdentity();
    if (configure && this.initialized && this.enabled) {
      getOrCreateGoogleTag()('config', this.id, {
        client_id: clientId, update: true, send_page_view: false,
      });
    }
    return true;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cleanup.splice(0).reverse().forEach(dispose => dispose());
    if (!this.initialized) {
      if (enabled) this.initialize();
      return;
    }
    setGoogleTagEnabled(this.id, enabled);
    if (enabled) this.watchApplication();
  }

  /** Native gtag command API; payloads and callbacks pass through unchanged. */
  gtag(...args: unknown[]): void {
    if (args[0] === 'consent') {
      getOrCreateGoogleTag()(...args);
      return;
    }
    if (!this.enabled) return;
    // Preserve native pre-config consent defaults and global settings.
    if (!this.initialized && args[0] === 'set') {
      getOrCreateGoogleTag()(...args);
      return;
    }
    if (this.initialize()) getOrCreateGoogleTag()(...args);
  }

  track(name: string, params: Record<string, unknown> = {}): void {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(name) || !this.initialize()) return;
    getOrCreateGoogleTag()('event', name, {
      ...(this.pageLocation ? { page_location: this.pageLocation } : {}),
      ...(this.pageTitle ? { page_title: this.pageTitle } : {}),
      send_to: this.id,
      ...params,
    });
  }
  private watchApplication(): void {
    if (!(window as GoogleTagWindow).electronGoogleTag || this.cleanup.length) return;
    const origin = new URL(this.pageLocation ?? 'https://desktop.invalid').origin;
    if (this.options.autoPageViews !== false) {
      let previousScreen: string | null = null;
      try {
        previousScreen = this.options.mapRoute ? this.options.mapRoute(window.location.pathname) : safeScreen(window.location.pathname);
      } catch { /* Initial route mapping is optional telemetry. */ }
      const notify = () => {
        try {
        const path = window.location.pathname;
        const screen = this.options.mapRoute ? this.options.mapRoute(path) : safeScreen(path);
        if (screen === null || screen === previousScreen || !/^[a-z][a-z0-9_-]{0,24}(?:\/[a-z][a-z0-9_-]{0,24}){0,2}$/.test(screen)) return;
        previousScreen = screen;
        const next = `${origin}/desktop/${screen}`;
        if (next === this.pageLocation) return;
        const previous = this.pageLocation;
        this.pageLocation = next;
        this.pageTitle = screen;
        this.track('page_view', previous ? { page_referrer: previous } : {});
        } catch { /* Route adapters must not interfere with application navigation. */ }
      };
      const push = history.pushState;
      const replace = history.replaceState;
      history.pushState = function(...args) { const result = push.apply(this, args); notify(); return result; };
      history.replaceState = function(...args) { const result = replace.apply(this, args); notify(); return result; };
      window.addEventListener('popstate', notify);
      this.cleanup.push(() => {
        history.pushState = push;
        history.replaceState = replace;
        window.removeEventListener('popstate', notify);
      });
    }
    if (this.options.enhancedMeasurement !== false) {
      this.cleanup.push(installEnhancedMeasurement(
        this.options.enhancedMeasurement ?? {
          scroll: true, scrollContainers: true, outboundClicks: true, fileDownloads: true, forms: true, html5Video: true, youtubeVideo: true, siteSearch: true, nativeDownloads: true,
        },
        origin, () => this.pageLocation ?? 'home', (name, params) => this.track(name, params),
      ));
    }
  }

  destroy(): void {
    this.cleanup.splice(0).reverse().forEach(dispose => dispose());
    this.enabled = false;
  }

}
