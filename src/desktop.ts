import { GoogleAnalyticsClient, type GoogleAnalyticsOptions } from './gtag';

export interface DesktopGoogleAnalyticsOptions extends GoogleAnalyticsOptions {
  /** Synthetic HTTPS page belonging to the application's transport origin. */
  pageLocation: string;
  /** Defaults to native GA4 metadata. Redacted mode requires marked forms/videos. */
  privacy?: 'native' | 'redacted';
  /** Serializable route policy: exact matches beat trailing * patterns; unknown paths are omitted. */
  routes?: Record<string, string | null>;
}

const CLIENTS = Symbol.for('electron-ga4.desktop.clients');
type DesktopWindow = Window & {
  [CLIENTS]?: Map<string, GoogleAnalyticsClient>;
};

class DesktopClient extends GoogleAnalyticsClient {
  constructor(
    options: GoogleAnalyticsOptions,
    private readonly unregister: () => void,
  ) {
    super(options);
  }
  override destroy(): void {
    super.destroy();
    this.unregister();
  }
}

/**
 * One client per window/stream, including module reloads. The first call owns configuration;
 * use the client's methods for consent, enabled state and verified identity updates.
 * Creating a client does not start collection; initialize(), track() or gtag() does.
 */
export function getDesktopGoogleAnalytics(
  options: DesktopGoogleAnalyticsOptions,
): GoogleAnalyticsClient {
  const target = window as DesktopWindow;
  const clients = (target[CLIENTS] ??= new Map());
  const id = options.measurementId.toUpperCase();
  const existing = clients.get(id);
  if (existing) return existing;
  const client = new DesktopClient(
    {
      ...options,
      enabled: options.enabled ?? true,
      mapRoute:
        options.mapRoute ??
        (options.routes
          ? (path) => resolveAnalyticsRoute(path, options.routes!)
          : undefined),
      clientIdStorageKey:
        options.clientIdStorageKey ?? `electron-ga4:${id}:client-id`,
      enhancedMeasurement:
        options.enhancedMeasurement === false
          ? false
          : {
              scroll: true,
              scrollContainers: true,
              outboundClicks: true,
              fileDownloads: true,
              forms: true,
              html5Video: true,
              youtubeVideo: true,
              siteSearch: true,
              nativeDownloads: true,
              privacy: options.privacy ?? 'native',
              ...options.enhancedMeasurement,
            },
    },
    () => {
      if (clients.get(id) === client) clients.delete(id);
    },
  );
  clients.set(id, client);
  return client;
}

/** Resolve fixed route labels without serializing functions across Electron processes. */
export function resolveAnalyticsRoute(
  path: string,
  routes: Record<string, string | null>,
): string | null {
  if (Object.prototype.hasOwnProperty.call(routes, path)) return routes[path];
  const pattern = Object.keys(routes)
    .filter((key) => key.endsWith('*') && path.startsWith(key.slice(0, -1)))
    .sort((a, b) => b.length - a.length)[0];
  return pattern ? routes[pattern] : null;
}

/** Wait for Main/Preload automatic setup. A disabled or unavailable transport returns null. */
export async function getAutoGoogleAnalytics(
  measurementId?: string,
): Promise<GoogleAnalyticsClient | null> {
  const target = window as DesktopWindow & {
    electronGoogleTag?: { ready?: () => Promise<string | null> };
  };
  let id = measurementId?.toUpperCase();
  if (target.electronGoogleTag?.ready) {
    let configured: string | null;
    try {
      configured = await target.electronGoogleTag.ready();
    } catch {
      return null;
    }
    if (!configured || (id && id !== configured)) return null;
    id = configured;
  }
  return id ? (target[CLIENTS]?.get(id) ?? null) : null;
}
