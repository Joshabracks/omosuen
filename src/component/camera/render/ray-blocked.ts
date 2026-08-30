/**
 * The line-of-sight raycast, as a leaf module with no imports.
 *
 * Split out of ./explored-sweep so it can be loaded standalone (by tests, and
 * by fog-of-war's sweep) without dragging in the cell-map barrel and, through
 * it, camera/init's raw .vert/.frag shader imports -- fine for webpack,
 * unloadable by tsx. Same split, and same reason, as
 * camera/screen-pick/projection-math.ts. `explored-sweep.ts` re-exports
 * `isRayBlockedTS` so existing call sites are unaffected.
 *
 * There is exactly one copy of this function. Do not add a second.
 */

function isSolidLocal(
  mask: Uint8Array,
  dims: { x: number; y: number; z: number },
  lx: number,
  ly: number,
  lz: number,
): boolean {
  if (
    lx < 0 ||
    lx >= dims.x ||
    ly < 0 ||
    ly >= dims.y ||
    lz < 0 ||
    lz >= dims.z
  ) {
    return false;
  }
  return mask[lz * dims.y * dims.x + ly * dims.x + lx] > 127;
}

/**
 * TS port of unified.frag's `isRayBlocked` (3D DDA, Amanatides & Woo),
 * operating on window-LOCAL continuous cell-space positions against the same
 * solidity buffer the live per-pixel raycast reads. Kept a direct line-by-
 * line mirror of the shader version (not "improved") so explored-marking
 * agrees with what the live view actually considers visible -- an explored
 * chunk should be one you could actually have seen, not one merely within
 * radius through a wall.
 *
 * Making this FASTER without changing its results is fine. Making it produce
 * DIFFERENT results is not, unless unified.frag changes identically: sprites
 * would pop in and out inconsistently with the terrain around them.
 */
export function isRayBlockedTS(
  mask: Uint8Array,
  dims: { x: number; y: number; z: number },
  originX: number,
  originY: number,
  originZ: number,
  destX: number,
  destY: number,
  destZ: number,
): boolean {
  let px = Math.floor(originX);
  let py = Math.floor(originY);
  let pz = Math.floor(originZ);
  const ex = Math.floor(destX);
  const ey = Math.floor(destY);
  const ez = Math.floor(destZ);
  if (px === ex && py === ey && pz === ez) return false;

  const dx = destX - originX;
  const dy = destY - originY;
  const dz = destZ - originZ;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const sz = Math.sign(dz);

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : 1e10;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : 1e10;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : 1e10;

  let tMaxX =
    dx > 0
      ? (px + 1 - originX) * tDeltaX
      : dx < 0
        ? (originX - px) * tDeltaX
        : 1e10;
  let tMaxY =
    dy > 0
      ? (py + 1 - originY) * tDeltaY
      : dy < 0
        ? (originY - py) * tDeltaY
        : 1e10;
  let tMaxZ =
    dz > 0
      ? (pz + 1 - originZ) * tDeltaZ
      : dz < 0
        ? (originZ - pz) * tDeltaZ
        : 1e10;

  // Generous but bounded -- chunk-center sweep targets are bounded by a
  // source's own radius+fadeWidth, unlike the shader's per-pixel casts which
  // can span the whole resident window.
  const MAX_STEPS = 256;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      px += sx;
      tMaxX += tDeltaX;
    } else if (tMaxY <= tMaxZ) {
      py += sy;
      tMaxY += tDeltaY;
    } else {
      pz += sz;
      tMaxZ += tDeltaZ;
    }

    if (px === ex && py === ey && pz === ez) return false;
    if (
      px < 0 ||
      px >= dims.x ||
      py < 0 ||
      py >= dims.y ||
      pz < 0 ||
      pz >= dims.z
    ) {
      return false;
    }
    if (isSolidLocal(mask, dims, px, py, pz)) return true;
  }
  return false;
}
