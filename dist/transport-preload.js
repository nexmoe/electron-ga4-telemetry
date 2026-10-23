"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installGoogleTagPreload = installGoogleTagPreload;
const electron_1 = require("electron");
/** Add to the application's existing preload; no privileged Electron API is exposed. */
function installGoogleTagPreload(options = {}) {
    const ready = new Promise((resolve) => {
        if (options.autoInitialize === false) {
            resolve(null);
            return;
        }
        const initialize = () => {
            void electron_1.ipcRenderer
                .invoke('electron-ga4:initialize')
                .then(resolve, () => resolve(null));
        };
        // Wait for navigation to commit and application window registration to finish.
        if (document.readyState === 'loading')
            window.addEventListener('DOMContentLoaded', initialize, { once: true });
        else
            initialize();
    });
    electron_1.contextBridge.exposeInMainWorld('electronGoogleTag', {
        ready: () => ready,
        send: (args) => electron_1.ipcRenderer.invoke('electron-ga4:command', args),
        onNativeEvent: (callback) => {
            const listener = (_event, value) => callback(value);
            electron_1.ipcRenderer.on('electron-ga4:native-event', listener);
            return () => electron_1.ipcRenderer.removeListener('electron-ga4:native-event', listener);
        },
    });
}
