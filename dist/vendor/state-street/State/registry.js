/**
 * Silent global registry of live State instances. Each State registers itself on
 * construction and receives a string id; that id is branded onto every element it
 * renders (the `stid` attribute). When a State mounts into an element owned by
 * another State, it looks the owner up here (by the element's `stid`) so it can ask
 * the parent to preserve the mounted element across re-renders.
 *
 * Transient States should call `state.destroy()` to unregister and avoid leaks.
 */
let counter = 0;
const states = new Map();
export function register(state) {
    const id = `${counter++}`;
    states.set(id, state);
    return id;
}
export function get(id) {
    return states.get(id);
}
export function unregister(id) {
    states.delete(id);
}
/** Iterate every currently-registered (live, non-destroyed) State instance. */
export function all() {
    return states.values();
}
