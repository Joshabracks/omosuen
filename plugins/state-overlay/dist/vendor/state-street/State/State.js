import constructDOM from "./constructDom.js";
import updateDOM from "./updateDom.js";
import { parseSST } from "../Template/parseSST.js";
import { reactive } from "./reactive.js";
import { setImageMemoryBudget, enqueueWarm, setWarmPerFrame } from "./imageCache.js";
import { SSID, STID } from "./const.js";
import { register, get as getState, unregister } from "./registry.js";
import { ensureMountWatcher } from "./mountWatcher.js";
export default class State {
    constructor(template, data = {}, components = {}, methods = {}, options = {}) {
        // ssid -> where a `:preserve`d element has been moved to via moveTo(), plus the
        // comment-node placeholder left at its natural position (the anchor resetLocation()
        // and automatic snap-back reinsert at).
        this.locationMap = {};
        this.dirty = true;
        this.dirtyKeys = new Set();
        this.autoRender = true;
        this.elementCount = 0;
        this.tick = 0;
        this.targetFPS = 60;
        this.nextUpdate = 0;
        this.updateInterval = -1;
        this.imgWarmPerFrame = 4;
        // Mounting + lifecycle.
        this.id = "";
        this.root = null;
        this.mounted = false;
        this.mountTarget = (typeof document !== "undefined" ? document.body : "body");
        this.mountOnAvailable = true;
        // When mounted into another State's element, ask that parent to preserve the
        // element across its re-renders. Set false when the parent intentionally manages
        // the container's lifecycle (e.g. a router/tabs that mounts/unmounts panels).
        this.preserveInParent = true;
        this.preserveSet = new Set();
        this.rafHandle = null;
        this.timeoutHandle = null;
        this._parentMount = null;
        /** True if State.data has no pending changes. */
        this.sameState = () => !this.dirty;
        this.clearDirty = () => { this.dirty = false; this.dirtyKeys.clear(); };
        this.setNextUpdate = () => { this.nextUpdate = Date.now() + this.updateInterval; };
        /**
         * Arms a single pending render (rAF, or a delayed timeout while still inside the
         * FPS throttle window). No-ops if one is already pending -- that's what coalesces
         * a burst of synchronous mutations into one render -- or if autoRender is off.
         */
        this.scheduleRender = () => {
            if (!this.autoRender)
                return;
            if (this.rafHandle !== null || this.timeoutHandle !== null)
                return;
            const delay = this.nextUpdate - Date.now();
            if (delay > 0)
                this.timeoutHandle = window.setTimeout(this.onFrame, delay);
            else
                this.rafHandle = window.requestAnimationFrame(this.onFrame);
        };
        /** The on-demand render entry point: fires once per scheduleRender() call. */
        this.onFrame = () => {
            this.rafHandle = null;
            this.timeoutHandle = null;
            if (!this.autoRender)
                return; // destroyed / turned off mid-flight
            if (this.mountOnAvailable)
                this.mountCheck();
            if (!this.mounted)
                return;
            if (this.sameState())
                return;
            const delay = this.nextUpdate - Date.now();
            if (delay > 0) {
                this.timeoutHandle = window.setTimeout(this.onFrame, delay);
                return;
            }
            this.setNextUpdate();
            updateDOM(this);
            this.clearDirty();
        };
        /**
         * True while this instance still needs the shared MutationObserver's help finding
         * or watching its mountTarget (see mountWatcher.ts). document.body never needs
         * watching once mounted -- it can't become disconnected.
         */
        this.needsMountWatch = () => {
            if (!this.autoRender || !this.mountOnAvailable)
                return false;
            if (!this.mounted)
                return true;
            const body = typeof document !== "undefined" ? document.body : null;
            return this.mountTarget !== body;
        };
        this.resetMaps = () => {
            this.idMap = {};
            this.textMap = {};
            this.attrMap = {};
            this.nodeMap = {};
            this.componentMap = {};
            this.locationMap = {};
        };
        /** Resolve the configured mountTarget to a live element (or null). */
        this.resolveTarget = () => {
            const t = this.mountTarget;
            if (typeof document === "undefined")
                return null;
            if (t === document.body)
                return document.body;
            if (typeof t === "string")
                return document.querySelector(t);
            if (t instanceof Element)
                return t.isConnected ? t : null;
            return null;
        };
        /** Mount (build the template) into `el`, owning its contents. */
        this.mount = (el) => {
            this.root = el;
            this.resetMaps();
            el.innerHTML = "";
            constructDOM(this);
            this.mounted = true;
            this.clearDirty();
            if (el === document.body && this._data && this._data.title)
                document.title = this._data.title;
            // If we mounted into an element owned by another State, ask that parent to
            // preserve this element across its re-renders (so it won't clobber our DOM) —
            // unless this State opted out (the parent manages the container itself).
            if (this.preserveInParent) {
                const stid = el.getAttribute(STID);
                const ssid = el.getAttribute(SSID);
                if (stid !== null && ssid !== null) {
                    const parent = getState(stid);
                    if (parent && parent !== this) {
                        parent.togglePreserve(ssid, true);
                        this._parentMount = { parent, ssid };
                    }
                }
            }
        };
        /** Remove our rendered nodes and return to the unmounted state. */
        this.dismount = () => {
            if (!this.mounted)
                return;
            if (this._parentMount) {
                this._parentMount.parent.togglePreserve(this._parentMount.ssid, false);
                this._parentMount = null;
            }
            // A moveTo()'d element often lives outside this.root, so root.innerHTML = ""
            // below won't reach it -- detach it explicitly or it leaks as an untracked
            // duplicate once remount rebuilds a fresh element at the natural position.
            for (const ssid in this.locationMap) {
                const { target } = this.locationMap[ssid];
                const el = this.idMap[ssid];
                if (el && target.contains(el))
                    target.removeChild(el);
            }
            if (this.root)
                this.root.innerHTML = "";
            this.resetMaps();
            this.mounted = false;
            this.root = null;
        };
        /**
         * Reconcile mount state with the DOM. Dismounts if the current target is gone (root
         * detached, or a string selector no longer matches the mounted element); mounts if a
         * target is now available. Called automatically by the shared mount watcher and by
         * each render (when mountOnAvailable is on); call it manually when autoRender is off.
         */
        this.mountCheck = () => {
            if (this.mounted) {
                let ok = !!(this.root && this.root.isConnected);
                if (ok && typeof this.mountTarget === "string")
                    ok = document.querySelector(this.mountTarget) === this.root;
                if (!ok)
                    this.dismount();
            }
            if (!this.mounted) {
                const el = this.resolveTarget();
                if (el)
                    this.mount(el);
            }
        };
        this.forceUpdate = () => {
            this.mountCheck();
            if (this.mounted) {
                updateDOM(this);
                this.clearDirty();
            }
            if (this.rafHandle !== null) {
                window.cancelAnimationFrame(this.rafHandle);
                this.rafHandle = null;
            }
            if (this.timeoutHandle !== null) {
                window.clearTimeout(this.timeoutHandle);
                this.timeoutHandle = null;
            }
        };
        /** Toggle preservation of the element at `ssid` (used by nested States). */
        this.togglePreserve = (ssid, on) => {
            const want = on === undefined ? !this.preserveSet.has(ssid) : !!on;
            if (want)
                this.preserveSet.add(ssid);
            else
                this.preserveSet.delete(ssid);
        };
        /**
         * Move a `:preserve`d element to live under `target` instead of its natural template
         * position, without destroying it. A comment placeholder is left at the natural position
         * on first move so resetLocation()/automatic snap-back can restore exact sibling order.
         * Backs the `moveTo` function stamped onto preserved elements (see constructElement.ts).
         */
        this.moveElement = (ssid, element, target) => {
            if (!this.preserveSet.has(ssid)) {
                console.warn(`moveTo called on an element that is not :preserve'd (ssid ${ssid}); ignored.`);
                return;
            }
            const existing = this.locationMap[ssid];
            if (existing) {
                existing.target = target;
                target.appendChild(element);
                return;
            }
            const placeholder = document.createComment(`ss-moved:${ssid}`);
            element.parentNode?.insertBefore(placeholder, element);
            this.locationMap[ssid] = { target, placeholder };
            target.appendChild(element);
        };
        /** Return a moved element to its natural template position. Backs `resetLocation`. */
        this.resetElementLocation = (ssid, element) => {
            const entry = this.locationMap[ssid];
            if (!entry)
                return;
            entry.placeholder.parentNode?.insertBefore(element, entry.placeholder);
            entry.placeholder.remove();
            delete this.locationMap[ssid];
        };
        /** Change the mount target: dismount, set, and re-mount if the new target is found. */
        this.setMountTarget = (target) => {
            this.dismount();
            this.mountTarget = target;
            this.mountCheck();
            if (this.autoRender && this.mountOnAvailable)
                ensureMountWatcher();
        };
        this.setAutoRender = (on) => {
            const next = !!on;
            if (next === this.autoRender)
                return;
            this.autoRender = next;
            if (next) {
                if (this.dirty)
                    this.scheduleRender();
                if (this.mountOnAvailable)
                    ensureMountWatcher();
            }
            else {
                if (this.rafHandle !== null) {
                    window.cancelAnimationFrame(this.rafHandle);
                    this.rafHandle = null;
                }
                if (this.timeoutHandle !== null) {
                    window.clearTimeout(this.timeoutHandle);
                    this.timeoutHandle = null;
                }
            }
        };
        this.setTargetFPS = (fps) => {
            if (typeof fps === "number" && fps > 0) {
                this.targetFPS = fps;
                this.updateInterval = 1000 / fps;
            }
        };
        this.setImgMemoryBudget = (bytes) => {
            if (typeof bytes === "number" && bytes > 0)
                setImageMemoryBudget(bytes);
        };
        this.setImgWarmPerFrame = (n) => {
            if (typeof n === "number" && n > 0) {
                this.imgWarmPerFrame = n;
                setWarmPerFrame(n);
            }
        };
        /** Queue base64 data URIs for off-screen decode (see Image cache). */
        this.warmImages = (list) => enqueueWarm(list);
        /** Tear down: dismount and unregister from the global state registry. */
        this.destroy = () => {
            this.dismount();
            this.autoRender = false;
            if (this.rafHandle !== null) {
                window.cancelAnimationFrame(this.rafHandle);
                this.rafHandle = null;
            }
            if (this.timeoutHandle !== null) {
                window.clearTimeout(this.timeoutHandle);
                this.timeoutHandle = null;
            }
            unregister(this.id);
        };
        this._data = reactive(data, (key) => {
            this.dirty = true;
            this.dirtyKeys.add(key);
            this.scheduleRender();
        });
        this.template = parseSST(template, components);
        this.idMap = {};
        this.textMap = {};
        this.attrMap = {};
        this.nodeMap = {};
        this.components = components;
        this.componentMap = {};
        this.methods = methods;
        this.id = register(this);
        if (options?.autoRender === false)
            this.autoRender = false;
        if (typeof options?.targetFPS === "number" && options.targetFPS > 0)
            this.targetFPS = options.targetFPS;
        if (typeof options?.imgMemoryBudget === "number" && options.imgMemoryBudget > 0)
            setImageMemoryBudget(options.imgMemoryBudget);
        if (typeof options?.imgWarmPerFrame === "number" && options.imgWarmPerFrame > 0) {
            this.imgWarmPerFrame = options.imgWarmPerFrame;
            setWarmPerFrame(options.imgWarmPerFrame);
        }
        if (options?.mountTarget != null)
            this.mountTarget = options.mountTarget;
        if (options?.mountOnAvailable === false)
            this.mountOnAvailable = false;
        if (options?.preserveInParent === false)
            this.preserveInParent = false;
        this.updateInterval = 1000 / this.targetFPS;
        this.nextUpdate = this.updateInterval + Date.now();
        this.mountCheck(); // initial mount attempt
        if (this.autoRender && this.mountOnAvailable)
            ensureMountWatcher();
    }
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
    get data() {
        return this._data;
    }
    set data(next) {
        this._data = reactive(next, (key) => {
            this.dirty = true;
            this.dirtyKeys.add(key);
            this.scheduleRender();
        });
        this.dirty = true;
        for (const k in next)
            this.dirtyKeys.add(k);
        this.scheduleRender();
    }
}
