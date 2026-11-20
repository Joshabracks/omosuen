import type { VisionSourceT } from '../../vision-source/data';
import type { VisibilityVolumeT } from '../../visibility-volume/data';
import type { NexusT } from '../../nexus/data';
import type { TransformT } from '../../transform/data';
import type { ResolvedSource } from '../../fog-of-war/sweep';
import type { Vector3D } from '../../../math';
import { castTo } from '../../types';
import {
  TEXELS_PER_SHAPE,
  VIS_TEX_WIDTH,
  binWordCount,
  buildShapeGrid,
  createShapeGrid,
  packBinWords,
  packShapeTexels,
  texRows,
} from './visibility-shapes';
import type { GridClamp, ShapeGrid } from './visibility-shapes';
import {
  projectedShapeScore,
  selectNearestVisionSources,
} from './vision-selection';
import type { ShapeProjection } from './vision-selection';

/**
 * Fog-of-war visibility data for the shader: every vision-source sphere and
 * every visibility-volume box, uploaded as two runtime-sized data textures and
 * binned on one XZ grid (see ./visibility-shapes.ts).
 *
 * This replaced three fixed uniform arrays sized by a compiled-in
 * `MAX_VISION_SOURCES` (8, then 64). Uniform arrays could not grow further --
 * 64 sources already spent 192 fragment uniform vectors alongside the lights'
 * 320, past WebGL2's guaranteed 224 -- and the cap silently dropped sources a
 * colony sim cannot budget for. Nothing here has a count compiled in: storage
 * grows by texture rows, and per-fragment cost follows the shapes binned under
 * that fragment rather than the scene total.
 *
 * A consumer CAN cap rendering (`FogOfWarT.maxVisibilityShapes`); when it
 * does, its `selectionKey` or the shapes' `priority` decide what is kept, and
 * `getVisibilityStats` reports what was dropped.
 *
 * Built ONCE per camera per frame (`prepareVisibilityFrame`, from
 * render/index.ts) and bound by both passes (`bindVisibilityUniforms`), so the
 * cell-map and sprite passes cannot disagree about the set. The CPU sprite path
 * reads the same set and the same grid back through `getVisibilityFrame`, which
 * is what keeps sprite fog matching terrain fog.
 *
 * Rendering only. Exploration and the sprite sweep (fog-of-war/methods.ts,
 * explored-sweep.ts) resolve every enabled source themselves, uncapped.
 */

/** Texture units the two data textures live on (clear of every other user). */
const UNIT_SHAPES = 12;
const UNIT_BINS = 13;

/** One shape competing for a render slot -- what a `fog-selection` sees. */
export interface VisibilityCandidate {
  kind: 'vision-source' | 'visibility-volume';
  component: VisionSourceT | VisibilityVolumeT;
  /** The sibling transform's world position (a live reference; don't mutate). */
  position: Vector3D;
  /** Default ranking: on-screen distance from the view centre less reach. Lower is better. */
  score: number;
  /** The component's `priority`. Higher is kept first by the default policy. */
  priority: number;
}

/**
 * A `MethodRegistry['fog-selection']` entry: reorder `candidates` in place so
 * the first `capacity` are the ones to keep. The engine truncates afterwards.
 */
export type VisibilitySelector = (
  candidates: VisibilityCandidate[],
  capacity: number,
) => void;

/** Render-side shape accounting for the most recent frame. */
export interface VisibilityStats {
  /** The effective cap: `maxVisibilityShapes`, or the device limit if lower. */
  capacity: number;
  /** Enabled shapes with a transform, before any cap. */
  resolved: number;
  /** Shapes actually handed to the shader. */
  uploaded: number;
  /** `resolved - uploaded`. */
  dropped: number;
}

/** The resident cell window, in the units the raycast and bins need. */
export interface VisibilityCellInfo {
  cellSize: { x: number; y: number; z: number };
  /** Window origin in CELLS. */
  windowOriginLocalCell: { x: number; y: number; z: number };
  /** Window size in cells. */
  windowSize: { x: number; y: number; z: number };
}

export interface VisibilityFrameOptions {
  /** `FogOfWarT.maxVisibilityShapes`; Infinity for no cap. */
  capacity: number;
  /** Resolved `FogOfWarT.selectionKey`, or null for the default policy. */
  selector: VisibilitySelector | null;
  projection: ShapeProjection;
  /** The first cell-map's window, or null with no committed cell-map. */
  cell: VisibilityCellInfo | null;
}

/** What the CPU side needs to agree with the shader. See getVisibilityFrame. */
export interface VisibilityFrame {
  /** The uploaded shapes, in upload order; `count` valid entries. */
  shapes: ResolvedSource[];
  count: number;
  /** The grid uploaded with them. */
  grid: ShapeGrid;
  /** Enabled shapes before any cap -- the "is fog active at all" signal. */
  resolved: number;
}

interface CameraVisibilityGL {
  shapeTex: WebGLTexture | null;
  binTex: WebGLTexture | null;
  shapeRows: number;
  binRows: number;
  numShapesLoc: WebGLUniformLocation | null;
  useLineOfSightLoc: WebGLUniformLocation | null;
  shapesLoc: WebGLUniformLocation | null;
  binsLoc: WebGLUniformLocation | null;
  gridOriginLoc: WebGLUniformLocation | null;
  binSizeLoc: WebGLUniformLocation | null;
  binDimsLoc: WebGLUniformLocation | null;
}

const cameraGL = new Map<number, CameraVisibilityGL>();

// ── Per-frame state (one camera renders at a time) ──────────────────────────

const candidatePool: VisibilityCandidate[] = [];
/** References into candidatePool; refilled each frame without allocating. */
const candidates: VisibilityCandidate[] = [];

const shapePool: ResolvedSource[] = [];
const halfPool: { x: number; y: number; z: number }[] = [];
const grid = createShapeGrid();
let shapeTexData = new Float32Array(VIS_TEX_WIDTH * 4);
let binTexData = new Uint32Array(VIS_TEX_WIDTH);

const frame: VisibilityFrame = {
  shapes: shapePool,
  count: 0,
  grid,
  resolved: 0,
};

const stats: VisibilityStats = {
  capacity: Infinity,
  resolved: 0,
  uploaded: 0,
  dropped: 0,
};
let warnedDrop = false;
let warnedDeviceLimit = false;

let cachedMaxTextureSize = 0;

/** Bins are never narrower than this many cells. */
const MIN_BIN_CELLS = 8;

function siblingTransform(component: { parent: unknown }): TransformT | null {
  const parent = component.parent as { type?: string } | null;
  if (!parent || parent.type !== 'nexus') return null;
  return castTo<NexusT>(parent as NexusT).getComponentByType(
    'transform',
    false,
  ) as TransformT | null;
}

function pushCandidate(
  kind: VisibilityCandidate['kind'],
  component: VisionSourceT | VisibilityVolumeT,
  position: Vector3D,
  score: number,
  priority: number,
): void {
  const i = candidates.length;
  let c = candidatePool[i];
  if (c === undefined) {
    c = { kind, component, position, score, priority };
    candidatePool[i] = c;
  } else {
    c.kind = kind;
    c.component = component;
    c.position = position;
    c.score = score;
    c.priority = priority;
  }
  candidates.push(c);
}

function makeTexture(
  gl: WebGL2RenderingContext,
  unit: number,
): WebGLTexture | null {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // Integer and float32 textures are not filterable; NEAREST also keeps them
  // texture-complete. Every read is a texelFetch anyway.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/**
 * Looks up the visibility uniforms and creates this camera's two data
 * textures (one row each, zeroed -- a valid empty store). Called from
 * camera/init.
 */
export function cacheVisibilityUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cameraId: number,
): void {
  const shapeTex = makeTexture(gl, UNIT_SHAPES);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    VIS_TEX_WIDTH,
    1,
    0,
    gl.RGBA,
    gl.FLOAT,
    new Float32Array(VIS_TEX_WIDTH * 4),
  );
  const binTex = makeTexture(gl, UNIT_BINS);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R32UI,
    VIS_TEX_WIDTH,
    1,
    0,
    gl.RED_INTEGER,
    gl.UNSIGNED_INT,
    new Uint32Array(VIS_TEX_WIDTH),
  );

  cameraGL.set(cameraId, {
    shapeTex,
    binTex,
    shapeRows: 1,
    binRows: 1,
    numShapesLoc: gl.getUniformLocation(program, 'u_visNumShapes'),
    useLineOfSightLoc: gl.getUniformLocation(program, 'u_fogUseLineOfSight'),
    shapesLoc: gl.getUniformLocation(program, 'u_visShapes'),
    binsLoc: gl.getUniformLocation(program, 'u_visBins'),
    gridOriginLoc: gl.getUniformLocation(program, 'u_visGridOrigin'),
    binSizeLoc: gl.getUniformLocation(program, 'u_visBinSize'),
    binDimsLoc: gl.getUniformLocation(program, 'u_visBinDims'),
  });
}

/** Drops a disposed camera's textures and cached locations. */
export function clearVisibilityUniformCache(
  gl: WebGL2RenderingContext | null,
  cameraId: number,
): void {
  const state = cameraGL.get(cameraId);
  if (state && gl) {
    if (state.shapeTex) gl.deleteTexture(state.shapeTex);
    if (state.binTex) gl.deleteTexture(state.binTex);
  }
  cameraGL.delete(cameraId);
}

/**
 * The most shapes this device can hold: the shape texture is VIS_TEX_WIDTH
 * texels wide and at most MAX_TEXTURE_SIZE rows tall.
 */
export function deviceShapeLimit(gl: WebGL2RenderingContext): number {
  if (cachedMaxTextureSize === 0) {
    cachedMaxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  }
  return Math.floor((VIS_TEX_WIDTH * cachedMaxTextureSize) / TEXELS_PER_SHAPE);
}

/**
 * Uploads `data` into `tex`, growing it (texImage2D) only when more rows are
 * needed and otherwise rewriting just the rows in use (texSubImage2D).
 * Returns the texture's row count afterwards.
 */
function uploadRows(
  gl: WebGL2RenderingContext,
  unit: number,
  tex: WebGLTexture | null,
  allocatedRows: number,
  rows: number,
  isFloat: boolean,
  data: Float32Array | Uint32Array,
): number {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const internal = isFloat ? gl.RGBA32F : gl.R32UI;
  const format = isFloat ? gl.RGBA : gl.RED_INTEGER;
  const type = isFloat ? gl.FLOAT : gl.UNSIGNED_INT;
  if (rows > allocatedRows) {
    // Grow with headroom so a slowly-growing population doesn't reallocate
    // on every new villager.
    const newRows = Math.max(rows, Math.ceil(allocatedRows * 1.5));
    const perRow = isFloat ? VIS_TEX_WIDTH * 4 : VIS_TEX_WIDTH;
    const full =
      data.length >= newRows * perRow
        ? data
        : isFloat
          ? new Float32Array(newRows * perRow)
          : new Uint32Array(newRows * perRow);
    if (full !== data) full.set(data.subarray(0, rows * perRow));
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internal,
      VIS_TEX_WIDTH,
      newRows,
      0,
      format,
      type,
      full,
    );
    return newRows;
  }
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    VIS_TEX_WIDTH,
    rows,
    format,
    type,
    data,
  );
  return allocatedRows;
}

/**
 * Resolves, selects, bins and uploads this frame's visibility shapes for one
 * camera. Call once per camera per frame, before either render pass.
 *
 * Allocation-free once warmed: candidates, shapes, bins and upload buffers are
 * all pooled at a high-water mark.
 */
export function prepareVisibilityFrame(
  gl: WebGL2RenderingContext,
  cameraId: number,
  visionSources: readonly VisionSourceT[],
  volumes: readonly VisibilityVolumeT[],
  options: VisibilityFrameOptions,
): void {
  const proj = options.projection;
  candidates.length = 0;

  for (const source of visionSources) {
    if (source._disposed === true || !source.enabled) continue;
    const t = siblingTransform(source);
    if (!t) continue;
    const p = t.worldPosition;
    pushCandidate(
      'vision-source',
      source,
      p,
      projectedShapeScore(
        proj,
        p.x,
        p.y,
        p.z,
        source.radius + source.fadeWidth,
      ),
      source.priority ?? 0,
    );
  }
  for (const volume of volumes) {
    if (volume._disposed === true || !volume.enabled) continue;
    const t = siblingTransform(volume);
    if (!t) continue;
    const p = t.worldPosition;
    const s = volume.size;
    const reach =
      Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z) / 2 + volume.fadeWidth;
    pushCandidate(
      'visibility-volume',
      volume,
      p,
      projectedShapeScore(proj, p.x, p.y, p.z, reach),
      volume.priority ?? 0,
    );
  }

  // Drop pooled candidates a shrunken scene no longer refills, so disposed
  // components aren't held alive by the high-water mark. Hysteresis keeps a
  // frame-to-frame wobble from reallocating every frame.
  if (candidatePool.length > candidates.length * 2 + 64) {
    candidatePool.length = candidates.length;
  }

  // ── Capacity ──────────────────────────────────────────────────────────────
  const resolved = candidates.length;
  const deviceLimit = deviceShapeLimit(gl);
  const requested =
    typeof options.capacity === 'number' && options.capacity >= 0
      ? options.capacity
      : Infinity;
  if (resolved > deviceLimit && requested > deviceLimit && !warnedDeviceLimit) {
    warnedDeviceLimit = true;
    console.error(
      `[fog-of-war] ${resolved} visibility shapes exceed this device's limit of ` +
        `${deviceLimit} (MAX_TEXTURE_SIZE rows x ${VIS_TEX_WIDTH} texels). ` +
        'The excess is dropped; set fogOfWar.maxVisibilityShapes to choose a budget.',
    );
  }
  const capacity = Math.min(requested, deviceLimit);
  let kept = resolved;
  if (resolved > capacity) {
    if (options.selector) {
      options.selector(candidates, capacity);
      kept = Math.max(0, Math.floor(capacity));
    } else {
      kept = selectNearestVisionSources(candidates, Math.floor(capacity));
    }
    candidates.length = kept;
    if (!warnedDrop) {
      warnedDrop = true;
      console.warn(
        `[fog-of-war] ${resolved - kept} of ${resolved} visibility shapes were ` +
          `not rendered this frame (capacity ${capacity}). Exploration still ` +
          'uses every source. See fogOfWar.getVisionStats().',
      );
    }
  }
  stats.capacity = capacity;
  stats.resolved = resolved;
  stats.uploaded = kept;
  stats.dropped = resolved - kept;

  // ── Shapes ────────────────────────────────────────────────────────────────
  const cell = options.cell;
  for (let i = 0; i < kept; i++) {
    const c = candidates[i];
    let s = shapePool[i];
    if (s === undefined) {
      s = {
        pos: { x: 0, y: 0, z: 0 },
        localCell: { x: 0, y: 0, z: 0 },
        outerSq: 0,
        radius: 0,
        fadeWidth: 0,
        half: null,
      };
      shapePool[i] = s;
      halfPool[i] = { x: 0, y: 0, z: 0 };
    }
    const p = c.position;
    s.pos.x = p.x;
    s.pos.y = p.y;
    s.pos.z = p.z;
    if (cell) {
      s.localCell.x = p.x / cell.cellSize.x - cell.windowOriginLocalCell.x;
      s.localCell.y = p.y / cell.cellSize.y - cell.windowOriginLocalCell.y;
      s.localCell.z = p.z / cell.cellSize.z - cell.windowOriginLocalCell.z;
    }
    if (c.kind === 'visibility-volume') {
      const v = c.component as VisibilityVolumeT;
      const h = halfPool[i];
      h.x = Math.max(0, v.size.x) / 2;
      h.y = Math.max(0, v.size.y) / 2;
      h.z = Math.max(0, v.size.z) / 2;
      s.half = h;
      s.radius = 0;
      s.fadeWidth = Math.max(0, v.fadeWidth);
      s.outerSq = 0;
    } else {
      const v = c.component as VisionSourceT;
      s.half = null;
      s.radius = v.radius;
      s.fadeWidth = v.fadeWidth;
      const outer = v.radius + v.fadeWidth;
      s.outerSq = outer * outer;
    }
  }

  // ── Bins ──────────────────────────────────────────────────────────────────
  // Clipped to the resident window when there is one: terrain only exists
  // there, so a far-off outlier must not coarsen the bins over the view.
  let minBin = MIN_BIN_CELLS;
  let boxPad = 1;
  let clamp: GridClamp | null = null;
  if (cell) {
    const cs = cell.cellSize;
    minBin = MIN_BIN_CELLS * Math.max(cs.x, cs.z);
    boxPad = Math.max(cs.x, cs.z);
    clamp = {
      minX: cell.windowOriginLocalCell.x * cs.x,
      minZ: cell.windowOriginLocalCell.z * cs.z,
      maxX: (cell.windowOriginLocalCell.x + cell.windowSize.x) * cs.x,
      maxZ: (cell.windowOriginLocalCell.z + cell.windowSize.z) * cs.z,
    };
  }
  buildShapeGrid(grid, shapePool, kept, minBin, boxPad, clamp);

  frame.count = kept;
  frame.resolved = resolved;

  // ── Upload ────────────────────────────────────────────────────────────────
  const state = cameraGL.get(cameraId);
  if (!state) return;

  const shapeRows = texRows(kept * TEXELS_PER_SHAPE);
  const shapeFloats = shapeRows * VIS_TEX_WIDTH * 4;
  if (shapeTexData.length < shapeFloats) {
    shapeTexData = new Float32Array(
      Math.max(shapeFloats, shapeTexData.length * 2),
    );
  }
  packShapeTexels(shapePool, kept, shapeTexData);
  state.shapeRows = uploadRows(
    gl,
    UNIT_SHAPES,
    state.shapeTex,
    state.shapeRows,
    shapeRows,
    true,
    shapeTexData,
  );

  const words = binWordCount(grid);
  const binRows = texRows(words);
  if (binRows > cachedMaxTextureSize) {
    // Not reachable at any realistic density (millions of bin entries), but
    // an upload past the limit would be a GL error with a blank fog result.
    console.error(
      `[fog-of-war] visibility bin data (${words} words) exceeds the device texture limit`,
    );
    return;
  }
  const binWords = binRows * VIS_TEX_WIDTH;
  if (binTexData.length < binWords) {
    binTexData = new Uint32Array(Math.max(binWords, binTexData.length * 2));
  }
  packBinWords(grid, binTexData);
  state.binRows = uploadRows(
    gl,
    UNIT_BINS,
    state.binTex,
    state.binRows,
    binRows,
    false,
    binTexData,
  );
}

/**
 * Binds this frame's visibility textures and uniforms on the currently-bound
 * unified program. Both passes call it; it re-binds the texture units because
 * other passes (post-process, atlas uploads) may have moved them in between.
 *
 * `useLineOfSight` is `FogOfWarT.visionMode`, uploaded here so it always
 * travels with the shape data it applies to.
 */
export function bindVisibilityUniforms(
  gl: WebGL2RenderingContext,
  cameraId: number,
  useLineOfSight: boolean,
): void {
  const state = cameraGL.get(cameraId);
  if (!state) return;

  // Both samplers are ALWAYS pinned, even with no shapes: an unset sampler
  // defaults to unit 0, where u_albedoTexture (a float sampler2D) lives, and
  // u_visBins is a usampler2D -- two sampler types on one unit is
  // GL_INVALID_OPERATION and every draw silently fails.
  gl.activeTexture(gl.TEXTURE0 + UNIT_SHAPES);
  gl.bindTexture(gl.TEXTURE_2D, state.shapeTex);
  gl.uniform1i(state.shapesLoc, UNIT_SHAPES);
  gl.activeTexture(gl.TEXTURE0 + UNIT_BINS);
  gl.bindTexture(gl.TEXTURE_2D, state.binTex);
  gl.uniform1i(state.binsLoc, UNIT_BINS);

  gl.uniform1i(state.numShapesLoc, frame.count);
  gl.uniform1i(state.useLineOfSightLoc, useLineOfSight ? 1 : 0);
  gl.uniform2f(state.gridOriginLoc, grid.originX, grid.originZ);
  gl.uniform1f(state.binSizeLoc, grid.binSize);
  gl.uniform2i(state.binDimsLoc, grid.binsX, grid.binsZ);
}

/**
 * The shapes and grid the shader received this frame, for CPU-side visibility
 * that must agree with it (render-sprites' per-sprite visibility value).
 * Gather candidates per point with `gatherShapesAt(frame.grid, frame.shapes,
 * x, z, out)` -- exactly the bin the shader walks there.
 *
 * Live view of reused state: read it before the next `prepareVisibilityFrame`
 * and don't retain it.
 */
export function getVisibilityFrame(): VisibilityFrame {
  return frame;
}

/** A copy of the most recent frame's render-side shape accounting. */
export function getVisibilityStats(): VisibilityStats {
  return {
    capacity: stats.capacity,
    resolved: stats.resolved,
    uploaded: stats.uploaded,
    dropped: stats.dropped,
  };
}
