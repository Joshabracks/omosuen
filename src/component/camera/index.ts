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
