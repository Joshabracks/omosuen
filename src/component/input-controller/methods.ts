import { ComponentData, ComponentMethods } from '../types';
import {
  InputControllerT,
  ActionBinding,
  ActionCallback,
  InputEventType,
} from './data';

export interface InputControllerMethods extends ComponentMethods {
  init: (component: ComponentData) => Promise<void>;
  update: (component: ComponentData, deltaTime: number) => void;
  dispose: (component: ComponentData) => void;
  bindAction: (ic: InputControllerT, binding: ActionBinding) => void;
  unbindAction: (
    ic: InputControllerT,
    action: string,
    eventType?: InputEventType,
  ) => void;
  onAction: (
    ic: InputControllerT,
    action: string,
    callback: ActionCallback,
  ) => void;
  offAction: (
    ic: InputControllerT,
    action: string,
    callback?: ActionCallback,
  ) => void;
  isActionPressed: (ic: InputControllerT, action: string) => boolean;
  getAxis: (ic: InputControllerT, negative: string, positive: string) => number;
}

/**
 * Initializes the InputController by attaching DOM event listeners.
 */
async function init(component: ComponentData): Promise<void> {
  const ic = component as InputControllerT;

  // Keyboard event handlers
  const keydownHandler = (e: Event) => handleKeyDown(ic, e as KeyboardEvent);
  const keyupHandler = (e: Event) => handleKeyUp(ic, e as KeyboardEvent);

  // Mouse event handlers
  const mousedownHandler = (e: Event) => handleMouseDown(ic, e as MouseEvent);
  const mouseupHandler = (e: Event) => handleMouseUp(ic, e as MouseEvent);
  const mousemoveHandler = (e: Event) => handleMouseMove(ic, e as MouseEvent);
  const wheelHandler = (e: Event) => handleWheel(ic, e as WheelEvent);
  const clickHandler = (e: Event) => handleClick(ic, e as MouseEvent);
  const contextmenuHandler = (e: Event) =>
    handleContextMenu(ic, e as MouseEvent);

  // Pointer event handlers
  const pointerdownHandler = (e: Event) =>
    handlePointerDown(ic, e as PointerEvent);
  const pointerupHandler = (e: Event) => handlePointerUp(ic, e as PointerEvent);
  const pointermoveHandler = (e: Event) =>
    handlePointerMove(ic, e as PointerEvent);

  // Touch event handlers
  const touchstartHandler = (e: Event) => handleTouchStart(ic, e as TouchEvent);
  const touchendHandler = (e: Event) => handleTouchEnd(ic, e as TouchEvent);
  const touchmoveHandler = (e: Event) => handleTouchMove(ic, e as TouchEvent);

  // Gamepad event handlers
  const gamepadconnectedHandler = (e: Event) =>
    handleGamepadConnected(ic, e as GamepadEvent);
  const gamepaddisconnectedHandler = (e: Event) =>
    handleGamepadDisconnected(ic, e as GamepadEvent);

  // Attach event listeners to target (defaults to window)
  const target = ic.target;
  target.addEventListener('keydown', keydownHandler);
  target.addEventListener('keyup', keyupHandler);
  target.addEventListener('mousedown', mousedownHandler);
  target.addEventListener('mouseup', mouseupHandler);
  target.addEventListener('mousemove', mousemoveHandler);
  target.addEventListener('wheel', wheelHandler);
  target.addEventListener('click', clickHandler);
  target.addEventListener('contextmenu', contextmenuHandler);
  target.addEventListener('pointerdown', pointerdownHandler);
  target.addEventListener('pointerup', pointerupHandler);
  target.addEventListener('pointermove', pointermoveHandler);
  target.addEventListener('touchstart', touchstartHandler);
  target.addEventListener('touchend', touchendHandler);
  target.addEventListener('touchmove', touchmoveHandler);
  target.addEventListener('gamepadconnected', gamepadconnectedHandler);
  target.addEventListener('gamepaddisconnected', gamepaddisconnectedHandler);

  // Store handlers for cleanup
  ic._eventHandlers.set('keydown', keydownHandler);
  ic._eventHandlers.set('keyup', keyupHandler);
  ic._eventHandlers.set('mousedown', mousedownHandler);
  ic._eventHandlers.set('mouseup', mouseupHandler);
  ic._eventHandlers.set('mousemove', mousemoveHandler);
  ic._eventHandlers.set('wheel', wheelHandler);
  ic._eventHandlers.set('click', clickHandler);
  ic._eventHandlers.set('contextmenu', contextmenuHandler);
  ic._eventHandlers.set('pointerdown', pointerdownHandler);
  ic._eventHandlers.set('pointerup', pointerupHandler);
  ic._eventHandlers.set('pointermove', pointermoveHandler);
  ic._eventHandlers.set('touchstart', touchstartHandler);
  ic._eventHandlers.set('touchend', touchendHandler);
  ic._eventHandlers.set('touchmove', touchmoveHandler);
  ic._eventHandlers.set('gamepadconnected', gamepadconnectedHandler);
  ic._eventHandlers.set('gamepaddisconnected', gamepaddisconnectedHandler);
}

/**
 * Update loop - can be used for gamepad polling or continuous input processing.
 */
function update(_component: ComponentData, _deltaTime: number): void {}

/**
 * Disposes the InputController by removing all event listeners.
 */
function dispose(component: ComponentData): void {
  const ic = component as InputControllerT;

  // Remove all event listeners from the target
  ic._eventHandlers.forEach((handler, eventType) => {
    ic.target.removeEventListener(eventType, handler);
  });

  // Clear internal state
  ic._eventHandlers.clear();
  ic.activeInputs.clear();
  ic.actionCallbacks.clear();

  ic._disposed = true;
}

/**
 * Binds a new action mapping to the InputController.
 */
function bindAction(ic: InputControllerT, binding: ActionBinding): void {
  // Add binding if it doesn't already exist
  const exists = ic.bindings.some(
    (b) =>
      b.eventType === binding.eventType &&
      b.key === binding.key &&
      b.button === binding.button &&
      b.gamepadButton === binding.gamepadButton &&
      b.gamepadAxis === binding.gamepadAxis &&
      b.action === binding.action,
  );

  if (!exists) {
    ic.bindings.push(binding);
  }
}

/**
 * Unbinds an action mapping from the InputController.
 */
function unbindAction(
  ic: InputControllerT,
  action: string,
  eventType?: InputEventType,
): void {
  ic.bindings = ic.bindings.filter((b) => {
    if (eventType) {
      return !(b.action === action && b.eventType === eventType);
    }
    return b.action !== action;
  });
}

/**
 * Registers a callback for a specific action.
 */
function onAction(
  ic: InputControllerT,
  action: string,
  callback: ActionCallback,
): void {
  if (!ic.actionCallbacks.has(action)) {
    ic.actionCallbacks.set(action, []);
  }
  ic.actionCallbacks.get(action)!.push(callback);
}

/**
 * Unregisters a callback for a specific action.
 */
function offAction(
  ic: InputControllerT,
  action: string,
  callback?: ActionCallback,
): void {
  if (!ic.actionCallbacks.has(action)) return;

  if (callback) {
    const callbacks = ic.actionCallbacks.get(action)!;
    const index = callbacks.indexOf(callback);
    if (index !== -1) {
      callbacks.splice(index, 1);
    }
  } else {
    // Remove all callbacks for this action
    ic.actionCallbacks.delete(action);
  }
}

/**
 * Checks if a specific action is currently pressed/active.
 */
function isActionPressed(ic: InputControllerT, action: string): boolean {
  // Check if any binding for this action has an active input
  return ic.bindings.some((binding) => {
    if (binding.action !== action) return false;

    if (binding.key) {
      return ic.activeInputs.has(`key:${binding.key}`);
    }
    if (binding.button !== undefined) {
      return ic.activeInputs.has(`button:${binding.button}`);
    }
    if (binding.gamepadButton !== undefined) {
      return ic.activeInputs.has(`gamepad:button:${binding.gamepadButton}`);
    }

    return false;
  });
}

/**
 * Gets the axis value for a pair of actions (e.g., left/right, up/down).
 * Returns -1 if negative action is pressed, +1 if positive is pressed, 0 if neither or both.
 */
function getAxis(
  ic: InputControllerT,
  negative: string,
  positive: string,
): number {
  const negPressed = isActionPressed(ic, negative);
  const posPressed = isActionPressed(ic, positive);

  if (negPressed && !posPressed) return -1;
  if (posPressed && !negPressed) return 1;
  return 0;
}

// ===== Event Handlers =====

/**
 * Dispatches every binding matching `eventType` (and optional key / button) to
 * triggerAction by iterating ic.bindings directly. Avoids the per-event
 * `.filter()` array and the `.forEach()` closure that the old per-handler
 * implementation allocated on every input event — notably costly for
 * high-frequency mousemove/pointermove events. `key`/`button` use `null` as the
 * "don't care" sentinel so a real button value of 0 still matches.
 */
function dispatchBindings(
  ic: InputControllerT,
  eventType: InputEventType,
  e: Event,
  key: string | null,
  button: number | null,
  value: number | undefined,
  allowPreventDefault: boolean,
): void {
  const bindings = ic.bindings;
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    if (binding.eventType !== eventType) continue;
    if (key !== null && binding.key !== key) continue;
    if (button !== null && binding.button !== button) continue;

    triggerAction(ic, binding.action, e, value);

    if (allowPreventDefault && ic.preventDefault) {
      e.preventDefault();
    }
  }
}

function handleKeyDown(ic: InputControllerT, e: KeyboardEvent): void {
  const key = e.key;
  ic.activeInputs.add(`key:${key}`);
  dispatchBindings(ic, 'keydown', e, key, null, undefined, true);
}

function handleKeyUp(ic: InputControllerT, e: KeyboardEvent): void {
  const key = e.key;
  ic.activeInputs.delete(`key:${key}`);
  dispatchBindings(ic, 'keyup', e, key, null, undefined, true);
}

function handleMouseDown(ic: InputControllerT, e: MouseEvent): void {
  const button = e.button;
  ic.activeInputs.add(`button:${button}`);
  dispatchBindings(ic, 'mousedown', e, null, button, undefined, false);
}

function handleMouseUp(ic: InputControllerT, e: MouseEvent): void {
  const button = e.button;
  ic.activeInputs.delete(`button:${button}`);
  dispatchBindings(ic, 'mouseup', e, null, button, undefined, false);
}

function handleMouseMove(ic: InputControllerT, e: MouseEvent): void {
  dispatchBindings(ic, 'mousemove', e, null, null, undefined, false);
}

function handleWheel(ic: InputControllerT, e: WheelEvent): void {
  dispatchBindings(ic, 'wheel', e, null, null, e.deltaY, false);
}

function handleClick(ic: InputControllerT, e: MouseEvent): void {
  dispatchBindings(ic, 'click', e, null, null, undefined, false);
}

function handleContextMenu(ic: InputControllerT, e: MouseEvent): void {
  dispatchBindings(ic, 'contextmenu', e, null, null, undefined, true);
}

function handlePointerDown(ic: InputControllerT, e: PointerEvent): void {
  const button = e.button;
  ic.activeInputs.add(`pointer:${button}`);
  dispatchBindings(ic, 'pointerdown', e, null, button, undefined, false);
}

function handlePointerUp(ic: InputControllerT, e: PointerEvent): void {
  const button = e.button;
  ic.activeInputs.delete(`pointer:${button}`);
  dispatchBindings(ic, 'pointerup', e, null, button, undefined, false);
}

function handlePointerMove(ic: InputControllerT, e: PointerEvent): void {
  dispatchBindings(ic, 'pointermove', e, null, null, undefined, false);
}

function handleTouchStart(ic: InputControllerT, e: TouchEvent): void {
  dispatchBindings(ic, 'touchstart', e, null, null, undefined, false);
}

function handleTouchEnd(ic: InputControllerT, e: TouchEvent): void {
  dispatchBindings(ic, 'touchend', e, null, null, undefined, false);
}

function handleTouchMove(ic: InputControllerT, e: TouchEvent): void {
  dispatchBindings(ic, 'touchmove', e, null, null, undefined, false);
}

function handleGamepadConnected(ic: InputControllerT, e: GamepadEvent): void {
  dispatchBindings(ic, 'gamepadconnected', e, null, null, undefined, false);
}

function handleGamepadDisconnected(
  ic: InputControllerT,
  e: GamepadEvent,
): void {
  dispatchBindings(ic, 'gamepaddisconnected', e, null, null, undefined, false);
}

/**
 * Triggers all registered callbacks for a specific action.
 */
function triggerAction(
  ic: InputControllerT,
  action: string,
  event?: Event,
  value?: number,
): void {
  const callbacks = ic.actionCallbacks.get(action);
  if (!callbacks || callbacks.length === 0) return;

  for (let i = 0; i < callbacks.length; i++) {
    try {
      callbacks[i](event, value);
    } catch (error) {
      console.error(
        `[input-controller] Error in action callback for '${action}':`,
        error,
      );
    }
  }
}

export const InputController: InputControllerMethods = {
  type: 'input-controller',
  init,
  update,
  dispose,
  bindAction,
  unbindAction,
  onAction,
  offAction,
  isActionPressed,
  getAxis,
};
