/**
 * Camera Component
 *
 * Main rendering component that handles axonometric 3D rendering
 * appearing as 2D. Renders cell maps and billboard sprites.
 */

export { Camera } from './methods';
export {
  CameraT,
  CameraOptions,
  builder,
  CameraSerializer,
  PROPERTY_ALLOWLIST,
} from './data';
export type { CameraMethods } from './methods';

// Screen-to-world picking
export {
  screenPick,
  screenToWorldRay,
  PickBuffer,
  PickKind,
  createPickBuffer,
} from './screen-pick';
export type {
  PickHit,
  PickKindValue,
  PickOptions,
  PickTargets,
} from './screen-pick';
