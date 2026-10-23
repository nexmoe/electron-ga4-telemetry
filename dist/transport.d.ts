import { BrowserWindow, type WebContents } from 'electron';
export interface GoogleTagTransportOptions {
    measurementId: string;
    /** Dedicated HTTPS origin owned by the application; served locally, never from the network. */
    origin: string;
    /** Explicitly trust application windows. Remote frames are always rejected. */
    isAllowedSender: (sender: WebContents) => boolean;
    /** A persistent, dedicated session keeps Google's own first-party cookies. */
    partition?: string;
}
/**
 * Run the unmodified official tag on HTTPS, independently of the app's custom protocol.
 * The application keeps its existing origin, storage and security settings.
 */
export declare function createGoogleTagTransport(options: GoogleTagTransportOptions): {
    ready: Promise<void>;
    dispose: () => void;
    collector: BrowserWindow;
};
