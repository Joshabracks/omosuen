// Records which top-level `state.data` keys a component function reads while it
// runs, so the update loop can skip re-running components whose dependencies are
// all clean. Root-key granularity matches `state.dirtyKeys` (the reactive proxy
// reports mutations by their top-level key).
export function makeDepTracker(state: any): { trackedState: any; deps: Set<string> } {
  const deps = new Set<string>();
  const data = state.data;
  const dataProxy = new Proxy(data, {
    get(obj: any, key) {
      if (typeof key === "string") deps.add(key);
      return obj[key];
    },
  });
  const trackedState = new Proxy(state, {
    get(obj: any, key) {
      return key === "data" ? dataProxy : obj[key];
    },
  });
  return { trackedState, deps };
}
