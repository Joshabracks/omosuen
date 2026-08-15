import type { ComponentTypeDefinition } from './component/registry';
import type { COMPONENT_TYPE } from './component/types';

/**
 * Global configuration for Omosuen engine
 */
export interface OmosuenConfig {
  /**
   * Maximum number of times a log message can appear before being suppressed.
   * Set to 0 to disable suppression.
   * @default 0 (no suppression)
   */
  logSuppression?: number;

  /**
   * Plugin components to register during `init`. Each entry is either:
   * - a {@link ComponentTypeDefinition} — registered directly, or
   * - a string filepath to a self-registering JS file — executed after the
   *   `Omosuen` global is mounted; the file calls `registerPluginComponent`.
   * Entries that are neither are skipped with a warning.
   */
  plugins?: (ComponentTypeDefinition | string)[];

  /**
   * Per-type override for the general component lookup registry's opt-in
   * decision (see `component/component-lookup-registry.ts`). `true` forces a
   * type into the registry (fast `getComponentByType`/`getComponentsByType`/
   * `getComponentByTypeAndName`/`getComponentsByTypeAndName` lookups); `false`
   * forces it out, even if it's in the engine's built-in default list or is
   * `ComponentUnique.GLOBAL`. Omit a type to use the built-in default.
   */
  componentRegistrationOverrideList?: Partial<Record<COMPONENT_TYPE, boolean>>;
}

/**
 * Internal state for the global config
 */
let globalConfig: OmosuenConfig = {
  logSuppression: 0,
};

/**
 * Get the current global configuration
 */
export function getConfig(): Readonly<OmosuenConfig> {
  return { ...globalConfig };
}

/**
 * Update the global configuration
 */
export function setConfig(config: Partial<OmosuenConfig>): void {
  globalConfig = { ...globalConfig, ...config };

  // Apply log suppression if configured
  if (
    globalConfig.logSuppression !== undefined &&
    globalConfig.logSuppression > 0
  ) {
    setupLogSuppression(globalConfig.logSuppression);
  } else {
    restoreOriginalConsole();
  }
}

/**
 * Log message tracking
 */
const logCounts = new Map<string, number>();

/**
 * Original console methods (stored for restoration)
 */
let originalConsole: {
  log: typeof console.log;
  warn: typeof console.warn;
  error: typeof console.error;
  info: typeof console.info;
} | null = null;

/**
 * Creates a suppressed version of a console method
 */
function createSuppressedMethod(
  originalMethod: (...args: unknown[]) => void,
  maxCount: number,
): (...args: unknown[]) => void {
  return function (...args: unknown[]) {
    // Create a unique key for this log message
    const key = args.map((arg) => String(arg)).join(' ');

    // Get current count
    const count = logCounts.get(key) || 0;

    // If we haven't exceeded the limit, log it
    if (count < maxCount) {
      logCounts.set(key, count + 1);
      originalMethod.apply(console, args);

      // If this is the last time we'll show it, add a note
      if (count + 1 === maxCount) {
        originalMethod.apply(console, [
          `[LOG SUPPRESSION] Above message will be suppressed from now on`,
        ]);
      }
    }
    // Otherwise, suppress it (do nothing)
  };
}

/**
 * Setup log suppression by overriding console methods
 */
function setupLogSuppression(maxCount: number): void {
  // Only setup once
  if (originalConsole !== null) {
    return;
  }

  // Store original methods
  originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };

  // Override console methods
  console.log = createSuppressedMethod(originalConsole.log, maxCount);
  console.warn = createSuppressedMethod(originalConsole.warn, maxCount);
  console.error = createSuppressedMethod(originalConsole.error, maxCount);
  console.info = createSuppressedMethod(originalConsole.info, maxCount);
}

/**
 * Restore original console methods
 */
function restoreOriginalConsole(): void {
  if (originalConsole === null) {
    return;
  }

  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.info = originalConsole.info;

  originalConsole = null;
  logCounts.clear();
}
