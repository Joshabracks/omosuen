/**
 * On-screen signal.
 *
 * Refreshes every transform's `onScreen` flag in a single top-down pass over
 * the nexus tree, run once per frame right after `updateWorldTransforms` (see
 * loop/manager) so every `worldPosition` — including every camera's own — is
 * already fresh. `onScreen` answers "is this world position visible to AT
 * LEAST ONE camera this frame" (an OR across cameras), not "is this visible
 * to a specific camera" — see
 * .design/spike_scene-graph-traversal/04-presentation-layer-visibility-skip/01-onscreen-signal-foundation.md
 * for why a second pass is needed (rather than folding this into
 * `updateWorldTransforms` itself) and why this is deliberately not reused by
 * the render path, which needs exact per-camera precision instead.
 *
 * Reuses the axonometric projection math already built for click/hover
 * picking (camera/screen-pick) rather than inventing new geometry.
 */

import type { NexusT } from '../nexus/data';
import { Nexus } from '../nexus/methods';
import type { TransformT } from './data';
import type { CameraT } from '../camera/data';
import { resolveProjection, worldToScreen } from '../camera/screen-pick/ray';
import type { ProjectionParams } from '../camera/screen-pick/ray';

/**
 * Screen-pixel padding applied to each viewport edge before testing. A world
 * position (a sprite's anchor point, not its bounds) can sit just outside the
 * viewport while the sprite itself still has visible pixels on-screen. A
 * tunable starting default, not derived from real asset-size data — mirrors
 * render-cell-maps.ts's `frustumPadding` precedent.
 */
const EDGE_PAD_PX = 128;

// Reused per-camera projection-params scratch, mirroring render-sprites.ts's
// parallel-scratch-array idiom: filled by index, grown only to the
// high-water camera count, no per-frame allocation once warmed.
const camParams: ProjectionParams[] = [];
let activeCameraCount = 0;

// Reused single scratch point for worldToScreen's output, avoiding one
// allocation per transform per camera.
const screenPoint = { x: 0, y: 0 };

function newProjectionParamsSlot(): ProjectionParams {
  return {
    viewportWidth: 0,
    viewportHeight: 0,
    zoom: 1,
    projScale: 1,
    sinA: 0.5,
    heightScale: 1,
    cosYaw: 1,
    sinYaw: 0,
    camIsoX: 0,
    camIsoY: 0,
    degenerate: false,
  };
}

/**
 * Resolves every camera in the scene into `camParams`/`activeCameraCount`.
 * A camera is skipped for this frame (not an error) if `resolveProjection`
 * can't resolve it yet -- e.g. not wired into a viewport, or its sibling
 * transform/parent nexus isn't set up. `resolveProjection` already checks
 * everything relevant to whether its projection is usable this frame; there
 * is no separate `_initialized` gate needed on top of it.
 */
function resolveActiveCameras(root: NexusT): void {
  const cameras = Nexus.getComponentsByType(root, 'camera', true) as CameraT[];
  activeCameraCount = 0;
  for (let i = 0; i < cameras.length; i++) {
    if (camParams.length <= activeCameraCount) {
      camParams.push(newProjectionParamsSlot());
    }
    if (resolveProjection(cameras[i], camParams[activeCameraCount])) {
      activeCameraCount++;
    }
  }
}

function testOnScreen(t: TransformT): void {
  if (activeCameraCount === 0) {
    // Fail-open: no camera has resolved yet, so nothing is known to be
    // off-screen -- don't spuriously flip this false.
    t.onScreen = true;
    return;
  }
  const p = t.worldPosition;
  for (let i = 0; i < activeCameraCount; i++) {
    const params = camParams[i];
    worldToScreen(params, p.x, p.y, p.z, screenPoint);
    if (
      screenPoint.x >= -EDGE_PAD_PX &&
      screenPoint.x <= params.viewportWidth + EDGE_PAD_PX &&
      screenPoint.y >= -EDGE_PAD_PX &&
      screenPoint.y <= params.viewportHeight + EDGE_PAD_PX
    ) {
      t.onScreen = true;
      return; // OR semantics: first passing camera wins, no need to test the rest.
    }
  }
  t.onScreen = false;
}

function walkOnScreen(n: NexusT): void {
  const comps = n.components;

  // This nexus's own transform (first 'transform' child) -- manual scan, no
  // closure, mirrors world.ts's propagate(). Unlike propagate(), no TRS to
  // compose here: worldPosition is already fresh from updateWorldTransforms,
  // this pass only reads it.
  for (let i = 0; i < comps.length; i++) {
    if (comps[i].type === 'transform') {
      testOnScreen(comps[i] as unknown as TransformT);
      break;
    }
  }

  for (let i = 0; i < comps.length; i++) {
    if (comps[i].type === 'nexus') {
      walkOnScreen(comps[i] as unknown as NexusT);
    }
  }
}

export function updateOnScreenFlags(root: NexusT): void {
  resolveActiveCameras(root);
  walkOnScreen(root);
}
