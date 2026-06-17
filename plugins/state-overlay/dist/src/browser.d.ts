import { registerStateBundle } from './component.js';
declare global {
    interface Window {
        Omosuen?: {
            registerPluginComponent?: (def: any) => void;
        };
        OmosuenStateOverlay?: {
            registerStateBundle: typeof registerStateBundle;
        };
    }
}
