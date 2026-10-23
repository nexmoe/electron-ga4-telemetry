import { app, ipcMain, type BrowserWindow } from 'electron';
import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { cleanParams, localDay, parseCampaign, safeToken, VALID_EVENT } from './core';
import {
  TELEMETRY_IPC,
  type Campaign,
  type MetricParams,
  type TelemetryContext,
  type TelemetryEvent,
} from './shared';

interface DiskProfile {
  clientId: string;
  installedAt: number;
  lastVersion: string;
  lastActiveDay?: string;
  firstCampaign?: Campaign;
  lastCampaign?: Campaign;
}

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
export function installMainTelemetry(win: BrowserWindow, options: MainTelemetryOptions = {}) {
  if (!app.isReady()) throw new Error('Call installMainTelemetry after app.whenReady()');
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  const profilePath = join(dir, 'ga4-telemetry-profile.json');
  const pendingPath = join(dir, 'ga4-telemetry-pending.json');

  function readJson(path: string): unknown {
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; }
  }
  const raw = readJson(profilePath) as Partial<DiskProfile> | undefined;
  const existingId = raw && typeof raw.clientId === 'string' && /^\d+\.\d+$/.test(raw.clientId);
  const version = app.getVersion();
  const profile: DiskProfile = {
    clientId: existingId ? raw!.clientId! : `${randomInt(100000000, 2147483647)}.${Math.floor(Date.now() / 1000)}`,
    installedAt: existingId && Number.isFinite(raw!.installedAt) ? raw!.installedAt! : Date.now(),
    lastVersion: version,
    lastActiveDay: existingId && typeof raw!.lastActiveDay === 'string' ? raw!.lastActiveDay : undefined,
    firstCampaign: parseCampaign(existingId ? raw!.firstCampaign : undefined),
    lastCampaign: parseCampaign(existingId ? raw!.lastCampaign : undefined),
  };
  const firstInstall = !existingId;
  const previousVersion = existingId && typeof raw!.lastVersion === 'string' ? raw!.lastVersion : undefined;
  const channel = safeToken(options.channel ?? 'stable', 30) ?? 'stable';
  let currentCampaign = parseCampaign(options.initialCampaign);
  let enabled = options.enabled ?? false;
  let rendererReady = false;
  let disposed = false;
  let reportedLaunch = false;
  let persisted = existingId ?? false;
  let startupMs: number | undefined;
  const maxPending = 80;
  let pending: TelemetryEvent[] = [];
  const queued = readJson(pendingPath);
  if (Array.isArray(queued)) {
    pending = queued.slice(-maxPending).flatMap((item: unknown): TelemetryEvent[] => {
      if (!item || typeof item !== 'object' || !('name' in item) ||
          typeof item.name !== 'string' || !VALID_EVENT.test(item.name)) return [];
      return [{ name: item.name, params: cleanParams('params' in item ? item.params : undefined) }];
    });
  }

  function saveProfile() {
    if (!enabled) return;
    try {
      writeFileSync(profilePath, JSON.stringify(profile), 'utf8');
      persisted = true;
    } catch { /* Do not crash the application when userData is read-only. */ }
  }
  function saveQueue() {
    try { writeFileSync(pendingPath, JSON.stringify(pending.slice(-maxPending)), 'utf8'); }
    catch { /* Telemetry must remain best-effort. */ }
  }
  if (enabled) saveProfile();

  function track(name: string, params: MetricParams = {}) {
    if (!enabled || disposed || !VALID_EVENT.test(name)) return;
    const event: TelemetryEvent = { name, params: cleanParams(params) };
    if (rendererReady && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(TELEMETRY_IPC.EVENT, event);
    } else {
      pending.push(event);
      pending = pending.slice(-maxPending);
      saveQueue();
    }
  }

  function storeCampaign(campaign: Campaign, touch: 'launch' | 'deeplink') {
    if (!enabled) return;
    profile.firstCampaign ??= campaign;
    profile.lastCampaign = campaign;
    saveProfile();
    // The renderer applies campaign_* to gtag before sending the event.
    track('desktop_attribution', {
      ...campaign,
      touch_type: touch,
      attribution_known: true,
    });
  }

  let lastSessionActivity = 0;
  let sessionStarted = false;
  const sessionIdle = Math.max(60_000, options.sessionIdleMs ?? 30 * 60_000);
  function noteForegroundActivity() {
    if (!enabled || win.isDestroyed() || !win.isVisible() || !win.isFocused()) return;
    const now = Date.now();
    if (!sessionStarted || now - lastSessionActivity >= sessionIdle) {
      track('desktop_session_start', { session_type: sessionStarted ? 'resumed_after_idle' : 'launch' });
      sessionStarted = true;
    }
    lastSessionActivity = now;
    const day = localDay(now);
    if (profile.lastActiveDay !== day) {
      const returning = Boolean(profile.lastActiveDay);
      profile.lastActiveDay = day;
      saveProfile();
      track('desktop_daily_active', {
        returning_user: returning,
        days_since_install: Math.max(0, Math.floor((now - profile.installedAt) / 86_400_000)),
      });
    }
  }

  function reportLaunch() {
    if (reportedLaunch || !enabled) return;
    reportedLaunch = true;
    if (currentCampaign) storeCampaign(currentCampaign, 'launch');
    track('app_launch', { startup_ms: startupMs ?? Math.round(process.uptime() * 1000) });
    if (firstInstall) track('desktop_first_install');
    if (previousVersion && previousVersion !== version) {
      track('desktop_updated', { previous_version: previousVersion });
    }
    noteForegroundActivity();
  }

  function checkSender(sender: Electron.WebContents) {
    return !disposed && !win.isDestroyed() && !win.webContents.isDestroyed() && sender.id === win.webContents.id;
  }

  const onContext = (event: Electron.IpcMainInvokeEvent): TelemetryContext => {
    if (!checkSender(event.sender)) throw new Error('Unauthorized telemetry request');
    startupMs ??= Math.round(process.uptime() * 1000);
    return {
      clientId: profile.clientId, appVersion: version, platform: process.platform,
      arch: process.arch,
      osRelease: (process as NodeJS.Process & { getSystemVersion?: () => string }).getSystemVersion?.() ?? release(),
      channel, firstInstall,
      previousVersion, startupMs, launchCampaign: currentCampaign,
    };
  };
  ipcMain.handle(TELEMETRY_IPC.CONTEXT, onContext);

  const onReady = (event: Electron.IpcMainEvent, allow: unknown) => {
    if (!checkSender(event.sender)) return;
    enabled = allow === true;
    rendererReady = enabled;
    if (!enabled) { pending = []; saveQueue(); return; }
    if (!persisted) saveProfile();
    const replay = pending;
    pending = [];
    saveQueue();
    for (const event of replay) win.webContents.send(TELEMETRY_IPC.EVENT, event);
    reportLaunch();
    noteForegroundActivity();
  };
  const onEnabled = (event: Electron.IpcMainEvent, allow: unknown) => {
    if (!checkSender(event.sender)) return;
    enabled = allow === true;
    rendererReady = enabled;
    if (!enabled) { pending = []; saveQueue(); return; }
    saveProfile();
    reportLaunch();
    noteForegroundActivity();
  };
  const onCampaign = (event: Electron.IpcMainEvent, campaign: unknown) => {
    if (!checkSender(event.sender) || !enabled) return;
    const parsed = parseCampaign(campaign as Campaign);
    if (parsed) storeCampaign(parsed, 'deeplink');
  };
  const onActivity = (event: Electron.IpcMainEvent) => {
    if (checkSender(event.sender)) noteForegroundActivity();
  };
  ipcMain.on(TELEMETRY_IPC.READY, onReady);
  ipcMain.on(TELEMETRY_IPC.ENABLED, onEnabled);
  ipcMain.on(TELEMETRY_IPC.CAMPAIGN, onCampaign);
  ipcMain.on(TELEMETRY_IPC.ACTIVITY, onActivity);

  function onFocus() { track('window_focus'); noteForegroundActivity(); }
  function onBlur() { track('window_blur'); }
  function onMinimize() { track('window_minimize'); }
  function onRestore() { track('window_restore'); noteForegroundActivity(); }
  function onStartLoading() { rendererReady = false; }
  function onRendererGone(_event: Electron.Event, detail: Electron.RenderProcessGoneDetails) {
    rendererReady = false;
    if (detail.reason !== 'clean-exit') {
      // Queued to disk because the crashed Renderer cannot receive it.
      track('renderer_process_gone', { reason: detail.reason });
      track('exception', { description: 'renderer_process_gone', fatal: true });
    }
  }
  win.on('focus', onFocus);
  win.on('blur', onBlur);
  win.on('minimize', onMinimize);
  win.on('restore', onRestore);
  win.webContents.on('did-start-loading', onStartLoading);
  win.webContents.on('render-process-gone', onRendererGone);

  let resourceTimer: ReturnType<typeof setInterval> | undefined;
  if (options.sampleResources) {
    const interval = Math.max(60_000, options.resourceIntervalMs ?? 300_000);
    resourceTimer = setInterval(() => {
      if (!enabled || win.isDestroyed() || !win.isVisible() || !win.isFocused()) return;
      if (Date.now() - lastSessionActivity >= 60_000) return; // No idle keep-alive telemetry.
      try {
        const processes = app.getAppMetrics();
        const memoryKiB = processes.reduce((n, p) => n + (p.memory?.workingSetSize ?? 0), 0);
        const cpu = processes.reduce((n, p) => n + (p.cpu?.percentCPUUsage ?? 0), 0);
        track('app_resource_sample', {
          memory_mb: Math.round(memoryKiB / 1024),
          cpu_percent: Math.round(cpu * 10) / 10,
          process_count: processes.length,
        });
      } catch { /* System counters aren't available on every platform/release. */ }
    }, interval);
  }

  /** Call when your app receives an attributed install URL or a marketing deep link. */
  function captureAttribution(input: string | URL | Campaign) {
    const campaign = parseCampaign(input);
    if (!campaign) return false;
    currentCampaign = campaign;
    if (enabled) storeCampaign(campaign, 'deeplink');
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (resourceTimer) clearInterval(resourceTimer);
    win.removeListener('focus', onFocus);
    win.removeListener('blur', onBlur);
    win.removeListener('minimize', onMinimize);
    win.removeListener('restore', onRestore);
    if (!win.webContents.isDestroyed()) {
      win.webContents.removeListener('did-start-loading', onStartLoading);
      win.webContents.removeListener('render-process-gone', onRendererGone);
    }
    ipcMain.removeHandler(TELEMETRY_IPC.CONTEXT);
    ipcMain.removeListener(TELEMETRY_IPC.READY, onReady);
    ipcMain.removeListener(TELEMETRY_IPC.ENABLED, onEnabled);
    ipcMain.removeListener(TELEMETRY_IPC.CAMPAIGN, onCampaign);
    ipcMain.removeListener(TELEMETRY_IPC.ACTIVITY, onActivity);
    saveQueue();
  }
  return { track, captureAttribution, dispose };
}
