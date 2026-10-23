import { contextBridge, ipcRenderer } from 'electron';
import type { NativeMeasurementEvent } from './links';

/** Add to the application's existing preload; no privileged Electron API is exposed. */
export function installGoogleTagPreload(): void {
  contextBridge.exposeInMainWorld('electronGoogleTag', {
    send: (args: unknown[]) => ipcRenderer.invoke('electron-ga4:command', args),
    onNativeEvent: (callback: (event: NativeMeasurementEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: NativeMeasurementEvent) => callback(value);
      ipcRenderer.on('electron-ga4:native-event', listener);
      return () => ipcRenderer.removeListener('electron-ga4:native-event', listener);
    },
  });
}
