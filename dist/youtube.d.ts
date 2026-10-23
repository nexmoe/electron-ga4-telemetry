import type { GA4EventParams } from './ga4-web';
/** Use the official Player API; do not read arbitrary cross-origin postMessage payloads. */
export declare function installYouTubeMeasurement(redacted: boolean, track: (name: string, params: GA4EventParams) => void): () => void;
