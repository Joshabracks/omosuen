/**
 * World-transform propagation.
 *
 * Refreshes every transform's cached world TRS (`worldPosition` / `worldRotation`
 * / `worldScale`) in a single top-down pass over the nexus tree, folding each
 * parent's world transform into its descendants. Run once per frame before render
 * (see loop/manager). This replaces per-consumer ancestry walks (which were
 * O(N²) + GC via `getComponentByType`) with one O(total-components) pass that
 * allocates nothing (scalar recursion args, in-place vector writes).
 *
 * Compose rule (matches Transform.composeWorld / colliders):
 *   worldPos   = parentWorldPos + localPos * parentWorldScale
 *   worldScale = parentWorldScale * localScale
 *   worldRot   = parentWorldRot + localRot
 * A nexus with no transform passes the parent's world TRS through unchanged, so a
 * descendant inherits the nearest ancestor transform.
 */

import type { NexusT } from '../nexus/data';
import type { TransformT } from './data';

export function updateWorldTransforms(root: NexusT): void {
  propagate(root, 0, 0, 0, 1, 1, 1, 0, 0, 0);
}

function propagate(
  nexus: NexusT,
  px: number, py: number, pz: number,
  sx: number, sy: number, sz: number,
  rx: number, ry: number, rz: number,
): void {
  const comps = nexus.components;

  // This nexus's own transform (first 'transform' child) — manual scan, no closure.
  let t: TransformT | null = null;
  for (let i = 0; i < comps.length; i++) {
    if (comps[i].type === 'transform') {
      t = comps[i] as unknown as TransformT;
      break;
    }
  }

  // World TRS to pass to children: this transform composed with the parent's, or
  // the parent's unchanged when this nexus has no transform.
  let wpx = px, wpy = py, wpz = pz;
  let wsx = sx, wsy = sy, wsz = sz;
  let wrx = rx, wry = ry, wrz = rz;

  if (t) {
    const lp = t.position;
    const ls = t.scale;
    const lr = t.rotation;
    wpx = px + lp.x * sx;
    wpy = py + lp.y * sy;
    wpz = pz + lp.z * sz;
    wsx = sx * ls.x;
    wsy = sy * ls.y;
    wsz = sz * ls.z;
    wrx = rx + lr.x;
    wry = ry + lr.y;
    wrz = rz + lr.z;

    const wp = t.worldPosition;
    const ws = t.worldScale;
    const wr = t.worldRotation;
    wp.x = wpx; wp.y = wpy; wp.z = wpz;
    ws.x = wsx; ws.y = wsy; ws.z = wsz;
    wr.x = wrx; wr.y = wry; wr.z = wrz;
  }

  for (let i = 0; i < comps.length; i++) {
    if (comps[i].type === 'nexus') {
      propagate(
        comps[i] as unknown as NexusT,
        wpx, wpy, wpz, wsx, wsy, wsz, wrx, wry, wrz,
      );
    }
  }
}
