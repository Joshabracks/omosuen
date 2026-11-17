/**
 * Which visibility shapes are kept when a consumer has capped how many render
 * (`FogOfWarT.maxVisibilityShapes`). With no cap -- the default -- nothing here
 * runs: every shape renders.
 *
 * Deliberately a leaf module: no GL, no component imports, nothing from the
 * registry -- same reasoning as fog-of-war/sweep.ts. The selection policy is
 * the part worth pinning with tests, and it should be testable without a
 * WebGL context or a live scene.
 *
 * Before this existed, the renderer uploaded the first N sources in
 * scene-graph registration order, so which ones reached the shader was an
 * accident of creation order -- a colony past N villagers rendered most of
 * itself as remembered terrain even with a villager standing on it.
 */

/** The fields selection reads. Entries carry whatever else they like. */
export interface ScoredVisionEntry {
  score: number;
  /**
   * Consumer-set rank, higher kept first. Compared BEFORE `score`, so a
   * priority source always beats a nearer default one. Absent reads as 0.
   */
  priority?: number;
}

/**
 * The renderer's axonometric projection, as render/index.ts derives it from
 * the camera: the camera's own projected position plus the terms that project
 * any other world point the same way unified.vert does.
 */
export interface ShapeProjection {
  camIsoX: number;
  camIsoY: number;
  sinA: number;
  heightScale: number;
  cosYaw: number;
  sinYaw: number;
}

/** cos(30deg): the axonometric horizontal spread, as in render/index.ts. */
const ISO_H = 0.8660254;

/**
 * How much a shape deserves a slot, lower being better: its distance ON SCREEN
 * from the view centre, less its outer reach.
 *
 * Replaces `visionSourceScore` as the renderer's default. That one measured a
 * plain 3D distance from the camera transform, and on an orthographic rig the
 * camera's position along the view axis is arbitrary -- moving it toward or
 * away from the scene changes nothing on screen. A 3D distance folds that depth
 * in, so it favoured shapes toward whichever screen edge lay nearer the camera
 * along the view axis rather than shapes near the middle of the view. Projecting
 * both points through the same axonometric transform the vertex shader uses and
 * measuring in that plane drops the view-axis term entirely.
 */
export function projectedShapeScore(
  proj: ShapeProjection,
  x: number,
  y: number,
  z: number,
  outer: number,
): number {
  const rx = x * proj.cosYaw + z * proj.sinYaw;
  const rz = -x * proj.sinYaw + z * proj.cosYaw;
  const isoX = ISO_H * (rx - rz);
  const isoY = proj.sinA * (rx + rz) - proj.heightScale * y;
  const dx = isoX - proj.camIsoX;
  const dy = isoY - proj.camIsoY;
  return Math.sqrt(dx * dx + dy * dy) - outer;
}

/** Stable priority-then-score order used by `selectNearestVisionSources`. */
function compareEntries(a: ScoredVisionEntry, b: ScoredVisionEntry): number {
  const pa = a.priority ?? 0;
  const pb = b.priority ?? 0;
  if (pa !== pb) return pb - pa;
  return a.score - b.score;
}

/**
 * How much a source deserves a uniform slot, lower being better: the distance
 * from the camera to the nearest point of the source's influence sphere.
 * Negative when the camera sits inside that sphere.
 *
 * `outer` is `radius + fadeWidth` -- the same outer edge the shader's radial
 * early-out tests against. Subtracting it is what makes a wide-footprint
 * building outrank a small villager that happens to be marginally nearer the
 * view centre: the building actually covers more of what is on screen, which
 * is the whole question being asked here.
 */
export function visionSourceScore(
  camX: number,
  camY: number,
  camZ: number,
  x: number,
  y: number,
  z: number,
  outer: number,
): number {
  const dx = x - camX;
  const dy = y - camY;
  const dz = z - camZ;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - outer;
}

/**
 * Reorders `entries` in place so the first `min(entries.length, max)` are the
 * ones to keep -- highest `priority` first, then best `score` -- and returns
 * that count. The caller truncates.
 *
 * `entries.length` is the source count -- pass a true-length array, not one of
 * the high-water-mark buffers that carry a separate count.
 *
 * Does no work at all when the array already fits, so the common case (a scene
 * well under the cap) keeps its registration order and pays nothing. Above the
 * cap it sorts in place; the array holds references, so this allocates nothing,
 * and n log n beats a k-pass selection scan for any k near the cap. The sort is
 * stable, so equal scores keep registration order rather than shuffling frame
 * to frame.
 */
export function selectNearestVisionSources<T extends ScoredVisionEntry>(
  entries: T[],
  max: number,
): number {
  if (entries.length <= max) return entries.length;
  entries.sort(compareEntries);
  return Math.max(0, max);
}
