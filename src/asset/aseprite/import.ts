import { newComponent } from '../../component/types';
import type { ComponentData } from '../../component/types';
import { MethodRegistry } from '../../component/registry';
import type { NexusT } from '../../component/nexus/data';
import { AtlasManager } from '../../component/atlas-manager/methods';
import type { AtlasManagerT } from '../../component/atlas-manager/data';
import type { SpriteT, SpriteOptions } from '../../component/sprite/data';
import type { TextureMapOptions } from '../../component/texture-map/data';
import type { TransformOptions } from '../../component/transform/data';
import type { AnimationControllerT } from '../../component/animation-controller/data';
import type { AnimationControllerOptions } from '../../component/animation-controller/data';
import type {
  Animation,
  AnimationLayer,
} from '../../component/animation-controller/types';
import { Vector2D, Vector3D, Vector4D } from '../../math';
import { parseAseprite } from './parser';
import type { AseCel, AseFile, AseLayer } from './types';

/**
 * Configuration for ingesting an Aseprite file into an entity nexus. The
 * importer composites frames into in-memory canvases, registers them with the
 * atlas, and builds the sprites + animation-controller (all flagged
 * `_generated` so they're regenerated on load, never serialized).
 */
export interface AsepriteImportConfig {
  /** Nexus to populate (the `aseprite` component's own parent). */
  parent: NexusT;
  /** Atlas manager the composited frames are packed into. */
  atlasManager: AtlasManagerT;
  /** Unique namespace for texture keys / synthetic source paths. */
  packageId: string;
  /** Composite all layers into one sprite (default true) vs one per layer. */
  flatten?: boolean;
  /** Only include layers whose Aseprite visible flag is set (default true). */
  visibleOnly?: boolean;
  /** Sprite anchor in pixels (default: canvas center). */
  anchor?: Vector2D;
  /** Transform position, if a transform must be created (default 0,0,0). */
  position?: Vector3D;
  /** Transform scale, if a transform must be created (default 1,1,1). */
  scale?: Vector3D;
  /** Optional layer-name → slot map; layers sharing a slot are mutually exclusive. */
  layerSlots?: Record<string, string>;
}

/** What the import produced. */
export interface AsepriteImportResult {
  controller: AnimationControllerT | null;
  sprites: SpriteT[];
}

/**
 * Parses an Aseprite buffer and builds a fully-animated, optionally-layered
 * entity into `config.parent`: composited texture-maps + sprites + an
 * animation-controller (tags → animations with per-frame durations). Browser-only
 * (uses canvas); the parser core it calls is environment-agnostic.
 */
export async function importAseprite(
  buffer: ArrayBuffer,
  config: AsepriteImportConfig,
): Promise<AsepriteImportResult> {
  const ase = await parseAseprite(buffer);
  const flatten = config.flatten ?? true;
  const visibleOnly = config.visibleOnly ?? true;
  const anchor = config.anchor ?? new Vector2D(ase.width / 2, ase.height / 2);
  const parent = config.parent;

  // Idempotent: drop any previously-generated children before rebuilding.
  removeGeneratedChildren(parent);

  // Ensure a transform exists. It is NOT flagged generated, so it persists
  // (keeping any runtime position) and is reused on the next init.
  if (!parent.getComponentByType('transform', false)) {
    const transformOptions: TransformOptions = {
      name: `${config.packageId} Transform`,
      position: config.position ?? new Vector3D(0, 0, 0),
      scale: config.scale ?? new Vector3D(1, 1, 1),
    };
    await newComponent('transform', transformOptions, parent);
  }

  // Image layers only, filtered by visibility; composited ascending by index.
  const renderLayers = ase.layers.filter(
    (l) => l.type === 0 && (!visibleOnly || l.visible),
  );

  // Build one strip canvas per produced sprite (a `w*frameCount × h` sheet).
  const builds: Array<{ name: string; canvas: HTMLCanvasElement }> = [];
  if (flatten) {
    builds.push({
      name: config.packageId,
      canvas: compositeStrip(ase, renderLayers),
    });
  } else {
    for (const layer of renderLayers) {
      builds.push({ name: layer.name, canvas: compositeStrip(ase, [layer]) });
    }
  }

  // Frame rectangles into the strip (one per frame).
  const frameRects: Vector4D[] = [];
  for (let f = 0; f < ase.frameCount; f++) {
    frameRects.push(new Vector4D(f * ase.width, 0, ase.width, ase.height));
  }

  // Create a texture-map + sprite per build.
  const sprites: SpriteT[] = [];
  let renderOrder = 0;
  for (const build of builds) {
    const texKey = `aseprite:${config.packageId}:${build.name}`;
    const textureMapOptions: TextureMapOptions = {
      name: texKey,
      textureMapKey: texKey,
      // Synthetic, unique source path keeps the atlas dedup key correct.
      filePath: `aseprite://${config.packageId}/${build.name}`,
      sourceImage: build.canvas,
      imageType: frameRects,
      atlasManager: config.atlasManager,
    };
    const tm = await newComponent('texture-map', textureMapOptions, parent);
    if (tm) tm._generated = true;

    const spriteOptions: SpriteOptions = {
      name: build.name,
      textureMapKeys: {
        albedo: texKey,
        normal: '',
        material: '',
        emission: '',
      },
      frame: { albedo: 0, normal: 0, material: 0, emission: 0 },
      anchor,
      renderOrder: renderOrder++,
      visible: true,
    };
    const sprite = await newComponent('sprite', spriteOptions, parent);
    if (sprite) {
      sprite._generated = true;
      sprites.push(sprite as unknown as SpriteT);
    }
  }

  // Animation-controller: tags → animations, sprites → layers.
  const layers: AnimationLayer[] = sprites.map((s) => ({
    name: s.name,
    spriteName: s.name,
    visible: true,
    slot: config.layerSlots?.[s.name],
  }));
  const controllerOptions: AnimationControllerOptions = {
    name: `${config.packageId} Anim`,
    animations: buildAnimations(ase),
    layers,
    channels: ['albedo'],
  };
  const controllerComp = await newComponent(
    'animation-controller',
    controllerOptions,
    parent,
  );
  let controller: AnimationControllerT | null = null;
  if (controllerComp) {
    controllerComp._generated = true;
    controller = controllerComp as unknown as AnimationControllerT;
  }

  // Pack the newly-registered in-memory frames into the atlas.
  await AtlasManager.processTextureMaps(config.atlasManager);

  return { controller, sprites };
}

/**
 * Composites the given layers (ascending by index) of every frame onto a single
 * horizontal strip canvas: frame f occupies x = f*width. Each layer's trimmed
 * cel is blitted at its (x, y) offset honoring layer + cel opacity (normal blend).
 */
function compositeStrip(ase: AseFile, layers: AseLayer[]): HTMLCanvasElement {
  const strip = createCanvas(ase.width * ase.frameCount, ase.height);
  const ctx = get2d(strip);
  for (let f = 0; f < ase.frameCount; f++) {
    const frame = ase.frames[f];
    for (const layer of layers) {
      const cel = frame.cels.find((c) => c.layerIndex === layer.index);
      if (cel) blitCel(ctx, cel, layer.opacity, f * ase.width + cel.x, cel.y);
    }
  }
  return strip;
}

/**
 * Blits one cel's RGBA pixels onto the destination context at (destX, destY),
 * applying combined layer×cel opacity. putImageData ignores globalAlpha, so the
 * cel goes through an intermediate canvas drawn with drawImage.
 */
function blitCel(
  ctx: CanvasRenderingContext2D,
  cel: AseCel,
  layerOpacity: number,
  destX: number,
  destY: number,
): void {
  if (!cel.pixels || cel.w === 0 || cel.h === 0) return;
  const tmp = createCanvas(cel.w, cel.h);
  const tctx = get2d(tmp);
  tctx.putImageData(
    new ImageData(new Uint8ClampedArray(cel.pixels), cel.w, cel.h),
    0,
    0,
  );
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = (layerOpacity / 255) * (cel.opacity / 255);
  ctx.drawImage(tmp, destX, destY);
  ctx.globalAlpha = prevAlpha;
}

/**
 * Converts Aseprite tags into animations, carrying per-frame durations and
 * expanding reverse / ping-pong loop directions. With no tags, produces a single
 * `default` animation over every frame.
 */
function buildAnimations(ase: AseFile): Animation[] {
  if (ase.tags.length === 0) {
    const frames = frameRange(0, ase.frameCount - 1);
    return [
      {
        name: 'default',
        frames,
        frameDurations: frames.map((i) => ase.frames[i].durationMs),
        frameRate: 12,
        loop: true,
      },
    ];
  }

  return ase.tags.map((tag) => {
    let frames = frameRange(tag.from, tag.to);
    let durations = frames.map((i) => ase.frames[i].durationMs);

    if (tag.loopDir === 1) {
      // reverse
      frames = frames.slice().reverse();
      durations = durations.slice().reverse();
    } else if (tag.loopDir === 2 || tag.loopDir === 3) {
      // ping-pong: append the interior frames back-to-front
      const backFrames = frames.slice(1, -1).reverse();
      const backDurations = durations.slice(1, -1).reverse();
      frames = frames.concat(backFrames);
      durations = durations.concat(backDurations);
      if (tag.loopDir === 3) {
        frames.reverse();
        durations.reverse();
      }
    }

    return {
      name: tag.name,
      frames,
      frameDurations: durations,
      frameRate: 12,
      loop: tag.repeat === 0,
    };
  });
}

/** Inclusive integer range [from, to]. */
function frameRange(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/** Disposes and removes this nexus's loader-generated children. */
function removeGeneratedChildren(parent: NexusT): void {
  const generated = parent.components.filter((c) => c._generated);
  for (const child of generated) {
    const dispose = MethodRegistry[child.type]?.dispose as
      | ((c: ComponentData) => void)
      | undefined;
    if (typeof dispose === 'function') {
      dispose(child);
    } else {
      child._disposed = true;
    }
  }
  parent.components = parent.components.filter((c) => !c._generated);
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('[aseprite] failed to acquire a 2D canvas context');
  }
  return ctx;
}
