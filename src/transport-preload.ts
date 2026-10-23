import { contextBridge, ipcRenderer } from 'electron';

/** Add to the application's existing preload; no privileged Electron API is exposed. */
export function installGoogleTagPreload(): void {
  contextBridge.exposeInMainWorld('electronGoogleTag', {
    send: (args: unknown[]) => ipcRenderer.invoke('electron-ga4:command', args),
  });
}
