/**
 * Runtime bridge for the `omosuen` peer import used by omosuen-state-overlay.
 * TypeScript resolves types from the `omosuen` devDependency; webpack aliases
 * `omosuen` here so the UMD script in index.html stays the runtime engine.
 */
const engine = window.Omosuen;

export function registerPluginComponent(def: unknown): void {
  engine.registerPluginComponent(def);
}
