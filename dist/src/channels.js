// Sprite texture channels, shared by both ingestion paths.
//
// `sprite.textureMapKeys` is a fixed four-slot record and the animation
// controller's `channels` list must name exactly the slots that are actually
// filled — a controller told to advance `material` when no material texture-map
// exists steps a frame index on nothing, and one NOT told about a material strip
// leaves that channel frozen on frame 0 while albedo animates. Deriving both
// from one place is what keeps those two in agreement.
/** Slot order used wherever channels are iterated, so output is deterministic. */
export const CHANNEL_ORDER = [
    'albedo',
    'normal',
    'material',
    'emission',
];
/** Expands a partial channel→key map into the full four-slot record. */
export function spriteTextureMapKeys(keys) {
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
export function animatedChannels(keys) {
    const used = CHANNEL_ORDER.filter((c) => keys[c] !== '');
    return used.length > 0 ? used : ['albedo'];
}
