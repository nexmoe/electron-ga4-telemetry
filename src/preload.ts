import { contextBridge, ipcRenderer } from 'electron';
import {
  TELEMETRY_IPC,
  type Campaign,
  type TelemetryBridge,
  type TelemetryContext,
  type TelemetryEvent,
} from './shared';
import { parseCampaign } from './core';

/** Add to your existing preload entrypoint; keep contextIsolation=true and nodeIntegration=false. */
export function installTelemetryPreload() {
  const bridge: TelemetryBridge = {
    getContext: () => ipcRenderer.invoke(TELEMETRY_IPC.CONTEXT) as Promise<TelemetryContext>,
    ready: (enabled: boolean) => ipcRenderer.send(TELEMETRY_IPC.READY, enabled === true),
    setEnabled: (enabled: boolean) => ipcRenderer.send(TELEMETRY_IPC.ENABLED, enabled === true),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TelemetryEvent) => listener(payload);
      ipcRenderer.on(TELEMETRY_IPC.EVENT, handler);
      return () => ipcRenderer.removeListener(TELEMETRY_IPC.EVENT, handler);
    },
    captureCampaign: (campaign: Campaign) => {
      const parsed = parseCampaign(campaign);
      if (parsed) ipcRenderer.send(TELEMETRY_IPC.CAMPAIGN, parsed);
    },
    reportActivity: () => ipcRenderer.send(TELEMETRY_IPC.ACTIVITY),
  };
  contextBridge.exposeInMainWorld('electronTelemetry', bridge);
}
