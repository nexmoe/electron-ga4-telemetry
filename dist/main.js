"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installMainTelemetry = installMainTelemetry;
const electron_1 = require("electron");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const core_1 = require("./core");
const shared_1 = require("./shared");
/** Attach to ONE primary BrowserWindow after app.whenReady(), before loadURL/loadFile. */
function installMainTelemetry(win, options = {}) {
    if (!electron_1.app.isReady())
        throw new Error('Call installMainTelemetry after app.whenReady()');
    const dir = electron_1.app.getPath('userData');
    (0, node_fs_1.mkdirSync)(dir, { recursive: true });
    const profilePath = (0, node_path_1.join)(dir, 'ga4-telemetry-profile.json');
    const pendingPath = (0, node_path_1.join)(dir, 'ga4-telemetry-pending.json');
    function readJson(path) {
        try {
            return JSON.parse((0, node_fs_1.readFileSync)(path, 'utf8'));
        }
        catch {
            return undefined;
        }
    }
    const raw = readJson(profilePath);
    const existingId = raw && typeof raw.clientId === 'string' && /^\d+\.\d+$/.test(raw.clientId);
    const version = electron_1.app.getVersion();
    const profile = {
        clientId: existingId ? raw.clientId : `${(0, node_crypto_1.randomInt)(100000000, 2147483647)}.${Math.floor(Date.now() / 1000)}`,
        installedAt: existingId && Number.isFinite(raw.installedAt) ? raw.installedAt : Date.now(),
        lastVersion: version,
        lastActiveDay: existingId && typeof raw.lastActiveDay === 'string' ? raw.lastActiveDay : undefined,
        firstCampaign: (0, core_1.parseCampaign)(existingId ? raw.firstCampaign : undefined),
        lastCampaign: (0, core_1.parseCampaign)(existingId ? raw.lastCampaign : undefined),
    };
    const firstInstall = !existingId;
    const previousVersion = existingId && typeof raw.lastVersion === 'string' ? raw.lastVersion : undefined;
    const channel = (0, core_1.safeToken)(options.channel ?? 'stable', 30) ?? 'stable';
    let currentCampaign = (0, core_1.parseCampaign)(options.initialCampaign);
    let enabled = options.enabled ?? false;
    let rendererReady = false;
    let disposed = false;
    let reportedLaunch = false;
    let persisted = existingId ?? false;
    let startupMs;
    const maxPending = 80;
    let pending = [];
    const queued = readJson(pendingPath);
    if (Array.isArray(queued)) {
        pending = queued.slice(-maxPending).flatMap((item) => {
            if (!item || typeof item !== 'object' || !('name' in item) ||
                typeof item.name !== 'string' || !core_1.VALID_EVENT.test(item.name))
                return [];
            return [{ name: item.name, params: (0, core_1.cleanParams)('params' in item ? item.params : undefined) }];
        });
    }
    function saveProfile() {
        if (!enabled)
            return;
        try {
            (0, node_fs_1.writeFileSync)(profilePath, JSON.stringify(profile), 'utf8');
            persisted = true;
        }
        catch { /* Do not crash the application when userData is read-only. */ }
    }
    function saveQueue() {
        try {
            (0, node_fs_1.writeFileSync)(pendingPath, JSON.stringify(pending.slice(-maxPending)), 'utf8');
        }
        catch { /* Telemetry must remain best-effort. */ }
    }
    if (enabled)
        saveProfile();
    function track(name, params = {}) {
        if (!enabled || disposed || !core_1.VALID_EVENT.test(name))
            return;
        const event = { name, params: (0, core_1.cleanParams)(params) };
        if (rendererReady && !win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send(shared_1.TELEMETRY_IPC.EVENT, event);
        }
        else {
            pending.push(event);
            pending = pending.slice(-maxPending);
            saveQueue();
        }
    }
    function storeCampaign(campaign, touch) {
        if (!enabled)
            return;
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
        if (!enabled || win.isDestroyed() || !win.isVisible() || !win.isFocused())
            return;
        const now = Date.now();
        if (!sessionStarted || now - lastSessionActivity >= sessionIdle) {
            track('desktop_session_start', { session_type: sessionStarted ? 'resumed_after_idle' : 'launch' });
            sessionStarted = true;
        }
        lastSessionActivity = now;
        const day = (0, core_1.localDay)(now);
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
        if (reportedLaunch || !enabled)
            return;
        reportedLaunch = true;
        if (currentCampaign)
            storeCampaign(currentCampaign, 'launch');
        track('app_launch', { startup_ms: startupMs ?? Math.round(process.uptime() * 1000) });
        if (firstInstall)
            track('desktop_first_install');
        if (previousVersion && previousVersion !== version) {
            track('desktop_updated', { previous_version: previousVersion });
        }
        noteForegroundActivity();
    }
    function checkSender(sender) {
        return !disposed && !win.isDestroyed() && !win.webContents.isDestroyed() && sender.id === win.webContents.id;
    }
    const onContext = (event) => {
        if (!checkSender(event.sender))
            throw new Error('Unauthorized telemetry request');
        startupMs ??= Math.round(process.uptime() * 1000);
        return {
            clientId: profile.clientId, appVersion: version, platform: process.platform,
            arch: process.arch,
            osRelease: process.getSystemVersion?.() ?? (0, node_os_1.release)(),
            channel, firstInstall,
            previousVersion, startupMs, launchCampaign: currentCampaign,
        };
    };
    electron_1.ipcMain.handle(shared_1.TELEMETRY_IPC.CONTEXT, onContext);
    const onReady = (event, allow) => {
        if (!checkSender(event.sender))
            return;
        enabled = allow === true;
        rendererReady = enabled;
        if (!enabled) {
            pending = [];
            saveQueue();
            return;
        }
        if (!persisted)
            saveProfile();
        const replay = pending;
        pending = [];
        saveQueue();
        for (const event of replay)
            win.webContents.send(shared_1.TELEMETRY_IPC.EVENT, event);
        reportLaunch();
        noteForegroundActivity();
    };
    const onEnabled = (event, allow) => {
        if (!checkSender(event.sender))
            return;
        enabled = allow === true;
        rendererReady = enabled;
        if (!enabled) {
            pending = [];
            saveQueue();
            return;
        }
        saveProfile();
        reportLaunch();
        noteForegroundActivity();
    };
    const onCampaign = (event, campaign) => {
        if (!checkSender(event.sender) || !enabled)
            return;
        const parsed = (0, core_1.parseCampaign)(campaign);
        if (parsed)
            storeCampaign(parsed, 'deeplink');
    };
    const onActivity = (event) => {
        if (checkSender(event.sender))
            noteForegroundActivity();
    };
    electron_1.ipcMain.on(shared_1.TELEMETRY_IPC.READY, onReady);
    electron_1.ipcMain.on(shared_1.TELEMETRY_IPC.ENABLED, onEnabled);
    electron_1.ipcMain.on(shared_1.TELEMETRY_IPC.CAMPAIGN, onCampaign);
    electron_1.ipcMain.on(shared_1.TELEMETRY_IPC.ACTIVITY, onActivity);
    function onFocus() { track('window_focus'); noteForegroundActivity(); }
    function onBlur() { track('window_blur'); }
    function onMinimize() { track('window_minimize'); }
    function onRestore() { track('window_restore'); noteForegroundActivity(); }
    function onStartLoading() { rendererReady = false; }
    function onRendererGone(_event, detail) {
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
    let resourceTimer;
    if (options.sampleResources) {
        const interval = Math.max(60_000, options.resourceIntervalMs ?? 300_000);
        resourceTimer = setInterval(() => {
            if (!enabled || win.isDestroyed() || !win.isVisible() || !win.isFocused())
                return;
            if (Date.now() - lastSessionActivity >= 60_000)
                return; // No idle keep-alive telemetry.
            try {
                const processes = electron_1.app.getAppMetrics();
                const memoryKiB = processes.reduce((n, p) => n + (p.memory?.workingSetSize ?? 0), 0);
                const cpu = processes.reduce((n, p) => n + (p.cpu?.percentCPUUsage ?? 0), 0);
                track('app_resource_sample', {
                    memory_mb: Math.round(memoryKiB / 1024),
                    cpu_percent: Math.round(cpu * 10) / 10,
                    process_count: processes.length,
                });
            }
            catch { /* System counters aren't available on every platform/release. */ }
        }, interval);
    }
    /** Call when your app receives an attributed install URL or a marketing deep link. */
    function captureAttribution(input) {
        const campaign = (0, core_1.parseCampaign)(input);
        if (!campaign)
            return false;
        currentCampaign = campaign;
        if (enabled)
            storeCampaign(campaign, 'deeplink');
        return true;
    }
    function dispose() {
        if (disposed)
            return;
        disposed = true;
        if (resourceTimer)
            clearInterval(resourceTimer);
        win.removeListener('focus', onFocus);
        win.removeListener('blur', onBlur);
        win.removeListener('minimize', onMinimize);
        win.removeListener('restore', onRestore);
        if (!win.webContents.isDestroyed()) {
            win.webContents.removeListener('did-start-loading', onStartLoading);
            win.webContents.removeListener('render-process-gone', onRendererGone);
        }
        electron_1.ipcMain.removeHandler(shared_1.TELEMETRY_IPC.CONTEXT);
        electron_1.ipcMain.removeListener(shared_1.TELEMETRY_IPC.READY, onReady);
        electron_1.ipcMain.removeListener(shared_1.TELEMETRY_IPC.ENABLED, onEnabled);
        electron_1.ipcMain.removeListener(shared_1.TELEMETRY_IPC.CAMPAIGN, onCampaign);
        electron_1.ipcMain.removeListener(shared_1.TELEMETRY_IPC.ACTIVITY, onActivity);
        saveQueue();
    }
    return { track, captureAttribution, dispose };
}
