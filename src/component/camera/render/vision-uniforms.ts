import { VisionSourceT } from '../../vision-source';
import { NexusT } from '../../nexus';
import { TransformT } from '../../transform';
import { castTo } from '../../types';
import { Vector3D } from '../../../math';
import {
  selectNearestVisionSources,
  visionSourceScore,
} from './vision-selection';

/**
 * Max simultaneous vision sources uploaded per frame.
 *
 * The single source of truth for the cap: camera/init substitutes this value
 * into unified.frag's `const int MAX_VISION_SOURCES` before compiling, so the
 * GLSL declaration cannot silently drift from this one. Change it here.
 *
 * On the cost of raising it: the shader rejects an out-of-range source in
 * `visionSourceVisibility` BEFORE its eight DDA raycasts, and every loop over
 * these arrays breaks at `u_numVisionSources`, so a scene with six sources
 * pays for six however high this goes. The cap costs one distance test per
 * uploaded source per fragment, not a raycast set. Uniform budget is the other
 * limit -- 64 sources is 192 fragment uniform vectors, alongside the 320 that
 * MAX_POINT_LIGHTS = 64 already spends.
 */
export const MAX_VISION_SOURCES = 64;

// Vision-source uniform location caches — keyed by camera component ID.
// The three array uniforms cache one location each (element 0) rather than one
// per element: the whole array uploads through it in a single gl.uniform*fv,
// so the GL call count is flat in MAX_VISION_SOURCES.
const numVisionSourcesLoc = new Map<number, WebGLUniformLocation | null>();
const fogUseLineOfSightLoc = new Map<number, WebGLUniformLocation | null>();
const visionSourcePosLoc = new Map<number, WebGLUniformLocation | null>();
const visionSourceRadiusLoc = new Map<number, WebGLUniformLocation | null>();
const visionSourceFadeWidthLoc = new Map<number, WebGLUniformLocation | null>();

interface ResolvedEntry {
  source: VisionSourceT;
  pos: Vector3D;
  /** See visionSourceScore -- lower wins a uniform slot. */
  score: number;
}

// Entry pool, grown to a high-water mark and rewritten in place. A colony with
// a few hundred villagers resolves every one of them twice a frame (cell-map
// pass and sprite pass), and these entries used to be allocated fresh each
// time.
const sourcePool: ResolvedEntry[] = [];

// Per-frame resolved-source array — holds REFERENCES into sourcePool, so
// clearing and refilling it allocates nothing. Trimmed to the uploaded count
// at the end of setVisionUniforms, which is what getResolvedVisionSources
// hands out.
const sourcesArr: ResolvedEntry[] = [];

// Reused upload buffers (see light-uniforms.ts for why a shared buffer per
// call is safe: gl.uniform*fv copies synchronously).
const posBuf = new Float32Array(MAX_VISION_SOURCES * 3);
const radiusBuf = new Float32Array(MAX_VISION_SOURCES);
const fadeWidthBuf = new Float32Array(MAX_VISION_SOURCES);

export function cacheVisionUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cameraId: number,
): void {
  numVisionSourcesLoc.set(
    cameraId,
    gl.getUniformLocation(program, 'u_numVisionSources'),
  );
  fogUseLineOfSightLoc.set(
    cameraId,
    gl.getUniformLocation(program, 'u_fogUseLineOfSight'),
  );

  // Element 0's location addresses the whole array for gl.uniform*fv.
  visionSourcePosLoc.set(
    cameraId,
    gl.getUniformLocation(program, 'u_visionSourcePos[0]'),
  );
  visionSourceRadiusLoc.set(
    cameraId,
    gl.getUniformLocation(program, 'u_visionSourceRadius[0]'),
  );
  visionSourceFadeWidthLoc.set(
    cameraId,
    gl.getUniformLocation(program, 'u_visionSourceFadeWidth[0]'),
  );
}

/**
 * The sources `setVisionUniforms` selected on its last call, in the same order
 * and already truncated the same way, so a CPU-side visibility computation is
 * guaranteed to be looking at exactly what the shader was handed.
 *
 * Live view of the reused per-frame array -- read it before the next
 * `setVisionUniforms` call, and don't retain it.
 */
export function getResolvedVisionSources(): readonly {
  source: VisionSourceT;
  pos: Vector3D;
}[] {
  return sourcesArr;
}

export function clearVisionUniformCache(cameraId: number): void {
  numVisionSourcesLoc.delete(cameraId);
  fogUseLineOfSightLoc.delete(cameraId);
  visionSourcePosLoc.delete(cameraId);
  visionSourceRadiusLoc.delete(cameraId);
  visionSourceFadeWidthLoc.delete(cameraId);
}

/**
 * Uploads vision-source uniform values (position resolved via each source's
 * sibling transform, exactly like point/spot lights in light-uniforms.ts).
 * Uses module-level cached uniform locations (populated by
 * cacheVisionUniformLocations). Zero sources uploads `u_numVisionSources = 0`
 * — callers should treat that as "nothing is currently in view" (no implicit
 * always-visible fallback, unlike the old default-directional-light behavior
 * for lighting).
 *
 * More sources than MAX_VISION_SOURCES are ranked by `visionSourceScore`
 * against `cameraPos` and the nearest are kept. This used to be a plain
 * truncate in scene-graph order, which meant a colony past the cap rendered
 * most of itself as remembered terrain while eight arbitrary villagers --
 * possibly all off-screen -- held every slot.
 *
 * `cameraPos` must be the rendering camera's own transform world position.
 * Both passes read it from the same transform, which is what guarantees they
 * select the same set: render-sprites calls getResolvedVisionSources()
 * immediately after its own call here to compute CPU sprite visibility, and
 * sprite fog disagreeing with terrain fog would be visible.
 *
 * `useLineOfSight` is `FogOfWarT.visionMode`, uploaded here so it always
 * travels with the source data it applies to.
 *
 * Note this cap applies to RENDERING only. `resolveActiveVisionSources` in
 * fog-of-war/methods.ts stays uncapped on purpose, so off-screen actors keep
 * banking explored terrain.
 */
export function setVisionUniforms(
  gl: WebGL2RenderingContext,
  cameraId: number,
  visionSources: VisionSourceT[],
  cameraPos: Vector3D,
  useLineOfSight = true,
): void {
  sourcesArr.length = 0;
  let resolved = 0;
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
    const pos = siblingTransform.worldPosition;

    let entry = sourcePool[resolved];
    if (entry === undefined) {
      entry = { source, pos, score: 0 };
      sourcePool[resolved] = entry;
    } else {
      entry.source = source;
      entry.pos = pos;
    }
    entry.score = visionSourceScore(
      cameraPos.x,
      cameraPos.y,
      cameraPos.z,
      pos.x,
      pos.y,
      pos.z,
      source.radius + source.fadeWidth,
    );
    sourcesArr.push(entry);
    resolved++;
  }

  // Drop pooled slots a shrunken population no longer refills, so disposed
  // sources and their transforms aren't held alive by the high-water mark.
  // Hysteresis keeps a frame-to-frame wobble from reallocating every frame.
  if (sourcePool.length > resolved * 2 + MAX_VISION_SOURCES) {
    sourcePool.length = resolved;
  }

  const num = selectNearestVisionSources(sourcesArr, MAX_VISION_SOURCES);
  sourcesArr.length = num;

  gl.uniform1i(numVisionSourcesLoc.get(cameraId) ?? null, num);
  // Uploaded here rather than beside the style uniforms so it cannot get out
  // of step with the source arrays it modifies -- both programs reach the
  // shader's vision block through this one call.
  gl.uniform1i(
    fogUseLineOfSightLoc.get(cameraId) ?? null,
    useLineOfSight ? 1 : 0,
  );

  if (num === 0) return;
  for (let i = 0; i < num; i++) {
    const { source, pos } = sourcesArr[i];
    posBuf[i * 3] = pos.x;
    posBuf[i * 3 + 1] = pos.y;
    posBuf[i * 3 + 2] = pos.z;
    radiusBuf[i] = source.radius;
    fadeWidthBuf[i] = source.fadeWidth;
  }
  // srcLength bounds each upload to the slots actually filled -- the tail of
  // each buffer still holds the previous frame's values, and the shader's
  // loops stop at u_numVisionSources anyway.
  gl.uniform3fv(visionSourcePosLoc.get(cameraId) ?? null, posBuf, 0, num * 3);
  gl.uniform1fv(visionSourceRadiusLoc.get(cameraId) ?? null, radiusBuf, 0, num);
  gl.uniform1fv(
    visionSourceFadeWidthLoc.get(cameraId) ?? null,
    fadeWidthBuf,
    0,
    num,
  );
}
