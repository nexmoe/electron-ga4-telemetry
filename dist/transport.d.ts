import type { DesktopGoogleAnalyticsOptions } from './desktop';
import { BrowserWindow, shell, type WebContents } from 'electron';
export type AutoRendererOptions = Omit<DesktopGoogleAnalyticsOptions, 'measurementId' | 'pageLocation' | 'mapRoute'> & {
    pageLocation?: string;
};
type RendererSetup = AutoRendererOptions | false | ((sender: WebContents) => AutoRendererOptions | false);
export interface GoogleTagTransportError extends Error {
    code: 'IDENTITY_STORAGE_FAILED' | 'IDENTITY_SYNC_FAILED' | 'COLLECTOR_LOAD_FAILED' | 'COLLECTOR_RECOVERY_EXHAUSTED';
}
export interface GoogleTagTransportOptions {
    measurementId: string;
    /** Dedicated HTTPS origin owned by the application; served locally, never from the network. */
    origin: string;
    /** Explicitly trust application windows. Remote frames are always rejected. */
    isAllowedSender: (sender: WebContents) => boolean;
    /** A persistent, dedicated session keeps Google's own first-party cookies. */
    partition?: string;
    /** Explicit HTTPS collection endpoints, e.g. a first-party GA4 server container. */
    additionalAllowedOrigins?: string[];
    /** Observe trusted app DownloadItems by default; set false to disable. */
    nativeDownloads?: boolean;
    /** Opt into automatic renderer setup. installGoogleAnalytics enables it by default. */
    renderer?: RendererSetup;
    /** Optional non-fatal diagnostics; messages exclude client IDs and user-data paths. */
    onError?: (error: GoogleTagTransportError) => void;
}
/**
 * Run the unmodified official tag on HTTPS, independently of the app's custom protocol.
 * The application keeps its existing origin, storage and security settings.
 */
export declare function createGoogleTagTransport(options: GoogleTagTransportOptions): {
    ready: Promise<void>;
    dispose: () => void;
    collector: BrowserWindow;
    recordExternalOpen: (sender: WebContents, url: string) => void;
    openExternal: (sender: WebContents, url: string, openOptions?: Parameters<typeof shell.openExternal>[1]) => Promise<void>;
    diagnostics: () => {
        identityPersistence: "unused" | "persisted" | "memory";
        collectorStatus: "ready" | "failed" | "loading" | "recovering" | "disposed";
        recoveryAttempts: number;
    };
};
export interface InstallGoogleAnalyticsOptions extends Omit<GoogleTagTransportOptions, 'origin' | 'isAllowedSender'> {
    /** Optional owned HTTPS collector origin; the default is served only inside the private session. */
    origin?: string;
    /** Explicitly trusted application document origins, e.g. app://desktop. No opaque/file origins. */
    appOrigins?: string[];
    /** Optional stricter application-window policy; combined with appOrigins when both are supplied. */
    isAllowedSender?: (sender: WebContents) => boolean;
}
/** Main + one preload call: initialize the official tag and application DOM adapters automatically. */
export declare function installGoogleAnalytics(options: InstallGoogleAnalyticsOptions): {
    ready: Promise<void>;
    dispose: () => void;
    collector: BrowserWindow;
    recordExternalOpen: (sender: WebContents, url: string) => void;
    openExternal: (sender: WebContents, url: string, openOptions?: Parameters<typeof shell.openExternal>[1]) => Promise<void>;
    diagnostics: () => {
        identityPersistence: "unused" | "persisted" | "memory";
        collectorStatus: "ready" | "failed" | "loading" | "recovering" | "disposed";
        recoveryAttempts: number;
    };
};
export {};
