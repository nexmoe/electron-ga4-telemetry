/** Shared IPC contract. All fields must be anonymous and low-cardinality. */
export type MetricValue = string | number | boolean;
export type MetricParams = Record<string, MetricValue>;
export type CampaignField = 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_id' | 'utm_content' | 'utm_term';
export type Campaign = Partial<Record<CampaignField, string>>;
export interface TelemetryEvent {
    name: string;
    params?: MetricParams;
}
export interface TelemetryContext {
    clientId: string;
    appVersion: string;
    platform: string;
    arch: string;
    osRelease: string;
    channel: string;
    firstInstall: boolean;
    previousVersion?: string;
    /** Milliseconds of process uptime at renderer setup, an approximate startup measurement. */
    startupMs: number;
    /** Only the campaign explicitly provided for THIS launch, not a historical first-touch campaign. */
    launchCampaign?: Campaign;
}
export interface TelemetryBridge {
    getContext(): Promise<TelemetryContext>;
    ready(enabled: boolean): void;
    setEnabled(enabled: boolean): void;
    onEvent(listener: (event: TelemetryEvent) => void): () => void;
    /** Accepts allowlisted UTM fields; no raw deep link is transmitted over IPC. */
    captureCampaign(campaign: Campaign): void;
    reportActivity(): void;
}
export declare const TELEMETRY_IPC: {
    readonly CONTEXT: 'electron-ga4:context';
    readonly READY: 'electron-ga4:ready';
    readonly ENABLED: 'electron-ga4:enabled';
    readonly EVENT: 'electron-ga4:event';
    readonly CAMPAIGN: 'electron-ga4:campaign';
    readonly ACTIVITY: 'electron-ga4:activity';
};
declare global {
    interface Window {
        electronTelemetry?: TelemetryBridge;
        dataLayer?: unknown[];
        gtag?: (...args: unknown[]) => void;
    }
}
