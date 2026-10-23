import { contextBridge, ipcRenderer } from 'electron';
import type { NativeMeasurementEvent } from './links';

/** Add to the application's existing preload; no privileged Electron API is exposed. */
export function installGoogleTagPreload(
  options: { autoInitialize?: boolean } = {},
): void {
  const ready = new Promise<string | null>((resolve) => {
    if (options.autoInitialize === false) {
      resolve(null);
      return;
    }
    const initialize = () => {
      void ipcRenderer
        .invoke('electron-ga4:initialize')
        .then(resolve, () => resolve(null));
    };
    // Wait for navigation to commit and application window registration to finish.
    if (document.readyState === 'loading')
      window.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
  });
  contextBridge.exposeInMainWorld('electronGoogleTag', {
    ready: () => ready,
    send: (args: unknown[]) => ipcRenderer.invoke('electron-ga4:command', args),
    onNativeEvent: (callback: (event: NativeMeasurementEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        value: NativeMeasurementEvent,
      ) => callback(value);
      ipcRenderer.on('electron-ga4:native-event', listener);
      return () =>
        ipcRenderer.removeListener('electron-ga4:native-event', listener);
    },
  });
}
