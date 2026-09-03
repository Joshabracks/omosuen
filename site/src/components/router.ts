import { parseSiteHash, sceneForView } from "../docs-routing";
import type { SiteCtx } from "../types";

let hashRouterBound = false;
let activeScene = "";
let sceneSwitchInFlight = false;

/**
 * Records which scene the engine is already running, so the reconciler below
 * has something to compare against. `getActiveScene()` cannot answer this: it
 * returns the scene's nexus, whose `name` is whatever the scene module chose,
 * not the key it was registered under.
 */
export function setActiveScene(name: string): void {
  activeScene = name;
}

/**
 * Brings the engine's active scene in line with the current view.
 *
 * `cell-map` is a process-wide singleton, so the landing hero and the Textris
 * demo cannot both be resident — reaching the demo is a scene switch, not a
 * component added to the existing scene. `switchScene` disposes everything in
 * the outgoing scene including the `state-overlay` that is rendering this very
 * call stack, so the switch is deferred out of the current render pass.
 */
function syncScene(view: SiteCtx["state"]["data"]["view"]): void {
  const wanted = sceneForView(view);
  if (sceneSwitchInFlight || activeScene === wanted) {
    return;
  }
  sceneSwitchInFlight = true;
  activeScene = wanted;
  queueMicrotask(() => {
    void window.Omosuen.switchScene(wanted).finally(() => {
      sceneSwitchInFlight = false;
    });
  });
}

/** Syncs view + docs component when the user uses hash links or history navigation. */
export function siteRouter(ctx: SiteCtx): string {
  if (typeof window === "undefined") {
    return "";
  }
  if (hashRouterBound) {
    // Re-entered after a scene switch remounted the overlay. The listener is
    // still attached; only the reconcile needs re-running.
    syncScene(ctx.state.data.view);
    return "";
  }
  hashRouterBound = true;

  const applyHash = (): void => {
    const parsed = parseSiteHash(window.location.hash);
    ctx.state.data.view = parsed.view;
    ctx.state.data.docsComponent = parsed.docsComponent;
    ctx.state.data.docsSidebarOpen = false;
    syncScene(parsed.view);
  };

  window.addEventListener("hashchange", applyHash);
  return "";
}
