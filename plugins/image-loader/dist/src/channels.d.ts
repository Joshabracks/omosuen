/** Sprite texture channels an image can be assigned to. */
export type SpriteChannel = 'albedo' | 'normal' | 'material' | 'emission';
/** Slot order used wherever channels are iterated, so output is deterministic. */
export declare const CHANNEL_ORDER: SpriteChannel[];
/** The all-slots record a sprite expects, with unfilled slots as empty strings. */
export type TextureMapKeys = Record<SpriteChannel, string>;
/** Expands a partial channel→key map into the full four-slot record. */
export declare function spriteTextureMapKeys(keys: Partial<Record<SpriteChannel, string>>): TextureMapKeys;
/**
 * The channels an animation-controller should drive: exactly the slots that got
 * a texture-map key. Falls back to `['albedo']` when nothing was filled, matching
 * the controller's own default rather than handing it an empty list.
 */
export declare function animatedChannels(keys: TextureMapKeys): SpriteChannel[];
