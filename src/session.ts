// One entity's live Aseprite import: which layers and frames it shows, the
// sprites + controller that show them, and the frame references it holds on
// the (possibly shared) per-layer texture-maps. `extend` / `release` change the
// selection in place; `dispose` gives every reference back.
//
// Sharing model:
// - Parsed files are indexed once per filePath and cached (INDEX_CACHE); pixels
//   are decoded only for cels some entity draws, then dropped again.
// - A multi-source set shares one texture-map per layer name (SHARED_TEXTURES),
//   holding the union of the frames every entity of that set currently needs.
//   Frames are reference counted, so one entity's release never removes frames
//   another still shows, and the last release frees them for the atlas.
// - A single-file loader owns its texture-maps outright.
//
// All selection changes run through one queue (`enqueue`) so two entities never
// draw into, compact, or compile the same shared texture concurrently.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Vector2D, Vector3D, markForDisposal, newComponent } from 'omosuen';
import {
  SpriteChannel,
  TextureMapKeys,
  animatedChannels,
  spriteTextureMapKeys,
} from './channels.js';
import { LayerTexture } from './layer-texture.js';
import { dropPixels, getCel, indexAseprite, materializeCels } from './parser/parser.js';
import type { AseCel, AseFile, AseLayer } from './parser/types.js';
import {
  type FrameGroup,
  type FrameSelector,
  type LayerSelection,
  defaultFrameGroups,
  missingLayerNames,
  resolveFrameSelector,
  resolveLayers,
  selectorId,
  unionFrames,
} from './selection.js';

/** One file in a session. */
export interface AsepriteSourceSpec {
  /** Source id; prefixes animation names in a multi-source set ('' for single-file). */
  key: string;
  /** Static URL (fetched + indexed once per URL, then cached). */
  filePath?: string;
  /** Raw bytes instead of a URL (programmatic single-file import). */
  buffer?: ArrayBuffer;
  /** Default layer selection: only Aseprite-visible layers. Ignored when `layers` is set. */
  visibleOnly: boolean;
  /** Layers to load (names or predicate). Overrides `visibleOnly`. */
  layers?: LayerSelection;
  /** Tags / frames to load. Default: every frame, one animation per tag. */
  frames?: FrameSelector[];
}

export interface AsepriteSessionConfig {
  /** 'single': un-prefixed names, private texture-maps. 'set': shared by layer name. */
  mode: 'single' | 'set';
  /** Entity nexus that gets the sprites + controller (+ private texture-maps). */
  parent: any;
  atlasManager: any;
  /** Owner of shared texture-maps / animation-map (set mode; typically the scene root). */
  sharedParent?: any;
  packageId: string;
  flatten: boolean;
  anchor?: Vector2D;
  anchorMode?: 'center' | 'bottom-center';
  position?: Vector3D;
  scale?: Vector3D;
  layerSlots?: Record<string, string>;
}

/** A change to an entity's selection (`extend` adds it, `release` removes it). */
export interface AsepriteSelectionChange {
  /** Layer names. Not supported on a flattened loader. */
  layers?: string[];
  /** Tags / frames, in the same forms as the `frames` option. */
  frames?: FrameSelector[];
  /** Multi-source only: limit the change to one source id. Default: every source. */
  source?: string;
}

/** The handle a caller keeps to change or tear down an import. */
export interface AsepriteLoaderHandle {
  readonly controller: any | null;
  readonly sprites: any[];
  extend(change: AsepriteSelectionChange): Promise<void>;
  release(change: AsepriteSelectionChange): Promise<void>;
  dispose(): void;
}

interface SourceState {
  spec: AsepriteSourceSpec;
  ase: AseFile;
  /** First index of this source's block in the session's shared frame-index space. */
  offset: number;
  /** Animation-name prefix (`${key}-` in a set, '' single-file). */
  prefix: string;
  include: Set<string>;
  exclude: Set<string>;
  groups: Map<string, FrameGroup>;
  /** Frames differ from the file's default selection (no shared animation-map). */
  customFrames: boolean;
}

/** What one held frame of one texture is drawn from. */
interface Contribution {
  source: SourceState;
  local: number;
  layers: AseLayer[];
}

/**
 * The one channel an Aseprite import can fill. The parser composites every
 * layer down to a single RGBA image, and the format carries no normal/material/
 * emission information to split out — so this is a property of the file format,
 * not a limitation waiting to be lifted here. (The plain-image path in
 * `images.ts` is what fills the other slots.)
 */
const aseChannel: SpriteChannel = 'albedo';

function aseTextureMapKeys(texKey: string): TextureMapKeys {
  return spriteTextureMapKeys({ [aseChannel]: texKey });
}

/** Channels a controller over Aseprite-built sprites should advance. */
const aseChannels: SpriteChannel[] = animatedChannels(aseTextureMapKeys('non-empty'));

const INDEX_CACHE = new Map<string, Promise<AseFile | null>>();
const SHARED_TEXTURES = new Map<string, LayerTexture>();

let queue: Promise<unknown> = Promise.resolve();

/** Runs `fn` after every previously queued selection change has finished. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Forgets every cached file index (and the bytes it holds). Entities already
 * built keep working; the next import or `extend` of a file re-fetches it.
 */
export function clearAsepriteCache(): void {
  INDEX_CACHE.clear();
}

function loadIndex(spec: AsepriteSourceSpec, label: string): Promise<AseFile | null> {
  if (spec.buffer) return Promise.resolve(indexAseprite(spec.buffer));
  const filePath = spec.filePath ?? '';
  let pending = INDEX_CACHE.get(filePath);
  if (!pending) {
    pending = (async (): Promise<AseFile | null> => {
      const res = await fetch(filePath);
      if (!res.ok) {
        console.error(
          `[image-loader] failed to fetch ${label} ('${filePath}'): ${res.status} ${res.statusText}`,
        );
        return null;
      }
      return indexAseprite(await res.arrayBuffer());
    })().catch((error: unknown) => {
      console.error(`[image-loader] failed to load ${label} ('${filePath}')`, error);
      return null;
    });
    INDEX_CACHE.set(filePath, pending);
    // A failure isn't cached: the next import retries.
    void pending.then((ase) => {
      if (!ase && INDEX_CACHE.get(filePath) === pending) INDEX_CACHE.delete(filePath);
    });
  }
  return pending;
}

export class AsepriteSession implements AsepriteLoaderHandle {
  controller: any | null = null;
  private readonly sources: SourceState[] = [];
  private readonly setKey: string;
  private readonly cellW: number;
  private readonly cellH: number;
  private readonly layerOrder = new Map<string, number>();
  private readonly ownTextures = new Map<string, LayerTexture>();
  private held = new Map<LayerTexture, Set<number>>();
  private readonly spriteByName = new Map<string, any>();
  private flatSuffix = '';
  private disposed = false;

  private constructor(
    private readonly config: AsepriteSessionConfig,
    specs: AsepriteSourceSpec[],
    indexes: Array<AseFile | null>,
  ) {
    this.setKey = specs.map((s) => `${s.key}=${s.filePath ?? ''}`).join('+');
    let offset = 0;
    let cellW = 1;
    let cellH = 1;
    specs.forEach((spec, i) => {
      const ase = indexes[i];
      if (!ase) return;
      const state: SourceState = {
        spec,
        ase,
        offset,
        prefix: config.mode === 'set' ? `${spec.key}-` : '',
        include: new Set(),
        exclude: new Set(),
        groups: new Map(),
        customFrames: !!spec.frames,
      };
      const label = sourceLabel(config, spec);
      if (spec.frames) {
        for (const sel of spec.frames) {
          const g = resolveFrameSelector(ase, sel);
          if (g) state.groups.set(g.id, g);
          else console.warn(`[image-loader] ${label}: no tag or frame '${selectorId(sel)}'`);
        }
      } else {
        for (const g of defaultFrameGroups(ase)) state.groups.set(g.id, g);
      }
      if (Array.isArray(spec.layers)) {
        const missing = missingLayerNames(ase, spec.layers);
        if (missing.length) console.warn(`[image-loader] ${label}: no layer(s) ${missing.map((n) => `'${n}'`).join(', ')}`);
      }
      this.sources.push(state);
      offset += ase.frameCount;
      cellW = Math.max(cellW, ase.width);
      cellH = Math.max(cellH, ase.height);
      for (const l of ase.layers) {
        if (l.type === 0 && !this.layerOrder.has(l.name)) this.layerOrder.set(l.name, this.layerOrder.size);
      }
    });
    this.cellW = cellW;
    this.cellH = cellH;

    // A flattened texture's pixels depend on which layers are composited, so a
    // set whose layer choice isn't the default can't share the default's texture.
    if (config.flatten && config.mode === 'set' && this.sources.some((s) => s.spec.layers)) {
      const sig = this.sources
        .map((s) => `${s.spec.key}:${this.selectedLayers(s).map((l) => l.index).join('.')}`)
        .join('|');
      this.flatSuffix = `|${hashString(sig)}`;
    }
  }

  /** Fetches/indexes the sources, then builds the entity into `config.parent`. */
  static async create(
    specs: AsepriteSourceSpec[],
    config: AsepriteSessionConfig,
  ): Promise<AsepriteSession> {
    const indexes = await Promise.all(specs.map((s) => loadIndex(s, sourceLabel(config, s))));
    const session = new AsepriteSession(config, specs, indexes);
    await enqueue(() => session.build());
    return session;
  }

  get sprites(): any[] {
    return Array.from(this.spriteByName.values());
  }

  extend(change: AsepriteSelectionChange): Promise<void> {
    return this.change(change, 'extend');
  }

  release(change: AsepriteSelectionChange): Promise<void> {
    return this.change(change, 'release');
  }

  /**
   * Gives back every frame reference and drops this entity's own texture-maps.
   * Shared frames nobody else holds leave their texture-map now; the atlas
   * reclaims their space on its next compile.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const owner = this.textureOwner();
    for (const [lt, frames] of this.held) {
      for (const f of frames) lt.release(f);
      // With the component already created there's nothing to await, so this
      // completes synchronously.
      void lt.commit(owner, this.config.atlasManager);
    }
    this.held.clear();
    for (const lt of this.ownTextures.values()) lt.disposeComponent(this.config.atlasManager);
    this.ownTextures.clear();
  }

  private async build(): Promise<void> {
    const { parent, packageId } = this.config;
    removeGeneratedChildren(parent);
    await ensureTransform(parent, packageId, this.config);
    await this.apply();

    const animations = this.animations();
    let animationSpec: any = Array.from(animations.values());
    if (this.config.mode === 'set' && this.config.sharedParent && !this.sources.some((s) => s.customFrames)) {
      // Default selection: share one animation-map per art set, as always.
      await getOrCreateAnimationMap(this.config.sharedParent, this.setKey, animationSpec);
      animationSpec = this.setKey;
    }
    const controller = await newComponent(
      'animation-controller',
      {
        name: `${packageId} Anim`,
        animations: animationSpec,
        layers: this.orderedNames().map((name) => this.layerBinding(name)),
        channels: aseChannels,
      },
      parent,
    );
    if (controller) controller._generated = true;
    this.controller = controller ?? null;
  }

  private change(change: AsepriteSelectionChange, kind: 'extend' | 'release'): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return enqueue(async () => {
      if (this.disposed) return;
      const targets = change.source === undefined
        ? this.sources
        : this.sources.filter((s) => s.spec.key === change.source);
      if (targets.length === 0) {
        console.warn(`[image-loader] '${this.config.packageId}' ${kind}: no source '${change.source}'`);
        return;
      }

      if (change.layers?.length) {
        if (this.config.flatten) {
          console.warn(
            `[image-loader] '${this.config.packageId}' ${kind}: layers can't change on a flattened loader (flatten: true); ignored`,
          );
        } else {
          for (const name of change.layers) {
            let found = false;
            for (const s of targets) {
              if (missingLayerNames(s.ase, [name]).length === 0) found = true;
              if (kind === 'extend') {
                s.exclude.delete(name);
                s.include.add(name);
              } else {
                s.include.delete(name);
                s.exclude.add(name);
              }
            }
            if (!found) console.warn(`[image-loader] '${this.config.packageId}' ${kind}: no layer '${name}'`);
          }
        }
      }

      for (const sel of change.frames ?? []) {
        let found = false;
        for (const s of targets) {
          if (kind === 'extend') {
            const g = resolveFrameSelector(s.ase, sel);
            if (!g) continue;
            s.groups.set(g.id, g);
            s.customFrames = true;
            found = true;
          } else if (s.groups.delete(selectorId(sel))) {
            s.customFrames = true;
            found = true;
          }
        }
        if (!found) {
          console.warn(
            `[image-loader] '${this.config.packageId}' ${kind}: ` +
              (kind === 'extend' ? `no tag or frame '${selectorId(sel)}'` : `'${selectorId(sel)}' is not loaded`),
          );
        }
      }

      await this.apply();
      this.syncAnimations();
    });
  }

  private selectedLayers(s: SourceState): AseLayer[] {
    return resolveLayers(s.ase, s.spec.layers, {
      visibleOnly: s.spec.visibleOnly,
      include: s.include,
      exclude: s.exclude,
    });
  }

  /** Every (texture name → absolute frame → what to draw) the selection needs. */
  private desired(): Map<string, Map<number, Contribution>> {
    const out = new Map<string, Map<number, Contribution>>();
    const add = (name: string, abs: number, c: Contribution): void => {
      let m = out.get(name);
      if (!m) {
        m = new Map();
        out.set(name, m);
      }
      m.set(abs, c);
    };
    for (const s of this.sources) {
      const layers = this.selectedLayers(s);
      if (layers.length === 0) continue;
      const frames = unionFrames(s.groups.values());
      if (this.config.flatten) {
        for (const f of frames) add(this.config.packageId, s.offset + f, { source: s, local: f, layers });
        continue;
      }
      for (const name of new Set(layers.map((l) => l.name))) {
        // Every same-named layer, so a shared cell's pixels never depend on
        // which entity happened to draw it first.
        const same = s.ase.layers.filter((l) => l.type === 0 && l.name === name);
        for (const f of frames) add(name, s.offset + f, { source: s, local: f, layers: same });
      }
    }
    return out;
  }

  private textureOwner(): any {
    return this.config.mode === 'set' ? this.config.sharedParent : this.config.parent;
  }

  private textureKey(name: string): { key: string; path: string } {
    const suffix = this.config.flatten ? this.flatSuffix : '';
    const ns = this.config.mode === 'set' ? this.setKey : this.config.packageId;
    return { key: `aseprite:${ns}:${name}${suffix}`, path: `aseprite://${ns}/${name}${suffix}` };
  }

  private textureFor(name: string): LayerTexture {
    const { key, path } = this.textureKey(name);
    if (this.config.mode === 'single') {
      let lt = this.ownTextures.get(name);
      if (!lt) {
        lt = new LayerTexture(key, path, this.cellW, this.cellH);
        this.ownTextures.set(name, lt);
      }
      return lt;
    }
    let lt = SHARED_TEXTURES.get(key);
    if (!lt || !lt.isLive(this.config.atlasManager)) {
      lt = new LayerTexture(key, path, this.cellW, this.cellH);
      SHARED_TEXTURES.set(key, lt);
    }
    return lt;
  }

  /** Brings textures, sprites and the atlas in line with the current selection. */
  private async apply(): Promise<void> {
    const am = this.config.atlasManager;
    const desired = this.desired();

    const nextHeld = new Map<LayerTexture, Set<number>>();
    const toAcquire: Array<{ lt: LayerTexture; abs: number; c: Contribution }> = [];
    for (const [name, frames] of desired) {
      const lt = this.textureFor(name);
      const prev = this.held.get(lt);
      const next = new Set<number>();
      for (const [abs, c] of frames) {
        next.add(abs);
        if (!prev?.has(abs)) toAcquire.push({ lt, abs, c });
      }
      nextHeld.set(lt, next);
    }

    // Decode just the cels about to be drawn, one batch per source.
    const bySource = new Map<SourceState, { frames: Set<number>; layers: Set<number> }>();
    for (const { c } of toAcquire) {
      let b = bySource.get(c.source);
      if (!b) {
        b = { frames: new Set(), layers: new Set() };
        bySource.set(c.source, b);
      }
      b.frames.add(c.local);
      for (const l of c.layers) b.layers.add(l.index);
    }
    for (const [s, b] of bySource) await materializeCels(s.ase, b.frames, b.layers);

    for (const { lt, abs, c } of toAcquire) {
      lt.acquire(abs, c.source.ase.width, c.source.ase.height, (ctx, x, y) => {
        for (const layer of c.layers) {
          const cel = getCel(c.source.ase, c.local, layer.index);
          if (cel) blitCel(ctx, cel, layer.opacity, x + cel.x, y + cel.y);
        }
      });
    }
    for (const [s, b] of bySource) dropPixels(s.ase, b.frames, b.layers);

    const touched = new Set<LayerTexture>(nextHeld.keys());
    for (const [lt, prev] of this.held) {
      touched.add(lt);
      const next = nextHeld.get(lt);
      for (const abs of prev) if (!next?.has(abs)) lt.release(abs);
    }
    this.held = nextHeld;

    let compile = false;
    const owner = this.textureOwner();
    for (const lt of touched) {
      if (await lt.commit(owner, am)) compile = true;
    }

    await this.syncSprites(desired);
    if (compile) await am.processTextureMaps();
  }

  /** Sprite/layer names in stable draw order (file layer order across the set). */
  private orderedNames(): string[] {
    return Array.from(this.spriteByName.keys()).sort(
      (a, b) => (this.layerOrder.get(a) ?? 0) - (this.layerOrder.get(b) ?? 0),
    );
  }

  private layerBinding(name: string): any {
    return { name, spriteName: name, visible: true, slot: this.config.layerSlots?.[name] };
  }

  private async syncSprites(desired: Map<string, Map<number, Contribution>>): Promise<void> {
    const { parent } = this.config;

    for (const [name, sprite] of this.spriteByName) {
      if (desired.has(name)) continue;
      this.spriteByName.delete(name);
      sprite.visible = false;
      markForDisposal(sprite);
      if (this.controller) {
        this.controller.layers = (this.controller.layers as any[]).filter((l) => l.name !== name);
        this.controller._layerSprites = undefined;
      }
    }

    const names = Array.from(desired.keys())
      .filter((n) => !this.spriteByName.has(n))
      .sort((a, b) => (this.layerOrder.get(a) ?? 0) - (this.layerOrder.get(b) ?? 0));
    for (const name of names) {
      const frames = desired.get(name)!;
      const first = frames.values().next().value as Contribution;
      const frame = this.currentFrame() ?? Math.min(...frames.keys());
      const sprite = await newComponent(
        'sprite',
        {
          name,
          textureMapKeys: aseTextureMapKeys(this.textureKey(name).key),
          frame: { albedo: frame, normal: frame, material: frame, emission: frame },
          anchor: resolveAnchor(first.source.ase, this.config),
          renderOrder: this.config.flatten ? 0 : this.layerOrder.get(name) ?? 0,
          visible: true,
        },
        parent,
      );
      if (!sprite) continue;
      sprite._generated = true;
      this.spriteByName.set(name, sprite);
      if (this.controller) {
        this.controller.addLayer(this.layerBinding(name));
        // Applies the slot (a newly-equipped helmet hides the other headgear).
        this.controller.setLayerVisible(name, true);
      }
    }
  }

  /** The animations the selection exposes, in absolute frame numbers. */
  private animations(): Map<string, any> {
    const out = new Map<string, any>();
    for (const s of this.sources) {
      for (const g of s.groups.values()) {
        if (!g.animation) continue;
        const name = s.prefix + g.animation.name;
        out.set(name, { ...g.animation, name, frames: g.animation.frames.map((f) => f + s.offset) });
      }
    }
    return out;
  }

  /** Adds/removes controller animations to match the selection. */
  private syncAnimations(): void {
    const ac = this.controller;
    if (!ac) return;
    const wanted = this.animations();
    for (const name of Array.from((ac.animations as Map<string, any>).keys())) {
      if (!wanted.has(name)) ac.removeAnimation(name);
    }
    for (const [name, anim] of wanted) {
      if (!ac.hasAnimation(name)) ac.addAnimation(anim);
    }
    // The playing animation was released: park every sprite on a frame that's
    // still loaded, so none points at a frame that just left its texture.
    if (ac.currentAnimation && !ac.hasAnimation(ac.currentAnimation)) {
      ac.currentAnimation = null;
      ac.state = 'stopped';
      const park = this.firstHeldFrame();
      if (park !== null) for (const sprite of this.spriteByName.values()) sprite.setFrame(park, aseChannels);
    }
  }

  private currentFrame(): number | null {
    const ac = this.controller;
    if (!ac || !ac.currentAnimation) return null;
    const anim = (ac.animations as Map<string, any>).get(ac.currentAnimation);
    const f = anim?.frames[ac.currentFrameIndex];
    return typeof f === 'number' ? f : null;
  }

  private firstHeldFrame(): number | null {
    let min: number | null = null;
    for (const frames of this.held.values()) for (const f of frames) if (min === null || f < min) min = f;
    return min;
  }
}

function sourceLabel(config: AsepriteSessionConfig, spec: AsepriteSourceSpec): string {
  return config.mode === 'set' ? `source '${spec.key}'` : `'${config.packageId}'`;
}

/** Small stable string hash (FNV-1a, base 36) for texture-key suffixes. */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Finds an animation-map by key anywhere under `sharedParent`. */
function findAnimationMap(sharedParent: any, key: string): any {
  const maps = (sharedParent.getComponentsByType('animation-map', true) ?? []) as any[];
  return maps.find((m) => m.animationMapKey === key && !m._disposed) ?? null;
}

/** Returns the shared animation-map for `key`, creating it once if absent. */
async function getOrCreateAnimationMap(sharedParent: any, key: string, animations: any[]): Promise<any> {
  const existing = findAnimationMap(sharedParent, key);
  if (existing) return existing;
  const map = await newComponent('animation-map', { name: key, animationMapKey: key, animations }, sharedParent);
  if (map) map._generated = true;
  return map ?? null;
}

/**
 * Resolves the sprite anchor: an explicit pixel `anchor` wins; else the named
 * mode against the file's canvas size ('bottom-center' = foot-anchored); else
 * center.
 */
export function resolveAnchor(
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

/**
 * Disposes and removes this nexus's loader-generated children. Children are
 * engine component proxies, so `child.dispose()` dispatches the right teardown.
 */
export function removeGeneratedChildren(parent: any): void {
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
  const tmp = document.createElement('canvas');
  tmp.width = cel.w;
  tmp.height = cel.h;
  const tctx = tmp.getContext('2d');
  if (!tctx) throw new Error('[aseprite] failed to acquire a 2D canvas context');
  tctx.putImageData(new ImageData(new Uint8ClampedArray(cel.pixels), cel.w, cel.h), 0, 0);
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = (layerOpacity / 255) * (cel.opacity / 255);
  ctx.drawImage(tmp, destX, destY);
  ctx.globalAlpha = prevAlpha;
}
