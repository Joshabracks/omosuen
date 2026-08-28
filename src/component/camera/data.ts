import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
  DeserializationError,
  DeserializeResult,
} from '../types';
import type { CameraMethods } from './methods';

type RGB = { x: number; y: number; z: number };

/**
 * How the AO + cast-shadow cues break up their hard cell-aligned edges (shared so the
 * two cues match). `dither` = white-noise stipple (crisp at high res, coarse under
 * pixelation); `soft-grain` = smooth low-frequency noise; `smooth-fade` = a noiseless
 * gradient/penumbra (best under pixelation); `retro-dither` = ordered Bayer crosshatch.
 */
export type ScatterType =
  | 'dither'
  | 'soft-grain'
  | 'smooth-fade'
  | 'retro-dither';

/**
 * Resolved developer-configurable depth-readability cues for cell rendering. Each
 * effect is weighted (0 = off, zero cost); see DepthCuesOptions for what each does.
 */
export interface DepthCues {
  /** Cliff-edge contour lines (post-process depth-discontinuity). */
  outline: { weight: number; threshold: number; width: number; color: RGB };
  /** Ambient occlusion in recesses/cliff bases (solidity-grid sampling). */
  ao: { weight: number; radius: number; scatter: number };
  /** Directional cast shadows (raymarch toward the first directional light). */
  shadow: { weight: number; distance: number; scatter: number };
  /** Value/hue shift by world-Y so equal textures read as different elevations. */
  heightRamp: {
    weight: number;
    minY: number;
    maxY: number;
    lowColor: RGB;
    highColor: RGB;
  };
  /** Edge-softening style shared by the AO and shadow `scatter` amounts. */
  scatterType: ScatterType;
}

/** Partial form accepted in CameraOptions; missing fields fall back to defaults. */
export interface DepthCuesOptions {
  outline?: {
    weight?: number;
    threshold?: number;
    width?: number;
    color?: Partial<RGB>;
  };
  ao?: { weight?: number; radius?: number; scatter?: number };
  shadow?: { weight?: number; distance?: number; scatter?: number };
  heightRamp?: {
    weight?: number;
    minY?: number;
    maxY?: number;
    lowColor?: Partial<RGB>;
    highColor?: Partial<RGB>;
  };
  scatterType?: ScatterType;
}

const rgb = (
  v: Partial<RGB> | undefined,
  dx: number,
  dy: number,
  dz: number,
): RGB => ({
  x: v?.x ?? dx,
  y: v?.y ?? dy,
  z: v?.z ?? dz,
});

/**
 * Resolve the partial option into a full DepthCues (filling defaults), or null when
 * the option is absent — null keeps every effect off and is the default for cameras.
 */
function resolveDepthCues(o: DepthCuesOptions | undefined): DepthCues | null {
  if (!o) return null;
  return {
    outline: {
      weight: o.outline?.weight ?? 0,
      threshold: o.outline?.threshold ?? 0.02,
      width: o.outline?.width ?? 1,
      color: rgb(o.outline?.color, 0, 0, 0),
    },
    ao: {
      weight: o.ao?.weight ?? 0,
      radius: o.ao?.radius ?? 2,
      scatter: o.ao?.scatter ?? 0,
    },
    shadow: {
      weight: o.shadow?.weight ?? 0,
      distance: o.shadow?.distance ?? 24,
      scatter: o.shadow?.scatter ?? 0,
    },
    heightRamp: {
      weight: o.heightRamp?.weight ?? 0,
      minY: o.heightRamp?.minY ?? 0,
      maxY: o.heightRamp?.maxY ?? 256,
      lowColor: rgb(o.heightRamp?.lowColor, 0.55, 0.6, 0.72),
      highColor: rgb(o.heightRamp?.highColor, 1, 1, 1),
    },
    scatterType: o.scatterType ?? 'dither',
  };
}

/**
 * Camera component for axonometric 3D rendering that appears 2D.
 * Renders cell maps and billboard sprites within the render tree.
 */
export interface CameraT
  extends ComponentData, ComponentInstanceMethods<CameraMethods> {
  type: 'camera';
  unique: ComponentUnique.LOCAL;

  /**
   * Zoom level for the camera.
   * 1.0 = normal, 2.0 = 2x zoom, 0.5 = zoomed out
   */
  zoom: number;

  /**
   * Pixel scale for retro pixelation effect.
   * Controls how chunky the pixels appear (multiplies with zoom).
   * 1.0 = no extra pixelation, 2.0 = 2x2 pixel blocks, 4.0 = 4x4 pixel blocks
   * Higher values = chunkier, more retro look
   * Default: 2.0
   */
  pixelScale: number;

  /**
   * Axonometric projection angle in degrees.
   * Typically around 30 degrees for isometric-like appearance.
   */
  axonometricAngle: number;

  /**
   * Orbit yaw in degrees, rotating world X/Z around +Y before the axonometric
   * projection. 0 = original fixed-azimuth behavior (bit-for-bit).
   */
  orbitYaw: number;

  /**
   * Reference to the viewport component to render to.
   * Looked up by name in the parent nexus.
   */
  viewportRef: string;

  /**
   * Zoom target in viewport-local coordinates.
   * When set, setZoom adjusts the camera position so the world point
   * under this screen coordinate stays fixed during zoom changes.
   * null = viewport center (no camera position adjustment on zoom).
   */
  zoomTarget: { x: number; y: number } | null;

  /**
   * Developer-configurable depth-readability cues (outline, AO, cast shadows,
   * height ramp). null = all off (default). See DepthCues.
   */
  depthCues: DepthCues | null;

  /**
   * WebGL rendering resources (shader programs, buffers, etc.)
   */
  glResources: {
    unifiedProgram: WebGLProgram | null;
    renderModeLocation: WebGLUniformLocation | null;
    atlasTextures: (WebGLTexture | null)[];
    /** AtlasManager.atlasVersion last uploaded into atlasTextures (-1 = none). */
    atlasVersion: number;
    quadVertexBuffer: WebGLBuffer | null;
    quadUVBuffer: WebGLBuffer | null;
    // Post-processing framebuffer resources for pixel-perfect zoom
    framebuffer: WebGLFramebuffer | null;
    renderTexture: WebGLTexture | null;
    depthTexture: WebGLTexture | null;
    postProcessProgram: WebGLProgram | null;
    fullscreenQuadBuffer: WebGLBuffer | null;

    // Base rendering resolution (independent of canvas size, adjusted by zoom)
    baseResolution: { width: number; height: number };

    // Cell solidity texture for per-fragment line-of-sight raycasting
    visibilityTexture: WebGLTexture | null;
    // cellStoreGeneration() as of the last visibilityTexture upload, plus the
    // window dims it was sized to. Terrain changes far less often than once a
    // frame, so comparing these lets the whole-window texImage3D be skipped on
    // most frames. -1 = nothing uploaded yet. The dims are part of the key
    // because a window RESIZE needs a fresh allocation even when contents are
    // untouched -- uploading new dims into the old allocation is exactly the
    // "ArrayBufferView not big enough" hazard the windowCommitted gate guards.
    solidityGeneration: number;
    solidityDims: { x: number; y: number; z: number } | null;

    // Per-cell emission (highlight) color texture (RGBA8, flattened cell grid).
    cellEmissionColorTexture: WebGLTexture | null;
    // Whether the resident emission-color texture has any non-black cell (gates the
    // shader term + avoids binding an empty texture).
    cellEmissionColorHasAny: boolean;
    // cellMap.emissionColorVersion last fully applied to cellEmissionColorTexture
    // (via full rebuild or texSubImage3D deltas). -1 = nothing uploaded yet.
    cellEmissionColorVersion: number;

    // Per-chunk fog-of-war "explored" texture (R8, chunk-grid resolution).
    exploredTexture: WebGLTexture | null;
    // cellMap's explored-channel version last fully applied to exploredTexture
    // (via full rebuild or texSubImage3D deltas). -1 = nothing uploaded yet.
    exploredVersion: number;

    // Terrain-memory LOD: near tier (R8, per-cell, window-cell resolution)
    // and far tier (R8, per-chunk, chunk-grid resolution) captured material
    // indices (255 = not captured). Same version-tracking convention as
    // exploredTexture above.
    nearMaterialTexture: WebGLTexture | null;
    nearMaterialVersion: number;
    // Next z-layer to refill in nearMaterialTexture, or -1 when not refilling.
    // A window shift used to force a whole-window rebuild of this texture in
    // one frame; instead the texture is cleared to "no data captured" and then
    // refilled a slab at a time over the following frames. Partial state is
    // safe because the shader's nearMaterialAt returns -1 for a cleared texel
    // and falls through to the coarse per-chunk far-material tier — remembered
    // terrain briefly renders at lower detail rather than at a wrong position.
    nearMaterialRefillZ: number;
    farMaterialTexture: WebGLTexture | null;
    farMaterialVersion: number;
  };
}

export interface CameraOptions extends ComponentOptions {
  /**
   * Initial zoom level (default: 1.0)
   */
  zoom?: number;

  /**
   * Pixel scale for retro pixelation effect (default: 2.0)
   * Controls how chunky pixels appear. Higher = more retro/chunky.
   */
  pixelScale?: number;

  /**
   * Axonometric angle in degrees (default: 30)
   */
  axonometricAngle?: number;

  /**
   * Orbit yaw in degrees (default: 0)
   */
  orbitYaw?: number;

  /**
   * Name of the viewport component to render to (required)
   */
  viewportRef: string;

  /**
   * Depth-readability cues for cell rendering. Omit to disable all (default).
   * Provide any subset; per-effect `weight` defaults to 0 (off), so set the
   * weights you want. See DepthCues for each effect.
   */
  depthCues?: DepthCuesOptions;
}

/**
 * Builder function for creating Camera components.
 */
export function builder(options: CameraOptions): CameraT {
  if (!options.viewportRef) {
    throw new Error('Camera requires a viewportRef');
  }

  const camera = {
    type: 'camera' as const,
    name: options.name,
    unique: ComponentUnique.LOCAL,
    parent: null,
    _disposed: false,
    _initDefer: 1,

    zoom: options.zoom ?? 1.0,
    pixelScale: options.pixelScale ?? 2.0,
    axonometricAngle: options.axonometricAngle ?? 30,
    orbitYaw: options.orbitYaw ?? 0,
    viewportRef: options.viewportRef,
    zoomTarget: null,

    depthCues: resolveDepthCues(options.depthCues),

    glResources: {
      unifiedProgram: null,
      renderModeLocation: null,
      atlasTextures: [],
      atlasVersion: -1,
      quadVertexBuffer: null,
      quadUVBuffer: null,
      // Post-processing resources
      framebuffer: null,
      renderTexture: null,
      depthTexture: null,
      postProcessProgram: null,
      fullscreenQuadBuffer: null,
      baseResolution: { width: 800, height: 600 }, // Default, will be updated in init()
      visibilityTexture: null,
      solidityGeneration: -1,
      solidityDims: null,
      cellEmissionColorTexture: null,
      cellEmissionColorHasAny: false,
      cellEmissionColorVersion: -1,
      exploredTexture: null,
      exploredVersion: -1,
      nearMaterialTexture: null,
      nearMaterialVersion: -1,
      nearMaterialRefillZ: -1,
      farMaterialTexture: null,
      farMaterialVersion: -1,
    },
  };

  return camera as unknown as CameraT;
}

/**
 * Serializes a camera component to a plain object.
 * WebGL resources are not serialized - they will be recreated on init.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const c = component as CameraT;

  return {
    type: 'camera',
    name: c.name,
    unique: ComponentUnique.LOCAL,
    zoom: c.zoom,
    pixelScale: c.pixelScale,
    axonometricAngle: c.axonometricAngle,
    orbitYaw: c.orbitYaw,
    viewportRef: c.viewportRef,
    depthCues: c.depthCues,
  };
}

/**
 * Deserializes a plain object back into a camera component.
 * WebGL resources will be recreated during init.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<CameraT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'camera deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const {
    type,
    name,
    zoom,
    pixelScale,
    axonometricAngle,
    orbitYaw,
    viewportRef,
    depthCues,
  } = data;

  if (type !== 'camera') {
    errors.push({
      code: 'TYPE_MISMATCH',

      message: `type ${type} does not match "camera"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'camera requires a name',
    });
  }
  if (!viewportRef) {
    errors.push({
      code: 'MISSING_VIEWPORT_REF',
      message: 'camera requires a viewportRef',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  return {
    component: builder({
      name: name as string,
      zoom: zoom as number,
      pixelScale: pixelScale as number,
      axonometricAngle: axonometricAngle as number,
      orbitYaw: orbitYaw as number | undefined,
      viewportRef: viewportRef as string,
      depthCues: depthCues as DepthCuesOptions | undefined,
    }),
    errors,
  };
}

export const CameraSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of camera-specific properties accessible via component Proxy.
 */
export const PROPERTY_ALLOWLIST: string[] = [
  'zoom',
  'pixelScale',
  'axonometricAngle',
  'orbitYaw',
  'viewportRef',
  'zoomTarget',
  'glResources',
  'depthCues',
];
