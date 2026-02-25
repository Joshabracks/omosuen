import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentInstanceMethods,
  ComponentUnique,
} from '../base';
import type { InputControllerMethods } from './methods';

/**
 * Supported input event types for the InputController.
 * Covers keyboard, mouse, pointer, gamepad, and other common input events.
 */
export type InputEventType =
  // Keyboard Events
  | 'keydown'
  | 'keyup'
  | 'keypress'
  // Mouse Events
  | 'mousedown'
  | 'mouseup'
  | 'mousemove'
  | 'click'
  | 'dblclick'
  | 'contextmenu'
  | 'wheel'
  // Pointer Events
  | 'pointerdown'
  | 'pointerup'
  | 'pointermove'
  | 'pointercancel'
  // Touch Events
  | 'touchstart'
  | 'touchend'
  | 'touchmove'
  | 'touchcancel'
  // Gamepad Events (via polling in update loop)
  | 'gamepadconnected'
  | 'gamepaddisconnected';

/**
 * Represents a binding from a raw input event to a named action.
 */
export interface ActionBinding {
  /** The type of input event (e.g., 'keydown', 'mousedown') */
  eventType: InputEventType;
  /** The key code, button number, or identifier for this input */
  key?: string; // For keyboard (e.g., 'w', 'ArrowUp')
  button?: number; // For mouse/pointer (0=left, 1=middle, 2=right)
  gamepadButton?: number; // For gamepad buttons (0-16)
  gamepadAxis?: number; // For gamepad axes (0-3)
  /** The named action this binding triggers (e.g., 'moveUp', 'jump') */
  action: string;
}

/**
 * Callback function signature for action events.
 */
export type ActionCallback = (event?: Event, value?: number) => void;

/**
 * InputController component data structure.
 * Manages input event handling without visual elements.
 */
export interface InputControllerT
  extends ComponentData,
    ComponentInstanceMethods<InputControllerMethods> {
  type: 'input-controller';
  unique: ComponentUnique.FALSE;

  /** Action bindings mapping inputs to actions */
  bindings: ActionBinding[];

  /** Currently active inputs (key/button identifiers) */
  activeInputs: Set<string>;

  /** Registered callbacks for each action */
  actionCallbacks: Map<string, ActionCallback[]>;

  /** Internal: DOM event listener references for cleanup */
  _eventHandlers: Map<string, EventListener>;

  /** Whether to prevent default browser behavior for bound keys */
  preventDefault: boolean;

  /** DOM element to attach event listeners to (default: window) */
  target: EventTarget;
}

export interface InputControllerOptions extends ComponentOptions {
  /** Initial action bindings */
  bindings?: ActionBinding[];
  /** Whether to prevent default browser behavior for bound keys (default: true) */
  preventDefault?: boolean;
  /** DOM element to attach event listeners to (default: window) */
  target?: EventTarget;
}

export function builder(options: InputControllerOptions): InputControllerT {
  const inputController = {
    type: 'input-controller' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    overrideKey: options.overrideKey,
    _disposed: false,
    bindings: options.bindings || [],
    activeInputs: new Set<string>(),
    actionCallbacks: new Map<string, ActionCallback[]>(),
    _eventHandlers: new Map<string, EventListener>(),
    preventDefault: options.preventDefault ?? true,
    target: options.target ?? window,
  };

  return inputController as unknown as InputControllerT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const inputController = component as InputControllerT;

  return {
    type: 'input-controller',
    name: inputController.name,
    unique: ComponentUnique.FALSE,
    overrideKey: inputController.overrideKey,
    bindings: inputController.bindings,
    preventDefault: inputController.preventDefault,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): InputControllerT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, bindings, preventDefault, overrideKey } = data;

  const errors = [];
  if (type !== 'input-controller') {
    errors.push(`type ${type} does not match "input-controller"`);
  }
  if (!name) {
    errors.push(`InputController requires a name`);
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  return builder({
    name: name as string,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    bindings: bindings || [],
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    preventDefault: preventDefault ?? true,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    overrideKey,
  });
}

export const InputControllerSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of input-controller-specific properties accessible via component Proxy.
 * These properties can be accessed directly without triggering method lookup.
 */
export const PROPERTY_ALLOWLIST: string[] = [
  'bindings',
  'activeInputs',
  'actionCallbacks',
  '_eventHandlers',
  'preventDefault',
  'target',
];
