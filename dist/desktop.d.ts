import { GoogleAnalyticsClient, type GoogleAnalyticsOptions } from './gtag';
export interface DesktopGoogleAnalyticsOptions extends GoogleAnalyticsOptions {
    /** Synthetic HTTPS page belonging to the application's transport origin. */
    pageLocation: string;
    /** Defaults to native GA4 metadata. Redacted mode requires marked forms/videos. */
    privacy?: 'native' | 'redacted';
}
/**
 * One client per window/stream, including module reloads. The first call owns configuration;
 * use the client's methods for consent, enabled state and verified identity updates.
 * Creating a client does not start collection; initialize(), track() or gtag() does.
 */
export declare function getDesktopGoogleAnalytics(options: DesktopGoogleAnalyticsOptions): GoogleAnalyticsClient;
