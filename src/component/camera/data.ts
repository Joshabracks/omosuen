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
import { MethodRegistry } from '../registry';

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

/** Value types a post-effect stage can pass to its own uniforms. */
export type PostEffectUniformValue = number | number[] | boolean;

/**
 * One resolved stage of the camera's post-process chain.
 *
 * Stages run in array order over the composited frame, each reading the
 * previous stage's colour plus the per-texel mask channels. See
 * `render/post-chain.ts` for the uniform contract handed to every stage.
 */
export interface PostEffect {
  /** Identifies the stage for `setPostEffectEnabled`/`setPostEffectUniform`. */
  name: string;
  /** Resolved GLSL ES 3.00 fragment source. */
  fragment: string;
  /**
   * Set when `fragment` came from `registerMethod('post-effect', key, source)`.
   * Only keyed stages survive save/load — `serialize` has no way to emit a raw
   * source string it did not put there, the same tradeoff `cell-map`'s
   * `generateCell` documents.
   */
  fragmentKey?: string;
  /** Skipped entirely when false; the rest of the chain still runs. */
  enabled: boolean;
  /** Stage-private uniforms, uploaded by name. `u_`-prefixed names are reserved. */
  uniforms: Record<string, PostEffectUniformValue>;
}

/** Partial form accepted in CameraOptions; see PostEffect. */
export interface PostEffectOptions {
  name: string;
  /** Raw GLSL source. Mutually exclusive with `fragmentKey`. */
  fragment?: string;
  /** Registry key registered via `registerMethod('post-effect', key, source)`. */
  fragmentKey?: string;
  enabled?: boolean;
  uniforms?: Record<string, PostEffectUniformValue>;
}

/**
 * Resolve the partial options into full PostEffects, or null when absent —
 * null (not an empty array) is "no chain", which is what lets the render path
 * and the ping-target allocation skip the whole feature at zero cost.
 *
 * A `fragmentKey` naming an unregistered effect THROWS here, deliberately:
 * construction is the point where the caller can still fix it. Deserialization
 * degrades instead (see `deserialize`), matching `cell-map`'s generator
 * handling.
 */
export function resolvePostEffects(
  o: PostEffectOptions[] | undefined,
): PostEffect[] | null {
  if (!o || o.length === 0) return null;
  return o.map((e) => {
    let fragment = e.fragment;
    if (e.fragmentKey !== undefined) {
      const registered = MethodRegistry['post-effect'][e.fragmentKey] as
        | string
        | undefined;
      if (typeof registered !== 'string') {
        throw new Error(
          `Camera: post-effect key "${e.fragmentKey}" is not registered in ` +
            `MethodRegistry['post-effect'] -- call registerMethod('post-effect', ` +
            `'${e.fragmentKey}', source) before constructing/loading this camera`,
        );
      }
      fragment = registered;
    }
    if (typeof fragment !== 'string' || fragment.length === 0) {
      throw new Error(
        `Camera: post-effect "${e.name}" needs either a 'fragment' source or a ` +
          "registered 'fragmentKey'",
      );
    }
    return {
      name: e.name,
      fragment,
      fragmentKey: e.fragmentKey,
      enabled: e.enabled ?? true,
      uniforms: e.uniforms ?? {},
    };
  });
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
   * Ordered post-process chain applied to the composited frame. null = no
   * chain (default), which skips the whole feature including its render
   * targets. See PostEffect.
   */
  postEffects: PostEffect[] | null;

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

    /**
     * Composite target (FBO_B), at full viewport resolution. The upscale pass
     * blits the base-resolution cell FBO into it and the sprite pass then draws
     * on top, so the whole frame exists in one sampleable texture before it
     * reaches the screen. `renderPresent` blits it to the default framebuffer.
     */
    /**
     * Cell FBO's id attachment (COLOR1, RGBA16UI, base resolution).
     * R = cell material index, G = fogVisibility quantised to 16 bits — the
     * only carrier the cell pass has for a fog value that must survive the
     * upscale into the composite's aux channel.
     */
    cellIdTexture: WebGLTexture | null;

    /**
     * Ping-pong colour targets for the post-effect chain, full resolution.
     * Allocated only while a chain is configured — a camera with no chain
     * pays nothing for the feature. Masks are NOT ping-ponged: they are
     * written once and read by every stage, so a five-stage chain still
     * costs two colour targets rather than ten.
     */
    postChainFramebuffers: (WebGLFramebuffer | null)[];
    postChainTextures: (WebGLTexture | null)[];

    framebufferB: WebGLFramebuffer | null;
    compositeTexture: WebGLTexture | null;
    /**
     * Composite id attachment (COLOR1, RGBA16UI, full resolution).
     * R = cell material index, G = sprite `shaderId`. Integer format, so the
     * sprite pass's alpha blend cannot smear two ids into a meaningless third
     * along a soft edge — the value is simply the frontmost writer's.
     */
    compositeIdTexture: WebGLTexture | null;
    /**
     * Composite aux attachment (COLOR2, RGBA8, full resolution).
     * R = sprite coverage 0..1, G = fogVisibility. Unorm precisely because
     * these SHOULD blend: coverage accumulates through the sprite pass's
     * existing alpha blend rather than being computed separately.
     */
    compositeAuxTexture: WebGLTexture | null;
    /** Program for the final composite → screen blit (`post-present.frag`). */
    presentProgram: WebGLProgram | null;

    // Base rendering resolution (independent of canvas size, adjusted by zoom)
    baseResolution: { width: number; height: number };
    /**
     * Viewport size the targets were last allocated against, in pixels. Unlike
     * baseResolution this is not scaled by zoom/pixelScale, so comparing it to
     * the live viewport detects a resize the camera has not been told about —
     * nothing propagates `Viewport.resize` to a camera automatically.
     */
    fullResolution: { width: number; height: number };

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
    /** Per-cell region-index texture (R8UI 2D array, layer = z). */
    cellRegionIndexTexture: WebGLTexture | null;
    // Whether the resident emission-color texture has any non-black cell (gates the
    // shader term + avoids binding an empty texture).
    cellEmissionColorHasAny: boolean;
    /** Whether any cell carries a non-zero region index; skips the shader term. */
    cellRegionIndexHasAny: boolean;
    // cellMap.emissionColorVersion last fully applied to cellEmissionColorTexture
    // (via full rebuild or texSubImage3D deltas). -1 = nothing uploaded yet.
    cellEmissionColorVersion: number;
    /** Region-index version this camera has uploaded; -1 = nothing yet. */
    cellRegionIndexVersion: number;

    // Per-chunk fog-of-war "explored" texture (R8, chunk-grid resolution).
    exploredTexture: WebGLTexture | null;
    // cellMap's explored-channel version last fully applied to exploredTexture
    // (via full rebuild or texSubImage3D deltas). -1 = nothing uploaded yet.
    exploredVersion: number;

    // Terrain-memory LOD: near tier (R8, per-cell, window-cell resolution)
    // and far tier (R8, per-chunk, chunk-grid resolution) captured material
    // indices (255 = not captured). Same version-tracking convention as
    // exploredTexture above.
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

  /**
   * Post-process stages applied to the finished frame, in order. Omit for no
   * chain (default). See PostEffect for the per-stage shape and
   * `render/post-chain.ts` for the uniform contract each stage receives.
   */
  postEffects?: PostEffectOptions[];
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
    postEffects: resolvePostEffects(options.postEffects),

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
      cellIdTexture: null,
      postChainFramebuffers: [null, null],
      postChainTextures: [null, null],
      framebufferB: null,
      compositeTexture: null,
      compositeIdTexture: null,
      compositeAuxTexture: null,
      presentProgram: null,
      baseResolution: { width: 800, height: 600 }, // Default, will be updated in init()
      fullResolution: { width: 800, height: 600 }, // Default, will be updated in init()
      visibilityTexture: null,
      solidityGeneration: -1,
      solidityDims: null,
      cellEmissionColorTexture: null,
      cellRegionIndexTexture: null,
      cellEmissionColorHasAny: false,
      cellRegionIndexHasAny: false,
      cellEmissionColorVersion: -1,
      cellRegionIndexVersion: -1,
      exploredTexture: null,
      exploredVersion: -1,
    },
  };

  return camera as unknown as CameraT;
}

/**
 * Emit only registry-keyed stages. A raw-source stage has no key to write, so
 * it cannot come back on load — warned rather than dropped silently, because
 * the alternative is a user discovering at load time that half their chain
 * vanished with no explanation.
 */
function serializePostEffects(c: CameraT): PostEffectOptions[] | null {
  if (!c.postEffects) return null;
  const keyed = c.postEffects.filter((e) => e.fragmentKey !== undefined);
  const dropped = c.postEffects.length - keyed.length;
  if (dropped > 0) {
    console.warn(
      `[camera] Camera '${c.name}': ${dropped} post-effect stage(s) use a raw ` +
        'fragment source and will not survive save/load. Register them with ' +
        "registerMethod('post-effect', key, source) and reference them by " +
        'fragmentKey to make them serializable.',
    );
  }
  return keyed.map((e) => ({
    name: e.name,
    fragmentKey: e.fragmentKey,
    enabled: e.enabled,
    uniforms: e.uniforms,
  }));
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
    postEffects: serializePostEffects(c),
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

  const {
    type,
    name,
    zoom,
    pixelScale,
    axonometricAngle,
    orbitYaw,
    viewportRef,
    depthCues,
    postEffects,
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
      postEffects: postEffects as PostEffectOptions[] | undefined,
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
  'postEffects',
];
