import type { GA4EventParams } from './ga4-web';
export interface EnhancedMeasurementOptions {
    scroll?: boolean;
    /** Also observe scrollable Electron application panes. */
    scrollContainers?: boolean;
    siteSearch?: boolean;
    searchQueryParameters?: string[];
    /** Native GA4 metadata, or marked forms/videos and origin-only outbound URLs. */
    privacy?: 'native' | 'redacted';
    outboundClicks?: boolean;
    fileDownloads?: boolean;
    forms?: boolean;
    html5Video?: boolean;
    /** Observe JS API-enabled YouTube embeds using the official iframe API. */
    youtubeVideo?: boolean;
    /** Receive actual Electron DownloadItem notifications through the preload. */
    nativeDownloads?: boolean;
}
/** Application-DOM events for a tag running in a separate HTTPS collector. */
export declare function installEnhancedMeasurement(options: EnhancedMeasurementOptions, origin: string, getScreen: () => string, track: (name: string, params: GA4EventParams) => void): () => void;
