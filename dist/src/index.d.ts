export { imageLoaderDefinition } from './component.js';
export type { ImageLoaderT, ImageLoaderOptions, AsepriteSourceOptions, } from './component.js';
export { importAseprite, importAsepriteSources } from './import.js';
export type { AsepriteImportConfig, AsepriteImportResult, AsepriteSourceEntry, AsepriteSourcesConfig, } from './import.js';
export { importImages } from './images.js';
export type { ImageChannelSpec, ImageImportConfig, ImageImportResult, MaterialChannelSpec, } from './images.js';
export { animatedChannels, spriteTextureMapKeys, CHANNEL_ORDER, } from './channels.js';
export type { SpriteChannel, TextureMapKeys } from './channels.js';
export { parseAseprite, indexAseprite, materializeCels, dropPixels, getCel, } from './parser/parser.js';
export type { AseSelection } from './parser/parser.js';
export type { AseFile, AseLayer, AseCel, AseFrame, AseTag, } from './parser/types.js';
export { clearAsepriteCache } from './session.js';
export type { AsepriteLoaderHandle, AsepriteSelectionChange, } from './session.js';
export { resolveFrameSelector, resolveFrameSelectors, resolveLayers, defaultFrameGroups, tagAnimation, } from './selection.js';
export type { FrameSelector, FrameGroup, LayerSelection, AnimationSpec, } from './selection.js';
/**
 * Convenience: register the `image-loader` component type with the engine.
 * Equivalent to passing `imageLoaderDefinition` in `Omosuen.init({ plugins })`.
 */
export declare function registerImageLoader(): void;
