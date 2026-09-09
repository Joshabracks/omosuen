// Sprite texture channels, shared by both ingestion paths.
//
// `sprite.textureMapKeys` is a fixed four-slot record and the animation
// controller's `channels` list must name exactly the slots that are actually
// filled — a controller told to advance `material` when no material texture-map
// exists steps a frame index on nothing, and one NOT told about a material strip
// leaves that channel frozen on frame 0 while albedo animates. Deriving both
// from one place is what keeps those two in agreement.

/** Sprite texture channels an image can be assigned to. */
export type SpriteChannel = 'albedo' | 'normal' | 'material' | 'emission';

/** Slot order used wherever channels are iterated, so output is deterministic. */
export const CHANNEL_ORDER: SpriteChannel[] = [
  'albedo',
  'normal',
  'material',
  'emission',
];

/** The all-slots record a sprite expects, with unfilled slots as empty strings. */
export type TextureMapKeys = Record<SpriteChannel, string>;

/** Expands a partial channel→key map into the full four-slot record. */
export function spriteTextureMapKeys(
  keys: Partial<Record<SpriteChannel, string>>,
): TextureMapKeys {
  return {
    albedo: keys.albedo ?? '',
    normal: keys.normal ?? '',
    material: keys.material ?? '',
    emission: keys.emission ?? '',
  };
}

/**
 * The channels an animation-controller should drive: exactly the slots that got
 * a texture-map key. Falls back to `['albedo']` when nothing was filled, matching
 * the controller's own default rather than handing it an empty list.
 */
export function animatedChannels(keys: TextureMapKeys): SpriteChannel[] {
  const used = CHANNEL_ORDER.filter((c) => keys[c] !== '');
  return used.length > 0 ? used : ['albedo'];
}
