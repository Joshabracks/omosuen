/** Official Omosuen plugin component packages (under `plugins/<id>/`). */

export interface PluginDocEntry {
  id: string;
  title: string;
  blurb: string;
  npmPackage: string;
  version: string;
  /** Git tag for `npm i github:joshabracks/omosuen#<releaseTag>`. */
  releaseTag: string;
  /** Self-registering browser bundle filename (GitHub Release asset). */
  umdFile: string;
  /** Named export passed to `Omosuen.init({ plugins: [...] })`. */
  definitionExport: string;
  /** Optional convenience register helper from the ESM entry. */
  registerFn?: string;
  /** Extra symbols to show on the ESM import line. */
  esmImports?: string[];
  /** Global exposed by the UMD bundle after load (if any). */
  umdGlobal?: string;
  /** Extra UMD-only API note (HTML snippet). */
  umdExtra?: string;
}

const GITHUB_REPO = "https://github.com/Joshabracks/omosuen";

export const OFFICIAL_PLUGINS: PluginDocEntry[] = [
  {
    id: "state-overlay",
    title: "state-overlay",
    blurb:
      "Reactive DOM overlays powered by&nbsp;<a href=\"https://joshabracks.github.io/State-Street/\" target=\"_blank\" rel=\"noopener noreferrer\">State Street</a>, driven by the Omosuen engine loop instead of a second requestAnimationFrame.",
    npmPackage: "omosuen-state-overlay",
    version: "0.0.6",
    releaseTag: "state-overlay0.0.6",
    umdFile: "state-overlay.plugin.js",
    definitionExport: "stateOverlayDefinition",
    registerFn: "registerStateOverlay",
    esmImports: ["registerStateBundle"],
    umdGlobal: "OmosuenStateOverlay",
    umdExtra:
      "After loading the plugin script,&nbsp;<code>window.OmosuenStateOverlay.registerStateBundle(key, bundle)</code>&nbsp;registers reactive UI bundles before the scene loads.",
  },
  {
    id: "aseprite-loader",
    title: "aseprite-loader",
    blurb:
      "Ingests&nbsp;<a href=\"https://www.aseprite.org/\" target=\"_blank\" rel=\"noopener noreferrer\">Aseprite</a>&nbsp;(.aseprite / .ase) files into layered, animated entities with shared atlases and animation maps.",
    npmPackage: "omosuen-aseprite-loader",
    version: "0.3.0",
    releaseTag: "aseprite-loader0.3.0",
    umdFile: "aseprite-loader.plugin.js",
    definitionExport: "asepriteLoaderDefinition",
    registerFn: "registerAsepriteLoader",
    esmImports: ["importAseprite", "parseAseprite"],
  },
  {
    id: "browser-local-storage",
    title: "browser-local-storage",
    blurb:
      "Persists game state to browser storage (localStorage, sessionStorage, IndexedDB, cookies) with optional data-layer mirroring and nexus snapshots.",
    npmPackage: "omosuen-browser-local-storage",
    version: "0.1.0",
    releaseTag: "browser-local-storage0.1.0",
    umdFile: "browser-local-storage.plugin.js",
    definitionExport: "browserLocalStorageDefinition",
    registerFn: "registerBrowserLocalStorage",
  },
  {
    id: "perf-monitor",
    title: "perf-monitor",
    blurb:
      "On-screen frame profiler HUD &mdash; FPS, phase timing, and per-component-type cost &mdash; with a hotkey toggle and a JSON snapshot export for bug reports.",
    npmPackage: "omosuen-perf-monitor",
    version: "0.1.0",
    releaseTag: "perf-monitor0.1.0",
    umdFile: "perf-monitor.plugin.js",
    definitionExport: "perfMonitorDefinition",
    registerFn: "registerPerfMonitor",
    esmImports: ["exportPerfSnapshot"],
    umdGlobal: "OmosuenPerfMonitor",
    umdExtra:
      "After loading the plugin script,&nbsp;<code>window.OmosuenPerfMonitor.exportPerfSnapshot()</code>&nbsp;logs a console.table of per-component-type cost and downloads a JSON snapshot of the retained frame history.",
  },
];

const byId = new Map(OFFICIAL_PLUGINS.map((p) => [p.id, p]));

export function getPluginDoc(id: string): PluginDocEntry | undefined {
  return byId.get(id);
}

export function isValidPluginDocId(id: string): boolean {
  return byId.has(id);
}

export function pluginReleaseUrl(entry: PluginDocEntry): string {
  return `${GITHUB_REPO}/releases/tag/${entry.releaseTag}`;
}

export function pluginNpmInstall(entry: PluginDocEntry): string {
  return `npm i github:joshabracks/omosuen#${entry.releaseTag}`;
}
