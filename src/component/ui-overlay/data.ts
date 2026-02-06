import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique } from "../types";
import { hasComponentMethod } from "../registry";

type UIAction =
  // Mouse Events
  | "click"
  | "dblclick"
  | "mousedown"
  | "mouseup"
  | "mousemove"
  | "mouseenter"
  | "mouseleave"
  | "mouseover"
  | "mouseout"
  | "contextmenu"
  // Keyboard Events
  | "keydown"
  | "keyup"
  | "keypress"
  // Focus Events
  | "focus"
  | "blur"
  | "focusin"
  | "focusout"
  // Form Events
  | "input"
  | "change"
  | "submit"
  | "reset"
  | "invalid"
  // Touch Events
  | "touchstart"
  | "touchend"
  | "touchmove"
  | "touchcancel"
  // Pointer Events
  | "pointerdown"
  | "pointerup"
  | "pointermove"
  | "pointerenter"
  | "pointerleave"
  | "pointerover"
  | "pointerout"
  | "pointercancel"
  | "gotpointercapture"
  | "lostpointercapture"
  // Drag & Drop Events
  | "drag"
  | "dragstart"
  | "dragend"
  | "dragenter"
  | "dragleave"
  | "dragover"
  | "drop"
  // Wheel Events
  | "wheel"
  // Animation Events
  | "animationstart"
  | "animationend"
  | "animationiteration"
  // Transition Events
  | "transitionstart"
  | "transitionend"
  | "transitionrun"
  | "transitioncancel"
  // Clipboard Events
  | "copy"
  | "cut"
  | "paste"
  // Selection Events
  | "select"
  | "selectstart"
  // Scroll Events
  | "scroll"
  // Resize Events
  | "resize"
  // Load Events
  | "load"
  | "error"
  | "abort"
  // Media Events
  | "play"
  | "pause"
  | "ended"
  | "volumechange"
  | "timeupdate"
  | "canplay"
  | "canplaythrough"
  | "durationchange"
  | "loadeddata"
  | "loadedmetadata"
  | "loadstart"
  | "progress"
  | "ratechange"
  | "seeked"
  | "seeking"
  | "stalled"
  | "suspend"
  | "waiting";

export interface UIBinding {
  selector: string;
  onActions: UIAction[];
  method: (e: Event) => void;
}

export interface ui_overlay extends ComponentData {
  type: "ui-overlay";
  unique: ComponentUnique.FALSE;
  element: HTMLDivElement | null;
  bindings: UIBinding[];
  cssOverrides: Record<string, string>;
  previousOverlay?: ui_overlay;
  container: HTMLElement;
  showOverride?: string;
  hideOverride?: string;
}

export interface UIOverlayOptions extends ComponentOptions {
  html?: string;
  cssOverrides?: Record<string, string>;
  bindings?: UIBinding[];
  previousOverlay?: ui_overlay;
}

export function builder(options: UIOverlayOptions): ui_overlay {
  // Create the container element
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = "100%";
  container.style.height = "100%";
  container.style.pointerEvents = "none"; // Allow clicks to pass through to canvas
  container.style.zIndex = "1000"; // Ensure it's above the canvas

  // Set innerHTML if provided
  if (options.html) {
    container.innerHTML = options.html;
  }

  container.id = options.name.replace(/\s/g, "");

  // Apply CSS overrides if provided
  if (options.cssOverrides) {
    Object.keys(options.cssOverrides).forEach((key) => {
      // @ts-ignore
      container.style[key] = options.cssOverrides[key];
    });
  }

  // Add the container to the document body
  document.body.appendChild(container);

  const overlay: ui_overlay = {
    type: "ui-overlay",
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    overrideKey: options.overrideKey,
    showOverride: options?.overrideKey ? `${options.overrideKey}-show` : undefined,
    hideOverride: options?.overrideKey ? `${options.overrideKey}-hide` : undefined,
    _disposed: false,
    element: container,
    bindings: options.bindings || [],
    cssOverrides: options.cssOverrides || {},
    previousOverlay: options.previousOverlay,
    container: container,
  };

  // Validate that override methods are registered if overrideKey is set
  if (overlay.overrideKey) {
    if (overlay.showOverride && !hasComponentMethod("ui-overlay", overlay.showOverride)) {
      console.warn(
        `[ui-overlay] Custom show method '${overlay.showOverride}' is not registered for component '${overlay.name}'. ` +
        `Call registerComponentMethod('ui-overlay', '${overlay.showOverride}', func) before creating this component. ` +
        `Falling back to default show behavior.`
      );
    }
    if (overlay.hideOverride && !hasComponentMethod("ui-overlay", overlay.hideOverride)) {
      console.warn(
        `[ui-overlay] Custom hide method '${overlay.hideOverride}' is not registered for component '${overlay.name}'. ` +
        `Call registerComponentMethod('ui-overlay', '${overlay.hideOverride}', func) before creating this component. ` +
        `Falling back to default hide behavior.`
      );
    }
  }

  return overlay;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const uiOverlay = component as ui_overlay;
  const container = uiOverlay.element;
  const bindingFactoryString = `function bindingFactory() {
    return [
      ${uiOverlay.bindings
        .map(
          (binding) => `{
          selector: "${binding.selector}",
          onActions: ["${binding.onActions.join('","')}"],
          method: "${binding.method.toString()}"
        }`,
        )
        .join(",")}
    ]
  }`;
  return {
    type: "ui-overlay",
    name: uiOverlay.name,
    unique: ComponentUnique.FALSE,
    cssOverrides: Object.keys(uiOverlay.cssOverrides).length
      ? uiOverlay.cssOverrides
      : undefined,
    html: container?.innerHTML || null,
    bindingFactoryString,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): ui_overlay {
  const {
    type,
    name,
    html,
    cssOverrides,
    overrideKey,
    bindingFactoryString,
  } = data;
  const errors = [];
  if (type !== "ui-overlay")
    errors.push(`type ${type} does not match "ui-overlay"`);
  if (!name) errors.push(`UIOverlay requires a name`);
  if (errors.length) throw new Error(errors.join("\n"));
  eval(bindingFactoryString);
  let serializedBindings;
  try {
    // @ts-expect-error bindingFactory-via-eval
    // eslint-disable-next-line no-undef
    serializedBindings = bindingFactory();
  } catch (e) {
    console.warn(e);
    serializedBindings = [];
  }

  return builder({
    name,
    cssOverrides,
    html,
    overrideKey,
    bindings: serializedBindings.map((binding: any) => {
      const selector = binding.selector;
      const onActions = binding.onActions;
      eval(
        binding.method.replace(
          /function\s*\(\)/,
          "function deserializedMethod()",
        ),
      );
      // @ts-expect-error deserializedMethod-via-eval
      // eslint-disable-next-line no-undef
      return { selector, onActions, method: deserializedMethod };
    }),
  });
}

export const UIOverlaySerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of ui-overlay-specific properties accessible via component Proxy.
 * These properties can be accessed directly without triggering method lookup.
 */
export const PROPERTY_ALLOWLIST: string[] = [
  'element',
  'bindings',
  'cssOverrides',
  'previousOverlay',
  'container',
  'showOverride',
  'hideOverride'
];
