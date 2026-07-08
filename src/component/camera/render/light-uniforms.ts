import { LightT } from '../../light';
import { NexusT } from '../../nexus';
import { TransformT } from '../../transform';
import { castTo } from '../../types';
import { Vector3D } from '../../../math';

// Axonometric angle uniform location cache — keyed by camera component ID
const _axonometricAngle = new Map<number, WebGLUniformLocation | null>();

// Light uniform location caches — keyed by camera component ID
const _ambientColor = new Map<number, WebGLUniformLocation | null>();
const _ambientBrightness = new Map<number, WebGLUniformLocation | null>();
const _numDirLights = new Map<number, WebGLUniformLocation | null>();
const _numPointLights = new Map<number, WebGLUniformLocation | null>();
const _numSpotLights = new Map<number, WebGLUniformLocation | null>();
const _dirLightDir = new Map<number, (WebGLUniformLocation | null)[]>();
const _dirLightColor = new Map<number, (WebGLUniformLocation | null)[]>();
const _dirLightBrightness = new Map<number, (WebGLUniformLocation | null)[]>();
const _pointLightPos = new Map<number, (WebGLUniformLocation | null)[]>();
const _pointLightColor = new Map<number, (WebGLUniformLocation | null)[]>();
const _pointLightBrightness = new Map<
  number,
  (WebGLUniformLocation | null)[]
>();
const _pointLightRadius = new Map<number, (WebGLUniformLocation | null)[]>();
const _pointLightHardness = new Map<number, (WebGLUniformLocation | null)[]>();
const _spotLightPos = new Map<number, (WebGLUniformLocation | null)[]>();
const _spotLightColor = new Map<number, (WebGLUniformLocation | null)[]>();
const _spotLightBrightness = new Map<number, (WebGLUniformLocation | null)[]>();
const _spotLightRadius = new Map<number, (WebGLUniformLocation | null)[]>();
const _spotLightHardness = new Map<number, (WebGLUniformLocation | null)[]>();

// Per-frame light categorization arrays — reused to avoid allocations
const _ambientAccum = [0, 0, 0];
const _dirLightsArr: LightT[] = [];
const _pointLightsArr: { light: LightT; pos: Vector3D }[] = [];
const _spotLightsArr: { light: LightT; pos: Vector3D }[] = [];

// Reused scratch for vec3/scalar uniform uploads. gl.uniform*fv copy the array
// synchronously, so one shared buffer per call is safe and removes the per-light
// array-literal allocation that ran every frame.
const scratchVec3 = new Float32Array(3);
const scratchScalar = new Float32Array(1);

/** Pixels of overscan padding added to FBO dimensions (1px border each side). */
export const FBO_OVERSCAN_PX = 2;

/** Max point lights uploaded per frame (must match unified.frag). */
export const MAX_POINT_LIGHTS = 64;

/** Default ambient color when no lights are in the scene. */
const DEFAULT_AMBIENT_COLOR: [number, number, number] = [0.4, 0.4, 0.4];

/** Default directional light direction when no lights are in the scene. */
const DEFAULT_DIR_DIRECTION: [number, number, number] = [0.5, -0.7, 0.0];

/** Default directional light brightness when no lights are in the scene. */
const DEFAULT_DIR_BRIGHTNESS = 0.6;

export function cacheLightUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cameraId: number,
): void {
  _axonometricAngle.set(
    cameraId,
    gl.getUniformLocation(program, 'u_axonometricAngle'),
  );
  _ambientColor.set(cameraId, gl.getUniformLocation(program, 'u_ambientColor'));
  _ambientBrightness.set(
    cameraId,
    gl.getUniformLocation(program, 'u_ambientBrightness'),
  );
  _numDirLights.set(cameraId, gl.getUniformLocation(program, 'u_numDirLights'));
  _numPointLights.set(
    cameraId,
    gl.getUniformLocation(program, 'u_numPointLights'),
  );
  _numSpotLights.set(
    cameraId,
    gl.getUniformLocation(program, 'u_numSpotLights'),
  );

  const dirDir: (WebGLUniformLocation | null)[] = [];
  const dirColor: (WebGLUniformLocation | null)[] = [];
  const dirBrightness: (WebGLUniformLocation | null)[] = [];
  for (let i = 0; i < 4; i++) {
    dirDir[i] = gl.getUniformLocation(program, `u_dirLightDir[${i}]`);
    dirColor[i] = gl.getUniformLocation(program, `u_dirLightColor[${i}]`);
    dirBrightness[i] = gl.getUniformLocation(
      program,
      `u_dirLightBrightness[${i}]`,
    );
  }
  _dirLightDir.set(cameraId, dirDir);
  _dirLightColor.set(cameraId, dirColor);
  _dirLightBrightness.set(cameraId, dirBrightness);

  const ptPos: (WebGLUniformLocation | null)[] = [];
  const ptColor: (WebGLUniformLocation | null)[] = [];
  const ptBrightness: (WebGLUniformLocation | null)[] = [];
  const ptRadius: (WebGLUniformLocation | null)[] = [];
  const ptHardness: (WebGLUniformLocation | null)[] = [];
  const spPos: (WebGLUniformLocation | null)[] = [];
  const spColor: (WebGLUniformLocation | null)[] = [];
  const spBrightness: (WebGLUniformLocation | null)[] = [];
  const spRadius: (WebGLUniformLocation | null)[] = [];
  const spHardness: (WebGLUniformLocation | null)[] = [];
  for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
    ptPos[i] = gl.getUniformLocation(program, `u_pointLightPos[${i}]`);
    ptColor[i] = gl.getUniformLocation(program, `u_pointLightColor[${i}]`);
    ptBrightness[i] = gl.getUniformLocation(
      program,
      `u_pointLightBrightness[${i}]`,
    );
    ptRadius[i] = gl.getUniformLocation(program, `u_pointLightRadius[${i}]`);
    ptHardness[i] = gl.getUniformLocation(
      program,
      `u_pointLightHardness[${i}]`,
    );
    spPos[i] = gl.getUniformLocation(program, `u_spotLightPos[${i}]`);
    spColor[i] = gl.getUniformLocation(program, `u_spotLightColor[${i}]`);
    spBrightness[i] = gl.getUniformLocation(
      program,
      `u_spotLightBrightness[${i}]`,
    );
    spRadius[i] = gl.getUniformLocation(program, `u_spotLightRadius[${i}]`);
    spHardness[i] = gl.getUniformLocation(program, `u_spotLightHardness[${i}]`);
  }
  _pointLightPos.set(cameraId, ptPos);
  _pointLightColor.set(cameraId, ptColor);
  _pointLightBrightness.set(cameraId, ptBrightness);
  _pointLightRadius.set(cameraId, ptRadius);
  _pointLightHardness.set(cameraId, ptHardness);
  _spotLightPos.set(cameraId, spPos);
  _spotLightColor.set(cameraId, spColor);
  _spotLightBrightness.set(cameraId, spBrightness);
  _spotLightRadius.set(cameraId, spRadius);
  _spotLightHardness.set(cameraId, spHardness);
}

export function clearLightUniformCache(cameraId: number): void {
  _axonometricAngle.delete(cameraId);
  _ambientColor.delete(cameraId);
  _ambientBrightness.delete(cameraId);
  _numDirLights.delete(cameraId);
  _numPointLights.delete(cameraId);
  _numSpotLights.delete(cameraId);
  _dirLightDir.delete(cameraId);
  _dirLightColor.delete(cameraId);
  _dirLightBrightness.delete(cameraId);
  _pointLightPos.delete(cameraId);
  _pointLightColor.delete(cameraId);
  _pointLightBrightness.delete(cameraId);
  _pointLightRadius.delete(cameraId);
  _pointLightHardness.delete(cameraId);
  _spotLightPos.delete(cameraId);
  _spotLightColor.delete(cameraId);
  _spotLightBrightness.delete(cameraId);
  _spotLightRadius.delete(cameraId);
  _spotLightHardness.delete(cameraId);
}

/**
 * Uploads the axonometric angle uniform to the GPU.
 * Called once per render pass (cells + sprites share the same program).
 */
export function setAngleUniform(
  gl: WebGL2RenderingContext,
  cameraId: number,
  angleDegrees: number,
): void {
  const loc = _axonometricAngle.get(cameraId);
  if (loc) {
    gl.uniform1f(loc, angleDegrees);
  }
}

/**
 * Sets light uniform values on the unified shader program.
 * Categorizes lights by type and uploads to GPU uniform arrays.
 * Uses module-level cached uniform locations (populated by cacheLightUniformLocations).
 * When no lights are present, applies defaults matching the old hardcoded values.
 */
export function setLightUniforms(
  gl: WebGL2RenderingContext,
  cameraId: number,
  lights: LightT[],
): void {
  // Reset module-level categorization arrays
  _ambientAccum[0] = 0;
  _ambientAccum[1] = 0;
  _ambientAccum[2] = 0;
  let hasAmbient = false;
  _dirLightsArr.length = 0;
  _pointLightsArr.length = 0;
  _spotLightsArr.length = 0;

  for (const light of lights) {
    if (light.lightType === 'ambient') {
      _ambientAccum[0] += light.color.x * light.brightness;
      _ambientAccum[1] += light.color.y * light.brightness;
      _ambientAccum[2] += light.color.z * light.brightness;
      hasAmbient = true;
    } else if (light.lightType === 'directional') {
      _dirLightsArr.push(light);
    } else {
      // point or spot — need sibling transform for position
      const parent = light.parent;
      if (!parent || parent.type !== 'nexus') continue;
      const nexus = castTo<NexusT>(parent);
      const siblingTransform = nexus.getComponentByType(
        'transform',
        false,
      ) as TransformT | null;
      if (!siblingTransform) continue;
      // World position — lights are often nested under grouping nexuses.
      if (light.brightness <= 0) continue;
      const pos = siblingTransform.worldPosition;
      if (light.lightType === 'point') {
        _pointLightsArr.push({ light, pos });
      } else {
        _spotLightsArr.push({ light, pos });
      }
    }
  }

  const locAmbientColor = _ambientColor.get(cameraId)!;
  const locAmbientBrightness = _ambientBrightness.get(cameraId)!;
  const locNumDir = _numDirLights.get(cameraId)!;
  const locNumPoint = _numPointLights.get(cameraId)!;
  const locNumSpot = _numSpotLights.get(cameraId)!;
  const locDirDir = _dirLightDir.get(cameraId)!;
  const locDirColor = _dirLightColor.get(cameraId)!;
  const locDirBrightness = _dirLightBrightness.get(cameraId)!;
  const locPtPos = _pointLightPos.get(cameraId)!;
  const locPtColor = _pointLightColor.get(cameraId)!;
  const locPtBrightness = _pointLightBrightness.get(cameraId)!;
  const locPtRadius = _pointLightRadius.get(cameraId)!;
  const locPtHardness = _pointLightHardness.get(cameraId)!;
  const locSpPos = _spotLightPos.get(cameraId)!;
  const locSpColor = _spotLightColor.get(cameraId)!;
  const locSpBrightness = _spotLightBrightness.get(cameraId)!;
  const locSpRadius = _spotLightRadius.get(cameraId)!;
  const locSpHardness = _spotLightHardness.get(cameraId)!;

  // Apply defaults when no lights exist (matches old hardcoded values)
  if (lights.length === 0) {
    gl.uniform3f(locAmbientColor, ...DEFAULT_AMBIENT_COLOR);
    gl.uniform1f(locAmbientBrightness, 1.0);
    gl.uniform1i(locNumDir, 1);
    gl.uniform3fv(locDirDir[0], DEFAULT_DIR_DIRECTION);
    scratchVec3[0] = 1.0;
    scratchVec3[1] = 1.0;
    scratchVec3[2] = 1.0;
    gl.uniform3fv(locDirColor[0], scratchVec3);
    scratchScalar[0] = DEFAULT_DIR_BRIGHTNESS;
    gl.uniform1fv(locDirBrightness[0], scratchScalar);
    gl.uniform1i(locNumPoint, 0);
    gl.uniform1i(locNumSpot, 0);
    return;
  }

  // Ambient
  if (hasAmbient) {
    gl.uniform3f(
      locAmbientColor,
      _ambientAccum[0],
      _ambientAccum[1],
      _ambientAccum[2],
    );
    gl.uniform1f(locAmbientBrightness, 1.0);
  } else {
    gl.uniform3f(locAmbientColor, 0.0, 0.0, 0.0);
    gl.uniform1f(locAmbientBrightness, 0.0);
  }

  // Directional lights (capped at 4)
  const numDir = Math.min(_dirLightsArr.length, 4);
  gl.uniform1i(locNumDir, numDir);
  for (let i = 0; i < numDir; i++) {
    const l = _dirLightsArr[i];
    scratchVec3[0] = l.direction.x;
    scratchVec3[1] = l.direction.y;
    scratchVec3[2] = l.direction.z;
    gl.uniform3fv(locDirDir[i], scratchVec3);
    scratchVec3[0] = l.color.x;
    scratchVec3[1] = l.color.y;
    scratchVec3[2] = l.color.z;
    gl.uniform3fv(locDirColor[i], scratchVec3);
    scratchScalar[0] = l.brightness;
    gl.uniform1fv(locDirBrightness[i], scratchScalar);
  }

  // Point lights (capped at MAX_POINT_LIGHTS)
  const numPoint = Math.min(_pointLightsArr.length, MAX_POINT_LIGHTS);
  gl.uniform1i(locNumPoint, numPoint);
  for (let i = 0; i < numPoint; i++) {
    const { light: l, pos } = _pointLightsArr[i];
    scratchVec3[0] = pos.x;
    scratchVec3[1] = pos.y;
    scratchVec3[2] = pos.z;
    gl.uniform3fv(locPtPos[i], scratchVec3);
    scratchVec3[0] = l.color.x;
    scratchVec3[1] = l.color.y;
    scratchVec3[2] = l.color.z;
    gl.uniform3fv(locPtColor[i], scratchVec3);
    scratchScalar[0] = l.brightness;
    gl.uniform1fv(locPtBrightness[i], scratchScalar);
    scratchScalar[0] = l.radius;
    gl.uniform1fv(locPtRadius[i], scratchScalar);
    scratchScalar[0] = l.hardness;
    gl.uniform1fv(locPtHardness[i], scratchScalar);
  }

  // Spot lights (capped at 8)
  const numSpot = Math.min(_spotLightsArr.length, 8);
  gl.uniform1i(locNumSpot, numSpot);
  for (let i = 0; i < numSpot; i++) {
    const { light: l, pos } = _spotLightsArr[i];
    scratchVec3[0] = pos.x;
    scratchVec3[1] = pos.y;
    scratchVec3[2] = pos.z;
    gl.uniform3fv(locSpPos[i], scratchVec3);
    scratchVec3[0] = l.color.x;
    scratchVec3[1] = l.color.y;
    scratchVec3[2] = l.color.z;
    gl.uniform3fv(locSpColor[i], scratchVec3);
    scratchScalar[0] = l.brightness;
    gl.uniform1fv(locSpBrightness[i], scratchScalar);
    scratchScalar[0] = l.radius;
    gl.uniform1fv(locSpRadius[i], scratchScalar);
    scratchScalar[0] = l.hardness;
    gl.uniform1fv(locSpHardness[i], scratchScalar);
  }
}
