// The Aseprite → entity importer. Parses an .aseprite buffer, composites frames
// into in-memory canvases, and builds the entity's texture-maps + sprites +
// animation-controller into a nexus. Engine runtime (newComponent, Vector*) is
// imported from 'omosuen' and externalized to the engine global at bundle time —
// these are the engine's own singletons, never re-bundled.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { newComponent, Vector2D, Vector3D, Vector4D } from 'omosuen';
import { parseAseprite } from './parser/parser.js';
import type { AseCel, AseFile, AseLayer } from './parser/types.js';

/**
 * Configuration for ingesting an Aseprite file into an entity nexus. `parent`
 * and `atlasManager` are live engine component proxies.
 */
export interface AsepriteImportConfig {
  /** Nexus to populate (the `aseprite` component's own parent). */
  parent: any;
  /** Atlas manager the composited frames are packed into. */
  atlasManager: any;
  /** Unique namespace for texture keys / synthetic source paths. */
  packageId: string;
  /** Composite all layers into one sprite (default true) vs one per layer. */
  flatten?: boolean;
  /** Only include layers whose Aseprite visible flag is set (default true). */
  visibleOnly?: boolean;
  /** Sprite anchor in pixels (default: canvas center). Wins over `anchorMode`. */
  anchor?: Vector2D;
  /**
   * Named anchor, resolved to pixels against the parsed canvas size — so callers
   * needn't know the .ase dimensions. 'center' (default) = (w/2, h/2);
   * 'bottom-center' = (w/2, h) for ground-standing billboards.
   */
  anchorMode?: 'center' | 'bottom-center';
  /** Transform position, if a transform must be created (default 0,0,0). */
  position?: Vector3D;
  /** Transform scale, if a transform must be created (default 1,1,1). */
  scale?: Vector3D;
  /** Optional layer-name → slot map; layers sharing a slot are mutually exclusive. */
  layerSlots?: Record<string, string>;
}

/** What the import produced. */
export interface AsepriteImportResult {
  controller: any | null;
  sprites: any[];
}

/**
 * One resolved source for `importAsepriteSources`: a fetched .aseprite buffer
 * plus its namespace `id` and effective (loader-default-resolved) options. The
 * component's `init` builds these from its `sources` array.
 */
export interface AsepriteSourceEntry {
  /** Static URL of the .aseprite file. Fetched lazily, ONLY on a full import. */
  filePath: string;
  /** Namespace prefix for this source's sprites / tags / texture keys. */
  id: string;
  flatten: boolean;
  visibleOnly: boolean;
  /** Within-source mutually-exclusive layers (raw layer name → slot name). */
  layerSlots?: Record<string, string>;
}

/** Shared config for the multi-source orchestrator. */
export interface AsepriteSourcesConfig {
  /** The entity nexus that gets the per-instance sprites + controller. */
  parent: any;
  atlasManager: any;
  /**
   * Stable owner (typically the scene root) for the SHARED texture-maps +
   * animation-map, so they outlive any single entity's dispose/re-skin.
   */
  sharedParent: any;
  /** Atlas-namespace root; also names the transform and controller. */
  packageId: string;
  anchor?: Vector2D;
  anchorMode?: 'center' | 'bottom-center';
  position?: Vector3D;
  scale?: Vector3D;
}

/**
 * Minimal per-instance recipe for one art set, cached after the first import so
 * subsequent entities of the same set are built WITHOUT fetch/parse/composite.
 */
interface InstanceBlueprint {
  builds: Array<{
    spriteName: string;
    texKey: string;
    anchor: Vector2D;
    renderOrder: number;
    slot?: string;
  }>;
  animationMapKey: string;
}

/**
 * Per-art-set instance blueprints, keyed by the ordered source ids. Lets repeat
 * spawns skip all the heavy import work (see importAsepriteSources).
 */
const BLUEPRINTS = new Map<string, InstanceBlueprint>();

/**
 * Parses an Aseprite buffer and builds a fully-animated, optionally-layered
 * entity into `config.parent`: composited texture-maps + sprites + an
 * animation-controller (tags → animations with per-frame durations). Browser-only
 * (uses canvas); the parser it calls is environment-agnostic.
 */
export async function importAseprite(
  buffer: ArrayBuffer,
  config: AsepriteImportConfig,
): Promise<AsepriteImportResult> {
  const ase = await parseAseprite(buffer);
  const flatten = config.flatten ?? true;
  const visibleOnly = config.visibleOnly ?? true;
  const anchor = resolveAnchor(ase, config);
  const parent = config.parent;

  // Idempotent: drop any previously-generated children before rebuilding.
  removeGeneratedChildren(parent);

  // Ensure a transform exists (persists across re-inits — see ensureTransform).
  await ensureTransform(parent, config.packageId, config);

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
  const frameRects = buildFrameRects(ase);

  // Create a texture-map + sprite per build.
  const sprites: any[] = [];
  let renderOrder = 0;
  for (const build of builds) {
    const texKey = `aseprite:${config.packageId}:${build.name}`;
    const tm = await newComponent(
      'texture-map',
      {
        name: texKey,
        textureMapKey: texKey,
        // Synthetic, unique source path keeps the atlas dedup key correct.
        filePath: `aseprite://${config.packageId}/${build.name}`,
        sourceImage: build.canvas,
        imageType: frameRects,
        atlasManager: config.atlasManager,
      },
      parent,
    );
    if (tm) tm._generated = true;

    const sprite = await newComponent(
      'sprite',
      {
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
      },
      parent,
    );
    if (sprite) {
      sprite._generated = true;
      sprites.push(sprite);
    }
  }

  // Animation-controller: tags → animations, sprites → layers.
  const layers = sprites.map((s) => ({
    name: s.name,
    spriteName: s.name,
    visible: true,
    slot: config.layerSlots?.[s.name],
  }));
  const controller = await newComponent(
    'animation-controller',
    {
      name: `${config.packageId} Anim`,
      animations: buildAnimations(ase),
      layers,
      channels: ['albedo'],
    },
    parent,
  );
  if (controller) controller._generated = true;

  // Pack the newly-registered in-memory frames into the atlas (proxy method).
  await config.atlasManager.processTextureMaps();

  return { controller: controller ?? null, sprites };
}

/**
 * Multi-source variant: ingests several .aseprite files into ONE entity nexus —
 * one merged animation-controller, one atlas pass — with every source's sprites,
 * layers, and tags namespaced by its `id` so nothing collides.
 *
 * Namespacing (vs the single-source `importAseprite`, which stays un-prefixed):
 *   - sprite / layer name : `${id}:${layerName}`  (flattened source: `${id}`)
 *   - texture key         : `aseprite:${id}:${build}`
 *   - synthetic filePath  : `aseprite://${id}/${build}`
 *   - animation name      : `${id}-${tagName}`
 *
 * The engine `slot` is used ONLY for per-source `layerSlots` (mutually-exclusive
 * layers within one source, e.g. hair A/B/C) and its value is itself id-namespaced
 * so two sources' identically-named slots don't become cross-source exclusive.
 * Source-group visibility (show one variant, hide the rest) is the caller's job,
 * done by toggling every layer whose name starts with `${id}:` — NOT via `slot`.
 *
 * The once-per-loader steps (removeGeneratedChildren, ensure transform,
 * processTextureMaps) run exactly once around the per-source loop.
 */
export async function importAsepriteSources(
  entries: AsepriteSourceEntry[],
  config: AsepriteSourcesConfig,
): Promise<AsepriteImportResult> {
  const parent = config.parent;
  const artSetKey = entries.map((e) => e.id).join('+');

  // Fast path: another entity already imported this art set and its SHARED
  // resources still exist in the current scene → build only the per-instance
  // sprites + controller from the cached blueprint (no fetch / parse / composite
  // / atlas work).
  const blueprint = BLUEPRINTS.get(artSetKey);
  if (blueprint && sharedResourcesExist(config, blueprint)) {
    return spawnFromBlueprint(parent, blueprint, config);
  }

  // Full import. Fetch every source's buffer NOW (in parallel) — only reached
  // when there's no cached blueprint, so repeat spawns never hit the network.
  const buffers = await Promise.all(
    entries.map(async (e) => {
      const res = await fetch(e.filePath);
      if (!res.ok) {
        console.error(
          `[aseprite-loader] failed to fetch source '${e.filePath}': ${res.status} ${res.statusText}`,
        );
        return null;
      }
      return res.arrayBuffer();
    }),
  );

  // Idempotent rebuild + shared transform — ONCE, around the loop.
  removeGeneratedChildren(parent);
  await ensureTransform(parent, config.packageId, config);

  const allSprites: any[] = [];
  const allLayers: any[] = [];
  const allAnimations: any[] = [];
  const bpBuilds: InstanceBlueprint['builds'] = [];
  let renderOrder = 0;

  for (let ei = 0; ei < entries.length; ei++) {
    const entry = entries[ei];
    const buffer = buffers[ei];
    if (!buffer) continue; // fetch failed for this source
    const ase = await parseAseprite(buffer);
    const anchor = resolveAnchor(ase, config);
    const renderLayers = ase.layers.filter(
      (l) => l.type === 0 && (!entry.visibleOnly || l.visible),
    );

    // Which builds this source produces (names only; the strip canvas is
    // composited lazily, only when the texture-map doesn't already exist).
    const buildNames: string[] = entry.flatten
      ? [entry.id]
      : renderLayers.map((layer) => layer.name);

    const frameRects = buildFrameRects(ase);

    for (const buildName of buildNames) {
      // Flattened source is a single strip → the sprite IS the source (`${id}`);
      // per-layer builds namespace the layer name (`${id}:${layer}`).
      const spriteName = entry.flatten ? entry.id : `${entry.id}:${buildName}`;
      const texKey = `aseprite:${entry.id}:${buildName}`;

      // Shared texture-map: create once per key (composite only on first use),
      // owned by the scene root so entity dispose never drops shared art.
      await config.atlasManager.getOrCreateTextureMap(texKey, async () => {
        const canvas = entry.flatten
          ? compositeStrip(ase, renderLayers)
          : compositeStrip(ase, [renderLayers.find((l) => l.name === buildName)!]);
        const tm = await newComponent(
          'texture-map',
          {
            name: texKey,
            textureMapKey: texKey,
            filePath: `aseprite://${entry.id}/${buildName}`,
            sourceImage: canvas,
            imageType: frameRects,
            atlasManager: config.atlasManager,
          },
          config.sharedParent,
        );
        if (tm) tm._generated = true;
        return tm ?? null;
      });

      // `layerSlots` is keyed by the raw aseprite layer name; namespace the slot
      // VALUE so two sources' "hair" slots stay independent.
      const rawSlot = entry.layerSlots?.[buildName];
      const slot = rawSlot ? `${entry.id}:${rawSlot}` : undefined;

      const bp = { spriteName, texKey, anchor, renderOrder: renderOrder++, slot };
      bpBuilds.push(bp);

      const sprite = await buildInstanceSprite(parent, bp);
      if (sprite) allSprites.push(sprite);
      allLayers.push({ name: spriteName, spriteName, visible: true, slot });
    }

    // Prefix tags: `walk` → `${id}-walk`, so villager-walk / fighter-walk coexist.
    for (const anim of buildAnimations(ase)) {
      allAnimations.push({ ...anim, name: `${entry.id}-${anim.name}` });
    }
  }

  // Shared animation-map (one per art set), referenced by the controller by key.
  const animationMapKey = artSetKey;
  await getOrCreateAnimationMap(
    config.sharedParent,
    animationMapKey,
    allAnimations,
  );

  const controller = await newComponent(
    'animation-controller',
    {
      name: `${config.packageId} Anim`,
      animations: animationMapKey, // reference the shared animation-map by key
      layers: allLayers,
      channels: ['albedo'],
    },
    parent,
  );
  if (controller) controller._generated = true;

  // Single atlas pass for the whole loader (all sources' frames at once).
  await config.atlasManager.processTextureMaps();

  BLUEPRINTS.set(artSetKey, { builds: bpBuilds, animationMapKey });

  return { controller: controller ?? null, sprites: allSprites };
}

/** Creates one per-instance sprite from a blueprint build entry. */
async function buildInstanceSprite(
  parent: any,
  b: InstanceBlueprint['builds'][number],
): Promise<any> {
  const sprite = await newComponent(
    'sprite',
    {
      name: b.spriteName,
      textureMapKeys: { albedo: b.texKey, normal: '', material: '', emission: '' },
      frame: { albedo: 0, normal: 0, material: 0, emission: 0 },
      anchor: b.anchor,
      renderOrder: b.renderOrder,
      visible: true,
    },
    parent,
  );
  if (sprite) sprite._generated = true;
  return sprite ?? null;
}

/** True when a cached blueprint's shared resources still exist in this scene. */
function sharedResourcesExist(
  config: AsepriteSourcesConfig,
  blueprint: InstanceBlueprint,
): boolean {
  if (blueprint.builds.length === 0) return false;
  const firstTex = config.atlasManager.getTextureMap(blueprint.builds[0].texKey);
  if (!firstTex) return false;
  return findAnimationMap(config.sharedParent, blueprint.animationMapKey) !== null;
}

/**
 * Blueprint fast-path: rebuild only the per-instance sprites + controller for one
 * entity, referencing the already-shared texture-maps + animation-map by key.
 */
async function spawnFromBlueprint(
  parent: any,
  blueprint: InstanceBlueprint,
  config: AsepriteSourcesConfig,
): Promise<AsepriteImportResult> {
  removeGeneratedChildren(parent);
  await ensureTransform(parent, config.packageId, config);

  const sprites: any[] = [];
  const layers: any[] = [];
  for (const b of blueprint.builds) {
    const sprite = await buildInstanceSprite(parent, b);
    if (sprite) sprites.push(sprite);
    layers.push({
      name: b.spriteName,
      spriteName: b.spriteName,
      visible: true,
      slot: b.slot,
    });
  }

  const controller = await newComponent(
    'animation-controller',
    {
      name: `${config.packageId} Anim`,
      animations: blueprint.animationMapKey,
      layers,
      channels: ['albedo'],
    },
    parent,
  );
  if (controller) controller._generated = true;

  return { controller: controller ?? null, sprites };
}

/** Finds an animation-map by key anywhere under `sharedParent`. */
function findAnimationMap(sharedParent: any, key: string): any {
  const maps = (sharedParent.getComponentsByType('animation-map', true) ??
    []) as any[];
  return maps.find((m) => m.animationMapKey === key) ?? null;
}

/** Returns the shared animation-map for `key`, creating it once if absent. */
async function getOrCreateAnimationMap(
  sharedParent: any,
  key: string,
  animations: any[],
): Promise<any> {
  const existing = findAnimationMap(sharedParent, key);
  if (existing) return existing;
  const map = await newComponent(
    'animation-map',
    { name: key, animationMapKey: key, animations },
    sharedParent,
  );
  if (map) map._generated = true;
  return map ?? null;
}

/**
 * Resolves the sprite anchor: an explicit pixel `anchor` wins; else the named
 * mode against the parsed canvas size ('bottom-center' = foot-anchored); else
 * center.
 */
function resolveAnchor(
  ase: AseFile,
  config: { anchor?: Vector2D; anchorMode?: 'center' | 'bottom-center' },
): Vector2D {
  return (
    config.anchor ??
    (config.anchorMode === 'bottom-center'
      ? new Vector2D(ase.width / 2, ase.height)
      : new Vector2D(ase.width / 2, ase.height / 2))
  );
}

/**
 * Ensures the nexus has a transform. It is NOT flagged `_generated`, so it
 * survives `removeGeneratedChildren` — keeping any runtime position across
 * re-inits.
 */
async function ensureTransform(
  parent: any,
  name: string,
  config: { position?: Vector3D; scale?: Vector3D },
): Promise<void> {
  if (!parent.getComponentByType('transform', false)) {
    await newComponent(
      'transform',
      {
        name: `${name} Transform`,
        position: config.position ?? new Vector3D(0, 0, 0),
        scale: config.scale ?? new Vector3D(1, 1, 1),
      },
      parent,
    );
  }
}

/** One `Vector4D(f*w, 0, w, h)` frame rect per frame into the horizontal strip. */
function buildFrameRects(ase: AseFile): Vector4D[] {
  const rects: Vector4D[] = [];
  for (let f = 0; f < ase.frameCount; f++) {
    rects.push(new Vector4D(f * ase.width, 0, ase.width, ase.height));
  }
  return rects;
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
function buildAnimations(ase: AseFile): any[] {
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

/**
 * Disposes and removes this nexus's loader-generated children. Children are
 * engine component proxies, so `child.dispose()` dispatches the right teardown.
 */
function removeGeneratedChildren(parent: any): void {
  const generated = (parent.components as any[]).filter((c) => c._generated);
  for (const child of generated) {
    if (typeof child.dispose === 'function') {
      child.dispose();
    } else {
      child._disposed = true;
    }
  }
  parent.components = (parent.components as any[]).filter((c) => !c._generated);
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
