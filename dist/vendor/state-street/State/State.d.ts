/**
 * Builds, renders and manages the DOM.
 * @param template SST-formatted template string.
 * @param data Reactive state. Mutations trigger dep-gated re-renders (when renderLoop is on).
 * @param components Component registry (`<Tag/>` -> function returning a template string).
 * @param methods Method registry (bound to `:event=name()` directives; `:raw=fn` formatters).
 * @param options Rendering + mounting options:
 *  - renderLoop: boolean (default true) — run an internal requestAnimationFrame loop.
 *  - targetFPS: number (default 60).
 *  - imgMemoryBudget: number (default 256MB) — image blob cache budget.
 *  - imgWarmPerFrame: number (default 4).
 *  - mountTarget: Element | string (default document.body) — where to mount. A string is
 *    treated as a CSS selector and re-resolved over time.
 *  - mountOnAvailable: boolean (default true) — for non-body targets: while the render loop
 *    runs, auto-mount when the target appears, dismount if it disappears, and re-mount when it
 *    returns. When false, mounting/dismounting is manual (see mountCheck()).
 */
export default class State {
    private _data;
    template: any;
    idMap: any;
    textMap: any;
    attrMap: any;
    nodeMap: any;
    dataMap: any;
    dirty: boolean;
    dirtyKeys: Set<string>;
    components: any;
    componentMap: any;
    methods: any;
    renderLoop: boolean;
    elementCount: number;
    tick: number;
    targetFPS: number;
    nextUpdate: number;
    updateInterval: number;
    imgWarmPerFrame: number;
    id: string;
    root: Element | null;
    mounted: boolean;
    mountTarget: Element | string;
    mountOnAvailable: boolean;
    preserveInParent: boolean;
    preserveSet: Set<string>;
    private looping;
    private _parentMount;
    constructor(template: string, data?: any, components?: any, methods?: any, options?: any);
    /**
     * The reactive state, a `Proxy` with two traps:
     * - **set** — writing a top-level key (`state.data.foo = bar`) marks `foo` dirty and schedules a
     *   re-render. Mutating into a nested object marks its *top-level* key dirty (replace to be safe).
     * - **get** — reading a key while a component runs records it as a dependency of that component.
     *   The read *is* the subscription: any `state.data.<key>` touched anywhere in the body (a
     *   conditional, a computed local, an existence check, or inside a `${}`) subscribes the
     *   component to that key — even if the value never appears in the output. Read only what you need.
     *
     * Prefer a `{{path}}` State Binding over `${state.data.x}` for reactive values: a binding patches
     * its own node in place, while `${}` re-runs the whole component on every change to what it read.
     */
    get data(): any;
    set data(next: any);
    /** True if State.data has no pending changes. */
    sameState: () => boolean;
    private clearDirty;
    setNextUpdate: () => void;
    private resetMaps;
    /** Resolve the configured mountTarget to a live element (or null). */
    private resolveTarget;
    /** Mount (build the template) into `el`, owning its contents. */
    private mount;
    /** Remove our rendered nodes and return to the unmounted state. */
    private dismount;
    /**
     * Reconcile mount state with the DOM. Dismounts if the current target is gone (root
     * detached, or a string selector no longer matches the mounted element); mounts if a
     * target is now available. Called automatically by the render loop (when
     * mountOnAvailable is on) and manually when renderLoop is off.
     */
    mountCheck: () => void;
    /** A single render tick (no self-reschedule — the loop drives it). */
    update: () => void;
    /** The requestAnimationFrame driver. Self-stops when renderLoop is turned off. */
    private loop;
    forceUpdate: () => void;
    /** Toggle preservation of the element at `ssid` (used by nested States). */
    togglePreserve: (ssid: string, on?: boolean) => void;
    /** Change the mount target: dismount, set, and re-mount if the new target is found. */
    setMountTarget: (target: Element | string) => void;
    setRenderLoop: (on: boolean) => void;
    setTargetFPS: (fps: number) => void;
    setImgMemoryBudget: (bytes: number) => void;
    setImgWarmPerFrame: (n: number) => void;
    /** Queue base64 data URIs for off-screen decode (see Image cache). */
    warmImages: (list: string[]) => void;
    /** Tear down: dismount and unregister from the global state registry. */
    destroy: () => void;
}
