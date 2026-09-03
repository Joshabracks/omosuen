// Installs the plugin's debugging entry points as bare `window` globals, so
// they can be called straight from the devtools console.
//
// This is a leaf module on purpose. The helpers themselves live in `index.ts`,
// which imports `component.ts` — so having `component.ts` import them back
// would close an import cycle. Instead `index.ts` hands them here at module
// scope (`setConsoleHelpers`) and `component.ts` only pulls the install/
// uninstall pair, which depends on nothing.
//
// Why the component drives this at all, rather than the browser build: a
// consumer that imports this package as an ESM module never loads
// `browser.ts`, so a global installed only there is missing for exactly the
// bundler-based projects most likely to want it. Tying installation to the
// perf-monitor component's lifecycle means the console helpers appear
// precisely when profiling does, whichever way the plugin was loaded.

type HelperMap = Record<string, unknown>;

let helpers: HelperMap = {};
/** Names this module actually installed, so uninstall leaves others alone. */
let installedNames: string[] = [];

/** Registers the functions to expose. Called once, at module scope, by index.ts. */
export function setConsoleHelpers(map: HelperMap): void {
  helpers = map;
}

/**
 * Publishes each registered helper on `window` under its own name. Never
 * clobbers an existing global — if the host page already defines one of these
 * names, that one wins and this module will not remove it later.
 */
export function installConsoleHelpers(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as HelperMap;
  for (const [name, fn] of Object.entries(helpers)) {
    if (w[name] === undefined) {
      w[name] = fn;
      installedNames.push(name);
    }
  }
}

/** Removes only the globals `installConsoleHelpers` actually added. */
export function uninstallConsoleHelpers(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as HelperMap;
  for (const name of installedNames) {
    delete w[name];
  }
  installedNames = [];
}
