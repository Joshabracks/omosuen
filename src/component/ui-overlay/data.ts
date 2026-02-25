import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentInstanceMethods,
  ComponentUnique,
} from '../base';
import { hasMethod, getBinding } from '../registry';
import type { UIOverlayMethods } from './methods';

type UIAction =
  // Mouse Events
  | 'click'
  | 'dblclick'
  | 'mousedown'
  | 'mouseup'
  | 'mousemove'
  | 'mouseenter'
  | 'mouseleave'
  | 'mouseover'
  | 'mouseout'
  | 'contextmenu'
  // Keyboard Events
  | 'keydown'
  | 'keyup'
  | 'keypress'
  // Focus Events
  | 'focus'
  | 'blur'
  | 'focusin'
  | 'focusout'
  // Form Events
  | 'input'
  | 'change'
  | 'submit'
  | 'reset'
  | 'invalid'
  // Touch Events
  | 'touchstart'
  | 'touchend'
  | 'touchmove'
  | 'touchcancel'
  // Pointer Events
  | 'pointerdown'
  | 'pointerup'
  | 'pointermove'
  | 'pointerenter'
  | 'pointerleave'
  | 'pointerover'
  | 'pointerout'
  | 'pointercancel'
  | 'gotpointercapture'
  | 'lostpointercapture'
  // Drag & Drop Events
  | 'drag'
  | 'dragstart'
  | 'dragend'
  | 'dragenter'
  | 'dragleave'
  | 'dragover'
  | 'drop'
  // Wheel Events
  | 'wheel'
  // Animation Events
  | 'animationstart'
  | 'animationend'
  | 'animationiteration'
  // Transition Events
  | 'transitionstart'
  | 'transitionend'
  | 'transitionrun'
  | 'transitioncancel'
  // Clipboard Events
  | 'copy'
  | 'cut'
  | 'paste'
  // Selection Events
  | 'select'
  | 'selectstart'
  // Scroll Events
  | 'scroll'
  // Resize Events
  | 'resize'
  // Load Events
  | 'load'
  | 'error'
  | 'abort'
  // Media Events
  | 'play'
  | 'pause'
  | 'ended'
  | 'volumechange'
  | 'timeupdate'
  | 'canplay'
  | 'canplaythrough'
  | 'durationchange'
  | 'loadeddata'
  | 'loadedmetadata'
  | 'loadstart'
  | 'progress'
  | 'ratechange'
  | 'seeked'
  | 'seeking'
  | 'stalled'
  | 'suspend'
  | 'waiting';

export interface UIBinding {
  selector: string;
  onActions: UIAction[];
  methodKey: string;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  _methodFunc?: Function; // Internal: actual function reference for event listeners
}

export interface UIOverlayT
  extends ComponentData, ComponentInstanceMethods<UIOverlayMethods> {
  type: 'ui-overlay';
  unique: ComponentUnique.FALSE;
  element: HTMLDivElement | null;
  bindings: UIBinding[];
  cssOverrides: Record<string, string>;
  previousOverlayId?: number;
  container: HTMLElement;
  showOverride?: string;
  hideOverride?: string;
  htmlConstructorKey?: string;
  _htmlConstructed: boolean;
}

export interface UIOverlayOptions extends ComponentOptions {
  htmlConstructorKey?: string;
  cssOverrides?: Record<string, string>;
  bindings?: UIBinding[];
  previousOverlayId?: number;
}

export function builder(options: UIOverlayOptions): UIOverlayT {
  // Create the container element
  const container = document.createElement('div');
  // container.style.position = 'absolute';
  // container.style.top = '0';
  // container.style.left = '0';
  // container.style.width = '100%';
  // container.style.height = '100%';
  // container.style.pointerEvents = 'none'; // Allow clicks to pass through to canvas
  container.style.zIndex = '1000'; // Ensure it's above the canvas

  container.id = options.name.replace(/\s/g, '');

  // Apply CSS overrides if provided
  if (options.cssOverrides) {
    Object.keys(options.cssOverrides).forEach((key) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      container.style[key] = options.cssOverrides[key];
    });
  }

  // Look up binding functions and store internal references
  const bindings: UIBinding[] = (options.bindings || []).map((binding) => {
    const func = getBinding(binding.methodKey);
    if (!func) {
      console.warn(
        `[ui-overlay] Binding method '${binding.methodKey}' is not registered for component '${options.name}'. ` +
          `Call registerBinding('${binding.methodKey}', func) before creating this component.`,
      );
    }
    return {
      selector: binding.selector,
      onActions: binding.onActions,
      methodKey: binding.methodKey,
      _methodFunc: func || undefined,
    };
  });

  // Create data-only object. Methods will be added by Proxy wrapper in newComponent()
  const overlay = {
    type: 'ui-overlay' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    overrideKey: options.overrideKey,
    showOverride: options?.overrideKey
      ? `${options.overrideKey}-show`
      : undefined,
    hideOverride: options?.overrideKey
      ? `${options.overrideKey}-hide`
      : undefined,
    _disposed: false,
    element: container,
    bindings: bindings,
    cssOverrides: options.cssOverrides || {},
    previousOverlayId: options.previousOverlayId,
    container: container,
    htmlConstructorKey: options.htmlConstructorKey,
    _htmlConstructed: false,
  };

  // Validate that override methods are registered if overrideKey is set
  if (overlay.overrideKey) {
    if (
      overlay.showOverride &&
      !hasMethod('ui-overlay', overlay.showOverride)
    ) {
      console.warn(
        `[ui-overlay] Custom show method '${overlay.showOverride}' is not registered for component '${overlay.name}'. ` +
          `Call registerMethod('ui-overlay', '${overlay.showOverride}', func) before creating this component. ` +
          `Falling back to default show behavior.`,
      );
    }
    if (
      overlay.hideOverride &&
      !hasMethod('ui-overlay', overlay.hideOverride)
    ) {
      console.warn(
        `[ui-overlay] Custom hide method '${overlay.hideOverride}' is not registered for component '${overlay.name}'. ` +
          `Call registerMethod('ui-overlay', '${overlay.hideOverride}', func) before creating this component. ` +
          `Falling back to default hide behavior.`,
      );
    }
  }

  return overlay as unknown as UIOverlayT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const uiOverlay = component as UIOverlayT;

  // Serialize bindings as method keys (no function serialization)
  const serializedBindings = uiOverlay.bindings.map((binding) => ({
    selector: binding.selector,
    onActions: binding.onActions,
    methodKey: binding.methodKey,
  }));

  // Validate all bindings have registered methods
  const invalidBindings = uiOverlay.bindings.filter((b) => !b._methodFunc);
  if (invalidBindings.length > 0) {
    console.warn(
      `[ui-overlay] Component '${uiOverlay.name}' has unregistered binding methods: ` +
        invalidBindings.map((b) => b.methodKey).join(', '),
    );
  }

  return {
    type: 'ui-overlay',
    name: uiOverlay.name,
    unique: ComponentUnique.FALSE,
    overrideKey: uiOverlay.overrideKey,
    cssOverrides: Object.keys(uiOverlay.cssOverrides).length
      ? uiOverlay.cssOverrides
      : undefined,
    previousOverlayId: uiOverlay.previousOverlayId,
    htmlConstructorKey: uiOverlay.htmlConstructorKey,
    bindings: serializedBindings,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): UIOverlayT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const {
    type,
    name,
    cssOverrides,
    overrideKey,
    htmlConstructorKey,
    bindings,
    previousOverlayId,
  } = data;

  const errors = [];
  if (type !== 'ui-overlay') {
    errors.push(`type ${type} does not match "ui-overlay"`);
  }
  if (!name) {
    errors.push(`UIOverlay requires a name`);
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  return builder({
    name: name as string,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    cssOverrides,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    overrideKey,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    htmlConstructorKey,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    previousOverlayId,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    bindings: bindings || [],
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
  'previousOverlayId',
  'container',
  'showOverride',
  'hideOverride',
  'htmlConstructorKey',
  '_htmlConstructed',
];
