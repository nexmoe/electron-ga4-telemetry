import type { GA4EventParams } from './ga4-web';
export interface LinkMeasurementOptions {
    privacy?: 'native' | 'redacted';
    outboundClicks?: boolean;
    fileDownloads?: boolean;
}
export interface NativeMeasurementEvent {
    type: 'click' | 'download';
    url: string;
    filename?: string;
}
/** One action can produce both an anchor event and an Electron notification. */
export declare function createLinkMeasurement(options: LinkMeasurementOptions, origin: string, track: (name: string, params: GA4EventParams) => void): {
    record(type: 'click' | 'download', href: string, source: 'dom' | 'native', filename?: string, anchor?: Element): void;
};
