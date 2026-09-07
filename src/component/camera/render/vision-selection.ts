/**
 * Which vision sources win the uniform slots when a scene has more of them
 * than the shader can hold.
 *
 * Deliberately a leaf module: no GL, no component imports, nothing from the
 * registry -- same reasoning as fog-of-war/sweep.ts. The selection policy is
 * the part worth pinning with tests, and it should be testable without a
 * WebGL context or a live scene.
 *
 * Before this existed, `setVisionUniforms` uploaded the first N sources in
 * scene-graph registration order, so which ones reached the shader was an
 * accident of creation order -- a colony past N villagers rendered most of
 * itself as remembered terrain even with a villager standing on it.
 */

/** The one field selection reads. Entries carry whatever else they like. */
export interface ScoredVisionEntry {
  score: number;
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
 * best-scoring ones, and returns that count. The caller truncates.
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
  entries.sort((a, b) => a.score - b.score);
  return max;
}
