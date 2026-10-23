import type { GA4EventParams } from './ga4-web';
export interface EnhancedMeasurementOptions {
    scroll?: boolean;
    outboundClicks?: boolean;
    fileDownloads?: boolean;
    forms?: boolean;
    html5Video?: boolean;
}
/** Application-DOM events for a tag running in a separate HTTPS collector. */
export declare function installEnhancedMeasurement(options: EnhancedMeasurementOptions, origin: string, getScreen: () => string, track: (name: string, params: GA4EventParams) => void): () => void;
