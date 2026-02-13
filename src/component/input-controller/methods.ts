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
  bindAction: (
    ic: InputControllerT,
    binding: ActionBinding,
  ) => void;
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

  // Attach event listeners to window
  window.addEventListener('keydown', keydownHandler);
  window.addEventListener('keyup', keyupHandler);
  window.addEventListener('mousedown', mousedownHandler);
  window.addEventListener('mouseup', mouseupHandler);
  window.addEventListener('mousemove', mousemoveHandler);
  window.addEventListener('wheel', wheelHandler);
  window.addEventListener('click', clickHandler);
  window.addEventListener('contextmenu', contextmenuHandler);
  window.addEventListener('pointerdown', pointerdownHandler);
  window.addEventListener('pointerup', pointerupHandler);
  window.addEventListener('pointermove', pointermoveHandler);
  window.addEventListener('touchstart', touchstartHandler);
  window.addEventListener('touchend', touchendHandler);
  window.addEventListener('touchmove', touchmoveHandler);
  window.addEventListener('gamepadconnected', gamepadconnectedHandler);
  window.addEventListener('gamepaddisconnected', gamepaddisconnectedHandler);

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

  console.log(`[input-controller] InputController '${ic.name}' initialized`);
}

/**
 * Update loop - can be used for gamepad polling or continuous input processing.
 */
function update(_component: ComponentData, _deltaTime: number): void {
  // Future: Poll gamepad state here if needed
  // const ic = component as InputControllerT;
  // const gamepads = navigator.getGamepads();
  // Process gamepad inputs...
}

/**
 * Disposes the InputController by removing all event listeners.
 */
function dispose(component: ComponentData): void {
  const ic = component as InputControllerT;

  // Remove all event listeners
  ic._eventHandlers.forEach((handler, eventType) => {
    window.removeEventListener(eventType, handler);
  });

  // Clear internal state
  ic._eventHandlers.clear();
  ic.activeInputs.clear();
  ic.actionCallbacks.clear();

  ic._disposed = true;
  console.log(`[input-controller] InputController '${ic.name}' disposed`);
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

function handleKeyDown(ic: InputControllerT, e: KeyboardEvent): void {
  const key = e.key;
  const inputId = `key:${key}`;

  // Add to active inputs
  ic.activeInputs.add(inputId);

  // Find matching bindings and trigger actions
  const matchingBindings = ic.bindings.filter(
    (b) => b.eventType === 'keydown' && b.key === key,
  );

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);

    // Prevent default if configured
    if (ic.preventDefault) {
      e.preventDefault();
    }
  });
}

function handleKeyUp(ic: InputControllerT, e: KeyboardEvent): void {
  const key = e.key;
  const inputId = `key:${key}`;

  // Remove from active inputs
  ic.activeInputs.delete(inputId);

  // Find matching bindings and trigger actions
  const matchingBindings = ic.bindings.filter(
    (b) => b.eventType === 'keyup' && b.key === key,
  );

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);

    // Prevent default if configured
    if (ic.preventDefault) {
      e.preventDefault();
    }
  });
}

function handleMouseDown(ic: InputControllerT, e: MouseEvent): void {
  const button = e.button;
  const inputId = `button:${button}`;

  ic.activeInputs.add(inputId);

  const matchingBindings = ic.bindings.filter(
    (b) => b.eventType === 'mousedown' && b.button === button,
  );

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);
  });
}

function handleMouseUp(ic: InputControllerT, e: MouseEvent): void {
  const button = e.button;
  const inputId = `button:${button}`;

  ic.activeInputs.delete(inputId);

  const matchingBindings = ic.bindings.filter(
    (b) => b.eventType === 'mouseup' && b.button === button,
  );

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);
  });
}

function handleMouseMove(ic: InputControllerT, e: MouseEvent): void {
  const matchingBindings = ic.bindings.filter(
    (b) => b.eventType === 'mousemove',
  );

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);
  });
}

function handleWheel(ic: InputControllerT, e: WheelEvent): void {
  const matchingBindings = ic.bindings.filter((b) => b.eventType === 'wheel');

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e, e.deltaY);
  });
}

function handleClick(ic: InputControllerT, e: MouseEvent): void {
  const matchingBindings = ic.bindings.filter((b) => b.eventType === 'click');

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);
  });
}

function handleContextMenu(ic: InputControllerT, e: MouseEvent): void {
  const matchingBindings = ic.bindings.filter(
    (b) => b.eventType === 'contextmenu',
  );

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);

    if (ic.preventDefault) {
      e.preventDefault();
    }
  });
}

function handlePointerDown(ic: InputControllerT, e: PointerEvent): void {
  const button = e.button;
  const inputId = `pointer:${button}`;

  ic.activeInputs.add(inputId);

  const matchingBindings = ic.bindings.filter(
    (b) => b.eventType === 'pointerdown' && b.button === button,
  );

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);
  });
}

function handlePointerUp(ic: InputControllerT, e: PointerEvent): void {
  const button = e.button;
  const inputId = `pointer:${button}`;

  ic.activeInputs.delete(inputId);

  const matchingBindings = ic.bindings.filter(
    (b) => b.eventType === 'pointerup' && b.button === button,
  );

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);
  });
}

function handlePointerMove(ic: InputControllerT, e: PointerEvent): void {
  const matchingBindings = ic.bindings.filter(
    (b) => b.eventType === 'pointermove',
  );

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);
  });
}

function handleTouchStart(ic: InputControllerT, e: TouchEvent): void {
  const matchingBindings = ic.bindings.filter(
    (b) => b.eventType === 'touchstart',
  );

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);
  });
}

function handleTouchEnd(ic: InputControllerT, e: TouchEvent): void {
  const matchingBindings = ic.bindings.filter((b) => b.eventType === 'touchend');

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);
  });
}

function handleTouchMove(ic: InputControllerT, e: TouchEvent): void {
  const matchingBindings = ic.bindings.filter(
    (b) => b.eventType === 'touchmove',
  );

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);
  });
}

function handleGamepadConnected(ic: InputControllerT, e: GamepadEvent): void {
  const matchingBindings = ic.bindings.filter(
    (b) => b.eventType === 'gamepadconnected',
  );

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);
  });

  console.log(
    `[input-controller] Gamepad connected: ${e.gamepad.id} (index: ${e.gamepad.index})`,
  );
}

function handleGamepadDisconnected(
  ic: InputControllerT,
  e: GamepadEvent,
): void {
  const matchingBindings = ic.bindings.filter(
    (b) => b.eventType === 'gamepaddisconnected',
  );

  matchingBindings.forEach((binding) => {
    triggerAction(ic, binding.action, e);
  });

  console.log(
    `[input-controller] Gamepad disconnected: ${e.gamepad.id} (index: ${e.gamepad.index})`,
  );
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

  callbacks.forEach((callback) => {
    try {
      callback(event, value);
    } catch (error) {
      console.error(
        `[input-controller] Error in action callback for '${action}':`,
        error,
      );
    }
  });
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
