import { type BrowserWindow } from 'electron';
import { type Campaign, type MetricParams } from './shared';
export interface MainTelemetryOptions {
    /** Persisted consent. Opt-in required; default false. Pass the same preference to Renderer. */
    enabled?: boolean;
    /** Application release channel, e.g. stable/beta. */
    channel?: string;
    /** Current-launch or installer campaign. Never pass a historical campaign on every launch. */
    initialCampaign?: string | URL | Campaign;
    /** Optional 5-minute app-wide resource sample while foregrounded. Default false. */
    sampleResources?: boolean;
    resourceIntervalMs?: number;
    /** A desktop-defined session starts after >=30 minutes without foreground activity. */
    sessionIdleMs?: number;
}
/** Attach to ONE primary BrowserWindow after app.whenReady(), before loadURL/loadFile. */
export declare function installMainTelemetry(win: BrowserWindow, options?: MainTelemetryOptions): {
    track: (name: string, params?: MetricParams) => void;
    captureAttribution: (input: string | URL | Campaign) => boolean;
    dispose: () => void;
};
