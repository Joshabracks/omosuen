import constructDOM from "./constructDom.js";
import updateDOM from "./updateDom.js";
import { parseSST } from "../Template/parseSST.js";
import { reactive } from "./reactive.js";
import { setImageMemoryBudget, enqueueWarm, processWarmQueue } from "./imageCache.js";
import { SSID, STID } from "./const.js";
import { register, get as getState, unregister } from "./registry.js";

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
  private _data: any;
  template: any;
  idMap: any;
  textMap: any;
  attrMap: any;
  nodeMap: any;
  dataMap: any;
  dirty: boolean = true;
  dirtyKeys: Set<string> = new Set();
  components: any;
  componentMap: any;
  methods: any;
  renderLoop: boolean = true;
  elementCount: number = 0;
  tick: number = 0;
  targetFPS: number = 60;
  nextUpdate: number = 0;
  updateInterval: number = -1;
  imgWarmPerFrame: number = 4;
  // Mounting + lifecycle.
  id: string = "";
  root: Element | null = null;
  mounted: boolean = false;
  mountTarget: Element | string = (typeof document !== "undefined" ? document.body : "body");
  mountOnAvailable: boolean = true;
  // When mounted into another State's element, ask that parent to preserve the
  // element across its re-renders. Set false when the parent intentionally manages
  // the container's lifecycle (e.g. a router/tabs that mounts/unmounts panels).
  preserveInParent: boolean = true;
  preserveSet: Set<string> = new Set();
  private looping: boolean = false;
  private _parentMount: { parent: State; ssid: string } | null = null;

  constructor(template: string, data: any = {}, components: any = {}, methods: any = {}, options: any = {}) {
    this._data = reactive(data, (key) => {
      this.dirty = true;
      this.dirtyKeys.add(key);
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
    if (options?.renderLoop === false) this.renderLoop = false;
    if (typeof options?.targetFPS === "number" && options.targetFPS > 0) this.targetFPS = options.targetFPS;
    if (typeof options?.imgMemoryBudget === "number" && options.imgMemoryBudget > 0) setImageMemoryBudget(options.imgMemoryBudget);
    if (typeof options?.imgWarmPerFrame === "number" && options.imgWarmPerFrame > 0) this.imgWarmPerFrame = options.imgWarmPerFrame;
    if (options?.mountTarget != null) this.mountTarget = options.mountTarget;
    if (options?.mountOnAvailable === false) this.mountOnAvailable = false;
    if (options?.preserveInParent === false) this.preserveInParent = false;
    this.updateInterval = 1000 / this.targetFPS;
    this.nextUpdate = this.updateInterval + Date.now();
    this.mountCheck();                                  // initial mount attempt
    if (this.renderLoop) { this.looping = true; window.requestAnimationFrame(this.loop); }
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
  get data(): any {
    return this._data;
  }
  set data(next: any) {
    this._data = reactive(next, (key) => {
      this.dirty = true;
      this.dirtyKeys.add(key);
    });
    this.dirty = true;
    for (const k in next) this.dirtyKeys.add(k);
  }

  /** True if State.data has no pending changes. */
  sameState = () => !this.dirty;
  private clearDirty = () => { this.dirty = false; this.dirtyKeys.clear(); };
  setNextUpdate = () => { this.nextUpdate = Date.now() + this.updateInterval; };
  private resetMaps = () => {
    this.idMap = {}; this.textMap = {}; this.attrMap = {}; this.nodeMap = {}; this.componentMap = {};
  };

  /** Resolve the configured mountTarget to a live element (or null). */
  private resolveTarget = (): Element | null => {
    const t = this.mountTarget;
    if (typeof document === "undefined") return null;
    if (t === document.body) return document.body;
    if (typeof t === "string") return document.querySelector(t);
    if (t instanceof Element) return t.isConnected ? t : null;
    return null;
  };

  /** Mount (build the template) into `el`, owning its contents. */
  private mount = (el: Element) => {
    this.root = el;
    this.resetMaps();
    el.innerHTML = "";
    constructDOM(this);
    this.mounted = true;
    this.clearDirty();
    if (el === document.body && this._data && this._data.title) document.title = this._data.title;
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
  private dismount = () => {
    if (!this.mounted) return;
    if (this._parentMount) {
      this._parentMount.parent.togglePreserve(this._parentMount.ssid, false);
      this._parentMount = null;
    }
    if (this.root) this.root.innerHTML = "";
    this.resetMaps();
    this.mounted = false;
    this.root = null;
  };

  /**
   * Reconcile mount state with the DOM. Dismounts if the current target is gone (root
   * detached, or a string selector no longer matches the mounted element); mounts if a
   * target is now available. Called automatically by the render loop (when
   * mountOnAvailable is on) and manually when renderLoop is off.
   */
  mountCheck = () => {
    if (this.mounted) {
      let ok = !!(this.root && this.root.isConnected);
      if (ok && typeof this.mountTarget === "string") ok = document.querySelector(this.mountTarget) === this.root;
      if (!ok) this.dismount();
    }
    if (!this.mounted) {
      const el = this.resolveTarget();
      if (el) this.mount(el);
    }
  };

  /** A single render tick (no self-reschedule — the loop drives it). */
  update = () => {
    processWarmQueue(this.imgWarmPerFrame);
    if (this.mountOnAvailable) this.mountCheck();
    if (!this.mounted) return;
    if (!this.renderLoop) {
      updateDOM(this);
      this.clearDirty();
      return;
    }
    if (this.nextUpdate > Date.now()) return;
    if (this.sameState()) return;
    this.setNextUpdate();
    updateDOM(this);
    this.clearDirty();
  };

  /** The requestAnimationFrame driver. Self-stops when renderLoop is turned off. */
  private loop = () => {
    if (!this.renderLoop) { this.looping = false; return; }
    this.update();
    window.requestAnimationFrame(this.loop);
  };

  forceUpdate = () => {
    this.mountCheck();
    if (this.mounted) { updateDOM(this); this.clearDirty(); }
  };

  /** Toggle preservation of the element at `ssid` (used by nested States). */
  togglePreserve = (ssid: string, on?: boolean) => {
    const want = on === undefined ? !this.preserveSet.has(ssid) : !!on;
    if (want) this.preserveSet.add(ssid); else this.preserveSet.delete(ssid);
  };

  /** Change the mount target: dismount, set, and re-mount if the new target is found. */
  setMountTarget = (target: Element | string) => {
    this.dismount();
    this.mountTarget = target;
    this.mountCheck();
  };

  setRenderLoop = (on: boolean) => {
    const next = !!on;
    if (next === this.renderLoop) return;
    this.renderLoop = next;
    if (next && !this.looping) { this.looping = true; window.requestAnimationFrame(this.loop); }
  };
  setTargetFPS = (fps: number) => {
    if (typeof fps === "number" && fps > 0) { this.targetFPS = fps; this.updateInterval = 1000 / fps; }
  };
  setImgMemoryBudget = (bytes: number) => {
    if (typeof bytes === "number" && bytes > 0) setImageMemoryBudget(bytes);
  };
  setImgWarmPerFrame = (n: number) => {
    if (typeof n === "number" && n > 0) this.imgWarmPerFrame = n;
  };

  /** Queue base64 data URIs for off-screen decode (see Image cache). */
  warmImages = (list: string[]) => enqueueWarm(list);

  /** Tear down: dismount and unregister from the global state registry. */
  destroy = () => {
    this.dismount();
    this.renderLoop = false;
    this.looping = false;
    unregister(this.id);
  };
}
