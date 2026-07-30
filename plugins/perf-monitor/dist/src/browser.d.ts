import { exportPerfSnapshot } from './index.js';
declare global {
    interface Window {
        Omosuen?: {
            registerPluginComponent?: (def: any) => void;
        };
        OmosuenPerfMonitor?: {
            exportPerfSnapshot: typeof exportPerfSnapshot;
        };
    }
}
