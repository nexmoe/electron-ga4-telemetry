/** Offline test-only type stub. npm install replaces it with Electron's actual types in consuming projects. */
declare namespace Electron {
  type Event = { preventDefault?(): void };
  interface WebContents { id: number; send(channel: string, data: unknown): void; isDestroyed(): boolean; on(event: string, listener: (...args: any[]) => void): unknown; removeListener(event: string, listener: (...args: any[]) => void): unknown; }
  interface IpcMainEvent { sender: WebContents }
  interface IpcMainInvokeEvent { sender: WebContents }
  interface IpcRendererEvent { sender?: WebContents }
  interface RenderProcessGoneDetails { reason: string }
}
declare module 'electron' {
  export const app: {
    isReady(): boolean; getPath(name: string): string; getVersion(): string;
    getAppMetrics(): Array<{ memory?: { workingSetSize?: number }, cpu?: { percentCPUUsage?: number } }>;
  };
  export const ipcMain: {
    handle(channel: string, cb: (event: Electron.IpcMainInvokeEvent) => unknown): void;
    removeHandler(channel: string): void;
    on(channel: string, cb: (...args: any[]) => void): void;
    removeListener(channel: string, cb: (...args: any[]) => void): void;
  };
  export const ipcRenderer: {
    invoke(channel: string): Promise<unknown>;
    send(channel: string, ...args: unknown[]): void;
    on(channel: string, listener: (...args: any[]) => void): void;
    removeListener(channel: string, listener: (...args: any[]) => void): void;
  };
  export const contextBridge: { exposeInMainWorld(key: string, value: unknown): void };
  export interface BrowserWindow {
    isDestroyed(): boolean; isVisible(): boolean; isFocused(): boolean;
    webContents: Electron.WebContents;
    on(event: string, listener: (...args: any[]) => void): void;
    removeListener(event: string, listener: (...args: any[]) => void): void;
  }
}
