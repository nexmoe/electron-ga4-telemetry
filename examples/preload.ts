import { installTelemetryPreload } from 'electron-ga4-telemetry/preload';

// Add this to your existing preload, keeping contextIsolation=true and nodeIntegration=false.
installTelemetryPreload();
