// Plain-image ingestion: turn declared per-channel images into one sprite with
// its texture-map channels populated.
//
// This is the non-Aseprite half of the loader. The Aseprite path composites
// layers out of a parsed binary and only ever produces an albedo; here the
// caller says which channel each image feeds, which is what finally makes the
// sprite's `normal` / `material` / `emission` slots reachable declaratively.
//
// The `material` channel is special: the renderer reads it as
// `R = metallic, G = roughness, B = region mask`, so it accepts a *grouped*
// form that channel-packs those into one image via the engine's `packMaterial`.
// That removes the step where an artist merges three grayscale files by hand.
import { Vector2D, newComponent, packFrameStrip, packMaterial } from 'omosuen';
import { CHANNEL_ORDER, animatedChannels, spriteTextureMapKeys, } from './channels.js';
function isMaterialSpec(spec) {
    return typeof spec === 'object' && spec !== null && !Array.isArray(spec);
}
/**
 * The per-frame pixel size a channel's images resolve to, or null when it can't
 * be known without decoding. Only used to place a named anchor.
 *
 * `imageType` is authoritative when present: a grid or explicit frame map means
 * the sheet is many frames, and anchoring against the sheet's full height would
 * put a 'bottom-center' sprite far below the ground.
 */
function frameSizeFrom(imageType, sheet) {
    if (Array.isArray(imageType) && imageType.length > 0) {
        const first = imageType[0];
        if (typeof first?.z === 'number' && typeof first?.w === 'number') {
            return new Vector2D(first.z, first.w);
        }
    }
    const grid = imageType;
    if (grid?.cellSize)
        return new Vector2D(grid.cellSize.x, grid.cellSize.y);
    if (sheet)
        return new Vector2D(sheet.width, sheet.height);
    return null;
}
/**
 * Produces the image for one channel, plus the frame rects when the channel was
 * assembled from separate per-frame files.
 */
async function buildChannelImage(channel, spec, packageId, imageType, sheetSize) {
    if (Array.isArray(spec)) {
        // A strip carries its own FrameMap, so its per-frame size is already exact
        // and `imageType` does not apply.
        const strip = await packFrameStrip(spec, {
            label: `${packageId}.${channel}`,
        });
        return { image: strip.canvas, frames: strip.frames, frameSize: strip.size };
    }
    if (isMaterialSpec(spec)) {
        if (channel !== 'material') {
            console.warn(`[image-loader] '${packageId}': the grouped {metallic, roughness, mask} ` +
                `form only makes sense for the 'material' channel, not '${channel}'.`);
        }
        // A material given only constants ("all metal, roughness 0.35") has no
        // source to infer a size from, and the packer rightly refuses to guess. But
        // the size it needs is not a mystery here — a material must register with
        // its albedo pixel for pixel, so the sheet size is the answer.
        const canvas = await packMaterial({
            metallic: spec.metallic ?? 0,
            roughness: spec.roughness ?? 1,
            mask: spec.mask === undefined
                ? 0
                : { source: spec.mask, quantize: spec.maskLevels },
        }, {
            label: `${packageId}.material`,
            ...(sheetSize ? { size: sheetSize } : {}),
        });
        return {
            image: canvas,
            frameSize: frameSizeFrom(imageType, canvas),
        };
    }
    // A plain URL: hand the path straight to texture-map and let the atlas load
    // it, rather than decoding it here only to re-blit it. That leaves the sheet
    // size unknown, so only an explicit `imageType` can answer a named anchor.
    return { image: spec, frameSize: frameSizeFrom(imageType, null) };
}
/**
 * Natural dimensions of the first channel that names an image file, without
 * reading a single pixel — so this never taints a canvas and never needs CORS.
 * Returns null when every channel is a constant, which is the one case the
 * caller genuinely cannot resolve on its own.
 */
async function inferSheetSize(images) {
    for (const channel of CHANNEL_ORDER) {
        const spec = images[channel];
        const url = typeof spec === 'string' ? spec : undefined;
        if (!url)
            continue;
        try {
            return await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(new Vector2D(img.naturalWidth, img.naturalHeight));
                img.onerror = () => reject(new Error(`could not load ${url}`));
                img.src = url;
            });
        }
        catch {
            // Fall through to the next channel: a channel that fails to load will
            // report its own error when the atlas tries to use it, and guessing a
            // material size off a broken file would be worse than not guessing.
        }
    }
    return null;
}
/**
 * Explicit pixel anchor wins; else the named mode against the resolved frame
 * size; else the sprite's own (0, 0) top-left default.
 *
 * A named mode with no knowable frame size warns rather than guessing: silently
 * anchoring at top-left would leave the sprite floating half a frame off the
 * ground, which reads as a placement bug rather than a missing dimension.
 */
function resolveAnchor(config, frameSize, packageId) {
    if (config.anchor)
        return config.anchor;
    if (!config.anchorMode)
        return undefined;
    if (!frameSize) {
        console.warn(`[image-loader] '${packageId}': anchorMode '${config.anchorMode}' needs a ` +
            `frame size, but every channel is a plain URL with no 'imageType'. ` +
            `Pass an explicit 'anchor', or an 'imageType' giving the frame rects.`);
        return undefined;
    }
    return config.anchorMode === 'bottom-center'
        ? new Vector2D(frameSize.x / 2, frameSize.y)
        : new Vector2D(frameSize.x / 2, frameSize.y / 2);
}
/**
 * Builds one sprite whose texture channels come from separately declared
 * images.
 *
 * Only the channels actually supplied are populated, and the returned
 * `channels` list is what an animation-controller should be told to drive —
 * previously that was hardcoded to `['albedo']`, which is why nothing but
 * albedo was ever reachable.
 */
export async function importImages(config) {
    const { parent, packageId, images } = config;
    const keys = {};
    // First channel that can report a per-frame size wins; every channel must
    // register pixel-for-pixel anyway, so any of them answers the anchor question.
    let frameSize = null;
    let frameCount = 0;
    // The full SHEET size, which is what a constant-only material has to be built
    // at — a strip's sheet is frameSize * frameCount wide, not frameSize.
    let sheetSize = config.sheetSize ?? null;
    // Albedo is first in CHANNEL_ORDER, so by the time a constant-only material
    // is built the sheet size is usually already known. When albedo is a plain URL
    // handed straight to the atlas, nothing has decoded it — so decode it here,
    // for its dimensions only.
    if (!sheetSize)
        sheetSize = await inferSheetSize(images);
    for (const channel of CHANNEL_ORDER) {
        const spec = images[channel];
        if (spec === undefined)
            continue;
        const built = await buildChannelImage(channel, spec, packageId, config.imageType, sheetSize);
        const { image, frames } = built;
        if (!frameSize)
            frameSize = built.frameSize;
        if (!sheetSize && typeof image !== 'string') {
            const c = image;
            if (c.width && c.height)
                sheetSize = new Vector2D(c.width, c.height);
        }
        const texKey = `image:${packageId}:${channel}`;
        const tm = await newComponent('texture-map', typeof image === 'string'
            ? {
                name: texKey,
                textureMapKey: texKey,
                filePath: image,
                imageType: frames ?? config.imageType,
            }
            : {
                name: texKey,
                textureMapKey: texKey,
                // Synthetic path: the atlas only uses it as a dedup key, exactly as
                // the Aseprite path does with `aseprite://`.
                filePath: `image://${packageId}/${channel}`,
                sourceImage: image,
                imageType: frames ?? config.imageType,
            }, parent);
        if (tm)
            tm._generated = true;
        keys[channel] = texKey;
        if (frames && !frameCount)
            frameCount = frames.length;
    }
    const textureMapKeys = spriteTextureMapKeys(keys);
    const used = CHANNEL_ORDER.filter((c) => keys[c] !== undefined);
    if (used.length === 0) {
        console.warn(`[image-loader] '${packageId}': no images supplied`);
        return { sprite: null, controller: null, channels: [] };
    }
    const sprite = (await newComponent('sprite', {
        name: packageId,
        textureMapKeys,
        frame: { albedo: 0, normal: 0, material: 0, emission: 0 },
        anchor: resolveAnchor(config, frameSize, packageId),
        renderOrder: config.renderOrder ?? 0,
        visible: true,
    }, parent));
    if (sprite)
        sprite._generated = true;
    // A multi-frame import gets a controller so every populated channel advances
    // in lockstep. Without listing them all, a material strip would sit frozen on
    // frame 0 while albedo animated — the packed roughness/mask would then belong
    // to the wrong frame from the second tick onward.
    let controller = null;
    if (sprite && frameCount > 1) {
        controller = (await newComponent('animation-controller', {
            name: `${packageId} Anim`,
            animations: config.animations ?? [
                {
                    name: 'default',
                    frames: Array.from({ length: frameCount }, (_, i) => i),
                    frameDurations: Array.from({ length: frameCount }, () => config.frameDurationMs ?? 100),
                    frameRate: 12,
                    loop: true,
                },
            ],
            layers: [{ name: sprite.name, spriteName: sprite.name, visible: true }],
            channels: animatedChannels(textureMapKeys),
        }, parent));
        if (controller)
            controller._generated = true;
    }
    await config.atlasManager.processTextureMaps();
    return { sprite, controller, channels: used };
}
