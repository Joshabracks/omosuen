// Records which top-level `state.data` keys a component function reads while it
// runs, so the update loop can skip re-running components whose dependencies are
// all clean. Root-key granularity matches `state.dirtyKeys` (the reactive proxy
// reports mutations by their top-level key).
export function makeDepTracker(state) {
    const deps = new Set();
    const data = state.data;
    const dataProxy = new Proxy(data, {
        get(obj, key) {
            if (typeof key === "string")
                deps.add(key);
            return obj[key];
        },
    });
    const trackedState = new Proxy(state, {
        get(obj, key) {
            return key === "data" ? dataProxy : obj[key];
        },
    });
    return { trackedState, deps };
}
