"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installGoogleTagPreload = installGoogleTagPreload;
const electron_1 = require("electron");
/** Add to the application's existing preload; no privileged Electron API is exposed. */
function installGoogleTagPreload() {
    electron_1.contextBridge.exposeInMainWorld('electronGoogleTag', {
        send: (args) => electron_1.ipcRenderer.invoke('electron-ga4:command', args),
    });
}
