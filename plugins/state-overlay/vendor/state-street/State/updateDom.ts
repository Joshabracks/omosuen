import State from "./State.js";
import { SSID } from "./const.js";
import constructElement, { getValue, decodeEntities, unescapeQuotes, runComponent, parseComponentBody, setAttr, childNamespaceOf } from "./constructElement.js";
import { resolveImageSrc, isBase64DataUri } from "./imageCache.js";

const scrolledSSIDs = new Set<string>();
let scrollListenerInstalled = false;

function ensureScrollListener(): void {
  if (scrollListenerInstalled || typeof document === "undefined") return;
  scrollListenerInstalled = true;
  document.addEventListener(
    "scroll",
    (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const id = t.getAttribute(SSID);
      if (id) scrolledSSIDs.add(id);
    },
    { capture: true, passive: true }
  );
}

function captureScroll(componentSSID: string, state: State): Map<string, [number, number]> | null {
  if (scrolledSSIDs.size === 0) return null;
  let stash: Map<string, [number, number]> | null = null;
  scrolledSSIDs.forEach((id) => {
    if (!id.startsWith(componentSSID)) return;
    const el = state.idMap[id];
    if (!(el instanceof Element)) {
      scrolledSSIDs.delete(id);
      return;
    }
    if (el.scrollTop || el.scrollLeft) {
      if (!stash) stash = new Map();
      stash.set(id, [el.scrollTop, el.scrollLeft]);
    }
  });
  return stash;
}

function restoreScroll(stash: Map<string, [number, number]>, state: State): void {
  stash.forEach(([top, left], id) => {
    const el = state.idMap[id];
    if (el instanceof Element) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
  });
}

type FocusSnapshot = {
  ssid: string;
  selectionStart: number | null;
  selectionEnd: number | null;
};

function captureFocus(componentSSID: string): FocusSnapshot | null {
  const active = document.activeElement;
  if (!(active instanceof Element)) return null;
  const id = active.getAttribute(SSID);
  if (!id || !id.startsWith(componentSSID)) return null;
  let selectionStart: number | null = null;
  let selectionEnd: number | null = null;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    try {
      selectionStart = active.selectionStart;
      selectionEnd = active.selectionEnd;
    } catch (_) { /* selection unsupported on this input type */ }
  }
  return { ssid: id, selectionStart, selectionEnd };
}

function restoreFocus(snap: FocusSnapshot, state: State): void {
  const el = state.idMap[snap.ssid];
  if (!(el instanceof HTMLElement)) return;
  el.focus({ preventScroll: true });
  if (
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
    snap.selectionStart !== null
  ) {
    try {
      el.setSelectionRange(snap.selectionStart, snap.selectionEnd ?? snap.selectionStart);
    } catch (_) { /* selection unsupported on this input type */ }
  }
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const k of small) if (big.has(k)) return true;
  return false;
}

// Re-render a single component in place, within its existing comment-marker range.
// Returns true if the DOM was mutated (so callers know to restore scroll/focus).
function rebuildComponentRange(rec: any, ssid: string, state: State): boolean {
  const result = runComponent(rec.node, state);
  if (!result) return false;
  const { componentBody, deps } = result;
  rec.deps = deps;
  // Body unchanged -> existing rendered nodes are already correct/in place. No DOM work.
  if (rec.lastBody === componentBody) {
    rec.tick = state.tick;
    return false;
  }
  const parsedBody = parseComponentBody(componentBody, state);
  const parent = rec.startMarker.parentNode;
  if (!parent) return false;
  // Infer the namespace from where this component is mounted, so an independently
  // re-rendered sub-component inside an <svg> (e.g. one that returns naked <rect>…)
  // is rebuilt in the SVG namespace rather than reverting to HTML.
  const ns = childNamespaceOf(parent);
  // Build the fresh subtree first. constructElement transplants any reused nodeMap
  // nodes (img/input/textarea/select/canvas/video/audio/iframe) out of the live
  // range into this fragment via appendChild -- a move, not a destroy+recreate --
  // so their value/checked/selection/pixels/playback survive.
  const frag = document.createDocumentFragment();
  for (let i = 0; i < parsedBody.length; i++) {
    const subElement: any = constructElement(parsedBody[i], `${ssid}${i}`, state, ns);
    if (subElement) frag.appendChild(subElement);
  }
  // Remove the stale leftovers still between the markers, then insert the new nodes.
  while (rec.startMarker.nextSibling && rec.startMarker.nextSibling !== rec.endMarker) {
    parent.removeChild(rec.startMarker.nextSibling);
  }
  parent.insertBefore(frag, rec.endMarker);
  rec.lastBody = componentBody;
  rec.tick = state.tick;
  return true;
}

function updateDOM(state: State) {
  ensureScrollListener();
  state.tick++;
  // Visit every component outer -> inner (a parent's ssid is a strict prefix of its
  // children's, so sorting by length then lexicographically puts parents first) so
  // nested components are independently dep-gated and updated in place.
  const ssids = Object.keys(state.componentMap)
    .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 0; i < ssids.length; i++) {
    const ssid = ssids[i];
    const rec = state.componentMap[ssid];
    if (!rec) continue;
    // Skip components an ancestor's rebuild already removed (markers detached) or
    // already recreated (stamped with the current tick) this frame.
    if (!rec.startMarker.isConnected) continue;
    if (rec.tick === state.tick) continue;
    // Dep-gate: during a key-driven update, skip any component that can't be affected by a
    // dirty key. A component with a known-empty dep set reads nothing from state.data, so it
    // can only change when its parent rebuilds it -> it never needs an independent re-run.
    // (When dirtyKeys is empty this is a full refresh: fall through and re-run everything.)
    // (Value updates still flow via the textMap/attrMap passes below.)
    if (
      state.dirtyKeys.size &&
      rec.deps &&
      (rec.deps.size === 0 || !intersects(rec.deps, state.dirtyKeys))
    ) continue;
    const stash = captureScroll(ssid, state);
    const focusSnap = captureFocus(ssid);
    const changed = rebuildComponentRange(rec, ssid, state);
    if (changed) {
      if (stash) restoreScroll(stash, state);
      if (focusSnap) restoreFocus(focusSnap, state);
    }
  }
  const { textMap, dirtyKeys }: any = state;
  const hasDirtyFilter = dirtyKeys instanceof Set && dirtyKeys.size > 0;
  for (const id in textMap) {
    const entry = textMap[id];
    if (!entry) continue;
    const values = entry.values;
    if (hasDirtyFilter) {
      let touched = false;
      for (const key in values) {
        const root = key.split(".")[0];
        if (dirtyKeys.has(root)) {
          touched = true;
          break;
        }
      }
      if (!touched) continue;
    }
    let rendered = entry.template;
    for (const key in values) {
      const value = getValue(state.data, key.split("."));
      rendered = rendered.replace(`{{${key}}}`, value ?? "");
    }
    entry.node.nodeValue = rendered;
  }
  const { attrMap } = state;
  for (const id in attrMap) {
    const entry = attrMap[id];
    if (!entry) continue;
    if (!entry.element.isConnected) { delete attrMap[id]; continue; }
    const values = entry.values;
    if (hasDirtyFilter) {
      let touched = false;
      for (const key in values) {
        if (dirtyKeys.has(key.split(".")[0])) { touched = true; break; }
      }
      if (!touched) continue;
    }
    let rendered = entry.template;
    for (const key in values) {
      const value = getValue(state.data, key.split("."));
      rendered = rendered.replace(`{{${key}}}`, value ?? "");
    }
    const finalVal = entry.isImgSrc && isBase64DataUri(rendered)
      ? resolveImageSrc(rendered)
      : decodeEntities(unescapeQuotes(rendered));
    if (entry.element.getAttribute(entry.attrName) !== finalVal) {
      setAttr(entry.element, entry.attrName, finalVal);
    }
  }
  for (const ssid in state.nodeMap) {
    if (!state.nodeMap[ssid].isConnected) delete state.nodeMap[ssid];
  }
  // Drop component records whose range was removed this frame (and not rebuilt),
  // e.g. a conditional component that stopped rendering. Without the wrapper the
  // map is iterated directly, so stale entries must be pruned to avoid leaking.
  for (const ssid in state.componentMap) {
    const r = state.componentMap[ssid];
    if (!r.startMarker.isConnected && r.tick !== state.tick) delete state.componentMap[ssid];
  }
}

export default updateDOM;
