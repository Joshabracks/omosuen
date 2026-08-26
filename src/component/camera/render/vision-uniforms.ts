import { VisionSourceT } from '../../vision-source';
import { NexusT } from '../../nexus';
import { TransformT } from '../../transform';
import { castTo } from '../../types';
import { Vector3D } from '../../../math';

/** Max simultaneous vision sources uploaded per frame (must match unified.frag). */
export const MAX_VISION_SOURCES = 8;

// Vision-source uniform location caches — keyed by camera component ID
const _numVisionSources = new Map<number, WebGLUniformLocation | null>();
const _visionSourcePos = new Map<number, (WebGLUniformLocation | null)[]>();
const _visionSourceRadius = new Map<number, (WebGLUniformLocation | null)[]>();
const _visionSourceFadeWidth = new Map<
  number,
  (WebGLUniformLocation | null)[]
>();

// Per-frame resolved-source array — reused to avoid allocations
const _sourcesArr: { source: VisionSourceT; pos: Vector3D }[] = [];

// Reused scratch for vec3 uniform uploads (see light-uniforms.ts for why a
// shared buffer per call is safe: gl.uniform*fv copies synchronously).
const scratchVec3 = new Float32Array(3);

export function cacheVisionUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cameraId: number,
): void {
  _numVisionSources.set(
    cameraId,
    gl.getUniformLocation(program, 'u_numVisionSources'),
  );

  const pos: (WebGLUniformLocation | null)[] = [];
  const radius: (WebGLUniformLocation | null)[] = [];
  const fadeWidth: (WebGLUniformLocation | null)[] = [];
  for (let i = 0; i < MAX_VISION_SOURCES; i++) {
    pos[i] = gl.getUniformLocation(program, `u_visionSourcePos[${i}]`);
    radius[i] = gl.getUniformLocation(program, `u_visionSourceRadius[${i}]`);
    fadeWidth[i] = gl.getUniformLocation(
      program,
      `u_visionSourceFadeWidth[${i}]`,
    );
  }
  _visionSourcePos.set(cameraId, pos);
  _visionSourceRadius.set(cameraId, radius);
  _visionSourceFadeWidth.set(cameraId, fadeWidth);
}

export function clearVisionUniformCache(cameraId: number): void {
  _numVisionSources.delete(cameraId);
  _visionSourcePos.delete(cameraId);
  _visionSourceRadius.delete(cameraId);
  _visionSourceFadeWidth.delete(cameraId);
}

/**
 * Uploads vision-source uniform values (position resolved via each source's
 * sibling transform, exactly like point/spot lights in light-uniforms.ts).
 * Uses module-level cached uniform locations (populated by
 * cacheVisionUniformLocations). Zero sources uploads `u_numVisionSources = 0`
 * — callers should treat that as "nothing is currently in view" (no implicit
 * always-visible fallback, unlike the old default-directional-light behavior
 * for lighting).
 */
export function setVisionUniforms(
  gl: WebGL2RenderingContext,
  cameraId: number,
  visionSources: VisionSourceT[],
): void {
  _sourcesArr.length = 0;
  for (const source of visionSources) {
    if (!source.enabled) continue;
    const parent = source.parent;
    if (!parent || parent.type !== 'nexus') continue;
    const nexus = castTo<NexusT>(parent);
    const siblingTransform = nexus.getComponentByType(
      'transform',
      false,
    ) as TransformT | null;
    if (!siblingTransform) continue;
    _sourcesArr.push({ source, pos: siblingTransform.worldPosition });
  }

  const locNum = _numVisionSources.get(cameraId)!;
  const locPos = _visionSourcePos.get(cameraId)!;
  const locRadius = _visionSourceRadius.get(cameraId)!;
  const locFadeWidth = _visionSourceFadeWidth.get(cameraId)!;

  const num = Math.min(_sourcesArr.length, MAX_VISION_SOURCES);
  gl.uniform1i(locNum, num);
  for (let i = 0; i < num; i++) {
    const { source, pos } = _sourcesArr[i];
    scratchVec3[0] = pos.x;
    scratchVec3[1] = pos.y;
    scratchVec3[2] = pos.z;
    gl.uniform3fv(locPos[i], scratchVec3);
    gl.uniform1f(locRadius[i], source.radius);
    gl.uniform1f(locFadeWidth[i], source.fadeWidth);
  }
}
