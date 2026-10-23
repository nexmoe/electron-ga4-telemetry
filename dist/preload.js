"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installTelemetryPreload = installTelemetryPreload;
const electron_1 = require("electron");
const shared_1 = require("./shared");
const core_1 = require("./core");
/** Add to your existing preload entrypoint; keep contextIsolation=true and nodeIntegration=false. */
function installTelemetryPreload() {
    const bridge = {
        getContext: () => electron_1.ipcRenderer.invoke(shared_1.TELEMETRY_IPC.CONTEXT),
        ready: (enabled) => electron_1.ipcRenderer.send(shared_1.TELEMETRY_IPC.READY, enabled === true),
        setEnabled: (enabled) => electron_1.ipcRenderer.send(shared_1.TELEMETRY_IPC.ENABLED, enabled === true),
        onEvent: (listener) => {
            const handler = (_event, payload) => listener(payload);
            electron_1.ipcRenderer.on(shared_1.TELEMETRY_IPC.EVENT, handler);
            return () => electron_1.ipcRenderer.removeListener(shared_1.TELEMETRY_IPC.EVENT, handler);
        },
        captureCampaign: (campaign) => {
            const parsed = (0, core_1.parseCampaign)(campaign);
            if (parsed)
                electron_1.ipcRenderer.send(shared_1.TELEMETRY_IPC.CAMPAIGN, parsed);
        },
        reportActivity: () => electron_1.ipcRenderer.send(shared_1.TELEMETRY_IPC.ACTIVITY),
    };
    electron_1.contextBridge.exposeInMainWorld('electronTelemetry', bridge);
}
