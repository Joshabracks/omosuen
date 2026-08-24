import { all } from "./registry.js";
/**
 * A single shared MutationObserver that drives mountCheck() for every live State
 * instance that still needs it (waiting for a selector target to appear, or mounted
 * to a non-body target that could disappear) -- instead of each instance polling on
 * its own timer/frame. Lazily created on first need; never explicitly disconnected
 * (it lives and dies with the page, and costs nothing while the DOM is quiescent).
 */
let observer = null;
function tick() {
    for (const state of all()) {
        if (state.needsMountWatch())
            state.mountCheck();
    }
}
export function ensureMountWatcher() {
    if (observer || typeof document === "undefined" || typeof MutationObserver === "undefined")
        return;
    observer = new MutationObserver(tick);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
}
