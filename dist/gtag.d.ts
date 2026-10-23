import { type EnhancedMeasurementOptions } from './enhanced';
/** The official gtag command queue. This module does not import Electron. */
export type GoogleTag = (...args: unknown[]) => void;
export interface GoogleAnalyticsOptions {
    measurementId: string;
    clientId?: string;
    pageLocation?: string;
    pageTitle?: string;
    /** Persisted consent. No script or command is created until enabled. */
    enabled?: boolean;
    /** Default true: let the official tag send its initial page_view. */
    sendPageView?: boolean;
    /** Forward official gtag configuration, e.g. cookie settings or debug_mode. */
    config?: Record<string, unknown>;
    /** Bridge mode observes the application's DOM, since the HTTPS collector has no app DOM. */
    enhancedMeasurement?: EnhancedMeasurementOptions | false;
    /** Bridge mode sends one virtual page view for each mapped History route. */
    autoPageViews?: boolean;
    mapRoute?: (path: string) => string | null;
}
export declare function getOrCreateGoogleTag(): GoogleTag;
export declare function loadGoogleTag(measurementId: string, onLoad?: () => void): void;
/** Synchronize Google's hard disable flag with the HTTPS collector as well as this document. */
export declare function setGoogleTagEnabled(measurementId: string, enabled: boolean): void;
/**
 * Official gtag transport for applications that already own identity and event policy.
 * Automatic and enhanced measurement remain owned by Google and the GA4 stream settings.
 * Callers must supply safe page metadata and non-identifying event parameters.
 */
export declare class GoogleAnalyticsClient {
    private readonly options;
    private initialized;
    private enabled;
    private clientId;
    private readonly id;
    private cleanup;
    private pageLocation?;
    private pageTitle?;
    constructor(options: GoogleAnalyticsOptions);
    initialize(): boolean;
    setClientId(clientId: string): boolean;
    setEnabled(enabled: boolean): void;
    /** Native gtag command API; payloads and callbacks pass through unchanged. */
    gtag(...args: unknown[]): void;
    track(name: string, params?: Record<string, unknown>): void;
    private watchApplication;
    destroy(): void;
}
