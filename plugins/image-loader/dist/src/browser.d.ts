declare global {
    interface Window {
        Omosuen?: {
            registerPluginComponent?: (def: any) => void;
        };
    }
}
export {};
