import type { FogOfWarStyle, FogOfWarT } from '../../fog-of-war/data';

/**
 * The fog-of-war style and mode uniforms, uploaded from ONE place for both the
 * cell pass and the sprite pass.
 *
 * These used to live only in `renderCellMaps`, with the sprite pass reading
 * whatever that had left behind -- which is fine in a scene with terrain and
 * broken in a scene without it, and `renderSprites` had already grown a private
 * copy of `u_fogLightInfluence` for exactly that reason. It is also the shape of
 * a bug that already bit: the sprite gate and the terrain gate drifted apart,
 * and vision sources with no fog-of-war component made every sprite disappear.
 * One uploader, one set of defaults, both passes.
 *
 * Same structure as vision-uniforms.ts: locations cached per camera id at
 * program-build time, values uploaded per frame.
 */

const _fadedSaturation = new Map<number, WebGLUniformLocation | null>();
const _fadedOpacity = new Map<number, WebGLUniformLocation | null>();
const _fadedTint = new Map<number, WebGLUniformLocation | null>();
const _hiddenSaturation = new Map<number, WebGLUniformLocation | null>();
const _hiddenOpacity = new Map<number, WebGLUniformLocation | null>();
const _hiddenTint = new Map<number, WebGLUniformLocation | null>();
const _lightInfluence = new Map<number, WebGLUniformLocation | null>();
const _useExplored = new Map<number, WebGLUniformLocation | null>();
const _dropHidden = new Map<number, WebGLUniformLocation | null>();

/**
 * What a scene with vision sources but NO fog-of-war component renders as.
 *
 * Deliberately the same values `FogOfWar`'s builder defaults to, except
 * `memory`: an absent component means `'none'` (filter only, no history),
 * while adding one opts into `'full'`. That asymmetry is the point -- a
 * developer who wants memory says so by adding the component.
 */
const DEFAULT_FADED: FogOfWarStyle = {
  saturation: 0,
  opacity: 1,
  tint: { x: 1, y: 1, z: 1 } as FogOfWarStyle['tint'],
};
const DEFAULT_HIDDEN: FogOfWarStyle = {
  saturation: 0,
  opacity: 0,
  tint: { x: 0, y: 0, z: 0 } as FogOfWarStyle['tint'],
};

export function cacheFogUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cameraId: number,
): void {
  const loc = (name: string): WebGLUniformLocation | null =>
    gl.getUniformLocation(program, name);
  _fadedSaturation.set(cameraId, loc('u_fogFadedSaturation'));
  _fadedOpacity.set(cameraId, loc('u_fogFadedOpacity'));
  _fadedTint.set(cameraId, loc('u_fogFadedTint'));
  _hiddenSaturation.set(cameraId, loc('u_fogHiddenSaturation'));
  _hiddenOpacity.set(cameraId, loc('u_fogHiddenOpacity'));
  _hiddenTint.set(cameraId, loc('u_fogHiddenTint'));
  _lightInfluence.set(cameraId, loc('u_fogLightInfluence'));
  _useExplored.set(cameraId, loc('u_fogUseExplored'));
  _dropHidden.set(cameraId, loc('u_fogDropHidden'));
}

export function clearFogUniformCache(cameraId: number): void {
  for (const m of [
    _fadedSaturation,
    _fadedOpacity,
    _fadedTint,
    _hiddenSaturation,
    _hiddenOpacity,
    _hiddenTint,
    _lightInfluence,
    _useExplored,
    _dropHidden,
  ]) {
    m.delete(cameraId);
  }
}

/** Whether this scene's fog keeps persistent terrain history (`memory: 'full'`). */
export function fogUsesExploredHistory(fogOfWar: FogOfWarT | null): boolean {
  return fogOfWar?.memory === 'full';
}

/**
 * Uploads every style and mode uniform. `null` means no fog-of-war component in
 * the scene, which renders as the defaults above with `memory: 'none'`.
 */
export function setFogUniforms(
  gl: WebGL2RenderingContext,
  cameraId: number,
  fogOfWar: FogOfWarT | null,
): void {
  const faded = fogOfWar?.fadedStyle ?? DEFAULT_FADED;
  const hidden = fogOfWar?.hiddenStyle ?? DEFAULT_HIDDEN;

  gl.uniform1f(_fadedSaturation.get(cameraId) ?? null, faded.saturation);
  gl.uniform1f(_fadedOpacity.get(cameraId) ?? null, faded.opacity);
  gl.uniform3f(
    _fadedTint.get(cameraId) ?? null,
    faded.tint.x,
    faded.tint.y,
    faded.tint.z,
  );
  gl.uniform1f(_hiddenSaturation.get(cameraId) ?? null, hidden.saturation);
  gl.uniform1f(_hiddenOpacity.get(cameraId) ?? null, hidden.opacity);
  gl.uniform3f(
    _hiddenTint.get(cameraId) ?? null,
    hidden.tint.x,
    hidden.tint.y,
    hidden.tint.z,
  );
  gl.uniform1f(_lightInfluence.get(cameraId) ?? null, fogOfWar?.lightInfluence ?? 0);
  gl.uniform1i(
    _useExplored.get(cameraId) ?? null,
    fogUsesExploredHistory(fogOfWar) ? 1 : 0,
  );
  // Defaults TRUE with no component, which is what the vision-source-only
  // scene already did by accident and is the cheap path.
  gl.uniform1i(
    _dropHidden.get(cameraId) ?? null,
    fogOfWar?.dropHidden !== false ? 1 : 0,
  );
}

