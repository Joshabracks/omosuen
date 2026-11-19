import { Vector2D } from 'omosuen';
import { SpriteChannel } from './channels.js';
export type { SpriteChannel };
/** The grouped form accepted by the `material` channel. */
export interface MaterialChannelSpec {
    /** Grayscale source or a constant 0..1. Defaults to 0 (non-metal). */
    metallic?: string | number;
    /** Grayscale source or a constant 0..1. Defaults to 1 (fully rough). */
    roughness?: string | number;
    /** Region-mask source or constant. Quantise it with `maskLevels`. */
    mask?: string | number;
    /** Snap the mask to N evenly-spaced levels. Strongly advised for indices. */
    maskLevels?: number;
}
/**
 * What one channel accepts.
 *
 * - a URL string — used as-is
 * - an array of URLs — composited into a horizontal frame strip
 * - a `MaterialChannelSpec` — channel-packed (only meaningful for `material`)
 */
export type ImageChannelSpec = string | string[] | MaterialChannelSpec;
export interface ImageImportConfig {
    parent: NexusLike;
    atlasManager: AtlasManagerLike;
    packageId: string;
    images: Partial<Record<SpriteChannel, ImageChannelSpec>>;
    /** Frame layout for single-image channels. Passed through to `texture-map`. */
    imageType?: unknown;
    /** Explicit pixel anchor. Wins over `anchorMode`. */
    anchor?: Vector2D;
    /**
     * Named anchor, resolved against the FRAME size (not the sheet size) exactly
     * as the Aseprite path resolves it against the .ase canvas.
     */
    anchorMode?: 'center' | 'bottom-center';
    renderOrder?: number;
    /**
     * Timelines for the generated controller. Omit for a single looping 'default'
     * animation over every frame. Shape matches `animation-controller`'s
     * `Animation`: `{ name, frames: number[], frameDurations: number[], frameRate,
     * loop }`.
     */
    animations?: unknown[];
    /** Per-frame hold for the generated 'default' animation. Default 100ms. */
    frameDurationMs?: number;
    /**
     * Sheet size for a material built entirely from constants. Only needed when
     * no channel names an image file to measure — otherwise it is inferred.
     */
    sheetSize?: Vector2D;
}
export interface ImageImportResult {
    sprite: SpriteLike | null;
    /** Only built for a multi-frame import; null for a single still frame. */
    controller: ComponentLike | null;
    /** Channels that actually produced a texture-map. */
    channels: SpriteChannel[];
}
type NexusLike = {
    components: ComponentLike[];
};
type ComponentLike = {
    _generated?: boolean;
};
type SpriteLike = ComponentLike & {
    name: string;
};
type AtlasManagerLike = {
    processTextureMaps: () => Promise<void>;
};
/**
 * Builds one sprite whose texture channels come from separately declared
 * images.
 *
 * Only the channels actually supplied are populated, and the returned
 * `channels` list is what an animation-controller should be told to drive —
 * previously that was hardcoded to `['albedo']`, which is why nothing but
 * albedo was ever reachable.
 */
export declare function importImages(config: ImageImportConfig): Promise<ImageImportResult>;
