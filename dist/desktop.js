"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDesktopGoogleAnalytics = getDesktopGoogleAnalytics;
const gtag_1 = require("./gtag");
const CLIENTS = Symbol.for('electron-ga4.desktop.clients');
class DesktopClient extends gtag_1.GoogleAnalyticsClient {
    unregister;
    constructor(options, unregister) {
        super(options);
        this.unregister = unregister;
    }
    destroy() {
        super.destroy();
        this.unregister();
    }
}
/**
 * One client per window/stream, including module reloads. The first call owns configuration;
 * use the client's methods for consent, enabled state and verified identity updates.
 * Creating a client does not start collection; initialize(), track() or gtag() does.
 */
function getDesktopGoogleAnalytics(options) {
    const target = window;
    const clients = (target[CLIENTS] ??= new Map());
    const id = options.measurementId.toUpperCase();
    const existing = clients.get(id);
    if (existing)
        return existing;
    const client = new DesktopClient({
        ...options,
        enabled: options.enabled ?? true,
        clientIdStorageKey: options.clientIdStorageKey ?? `electron-ga4:${id}:client-id`,
        enhancedMeasurement: options.enhancedMeasurement === false
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
    }, () => {
        if (clients.get(id) === client)
            clients.delete(id);
    });
    clients.set(id, client);
    return client;
}
