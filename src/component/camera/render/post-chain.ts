import { CameraT, PostEffect, PostEffectUniformValue } from '../data';
import { createShaderProgram } from '../shader/create-shader-program';
import postEffectVertexShader from '../shader/post-effect.vert';
import { SubPixelOffset, computeFboUvBridge } from './framebuffers';

/**
 * One compiled chain stage. `program === null` marks a stage whose source
 * failed to compile: it is skipped for the rest of the session rather than
 * retried every frame, and the rest of the chain still runs. A broken effect
 * must never black-screen the game.
 */
interface CompiledStage {
  name: string;
  program: WebGLProgram | null;
  /** The exact source this was built from; a change triggers a recompile. */
  source: string;
  /** Engine-contract uniform locations, resolved once at compile time. */
  loc: Record<string, WebGLUniformLocation | null>;
  /** Stage-private uniform locations, keyed by the author's own names. */
  userLoc: Map<string, WebGLUniformLocation | null>;
}

/** Compiled state per camera id. Cleared by `clearPostChainCache`. */
const stageCache = new Map<number, CompiledStage[]>();

/** Engine-provided uniforms every stage receives. See README/T8 for meanings. */
const CONTRACT_UNIFORMS = [
  'u_color',
  'u_ids',
  'u_aux',
  'u_depth',
  'u_depthUvScale',
  'u_depthUvOffset',
  'u_resolution',
  'u_texelSize',
  'u_time',
  'u_frame',
  'u_stageIndex',
  'u_orbitYaw',
  'u_axonometricAngle',
  'u_zoom',
  'u_pixelScale',
  'u_cameraWorldPos',
  'u_cellSize',
];

/** Texture units the chain binds. Kept clear of the geometry passes' units. */
const UNIT_COLOR = 0;
const UNIT_IDS = 8;
const UNIT_AUX = 9;
const UNIT_DEPTH = 10;

const startTime =
  typeof performance !== 'undefined' ? performance.now() : Date.now();
let frameCounter = 0;

/**
 * GLSL ES 3.00 is required (the mask sampler is an integer sampler, and the
 * shared vertex stage is 3.00). Prepending is friendlier than failing: without
 * it the link error just says "linking failed", with no hint that a version
 * directive was the problem.
 */
function ensureVersionDirective(source: string): string {
  return source.trimStart().startsWith('#version')
    ? source
    : `#version 300 es\n${source}`;
}

/** Compiles any stage whose source changed since the last build. */
function compileStages(
  gl: WebGL2RenderingContext,
  camera: CameraT,
  effects: PostEffect[],
): CompiledStage[] {
  const cameraId = camera.id ?? -1;
  const previous = stageCache.get(cameraId) ?? [];
  const byName = new Map(previous.map((s) => [s.name, s]));

  const stages = effects.map((effect) => {
    const existing = byName.get(effect.name);
    if (existing && existing.source === effect.fragment) return existing;

    if (existing?.program) gl.deleteProgram(existing.program);

    const program = createShaderProgram(
      gl,
      postEffectVertexShader,
      ensureVersionDirective(effect.fragment),
    );
    if (!program) {
      // createShaderProgram already logged the compile/link error.
      console.error(
        `[camera] Camera '${camera.name}' post-effect '${effect.name}' failed to ` +
          'compile and will be skipped',
      );
      return {
        name: effect.name,
        program: null,
        source: effect.fragment,
        loc: {},
        userLoc: new Map<string, WebGLUniformLocation | null>(),
      };
    }

    const loc: Record<string, WebGLUniformLocation | null> = {};
    for (const name of CONTRACT_UNIFORMS) {
      loc[name] = gl.getUniformLocation(program, name);
    }

    const userLoc = new Map<string, WebGLUniformLocation | null>();
    for (const key of Object.keys(effect.uniforms)) {
      if (key.startsWith('u_')) {
        console.warn(
          `[camera] post-effect '${effect.name}' uniform '${key}' uses the ` +
            'reserved u_ prefix and is ignored; rename it',
        );
        continue;
      }
      userLoc.set(key, gl.getUniformLocation(program, key));
    }

    return {
      name: effect.name,
      program,
      source: effect.fragment,
      loc,
      userLoc,
    };
  });

  // Drop programs for stages that are no longer in the chain.
  for (const old of previous) {
    if (old.program && !stages.some((s) => s === old)) {
      gl.deleteProgram(old.program);
    }
  }

  stageCache.set(cameraId, stages);
  return stages;
}

/** Uploads one author-supplied uniform, dispatching on the value's shape. */
function uploadUserUniform(
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation | null,
  value: PostEffectUniformValue,
): void {
  if (location === null) return;
  if (typeof value === 'boolean') {
    gl.uniform1i(location, value ? 1 : 0);
  } else if (typeof value === 'number') {
    gl.uniform1f(location, value);
  } else if (value.length === 2) {
    gl.uniform2f(location, value[0], value[1]);
  } else if (value.length === 3) {
    gl.uniform3f(location, value[0], value[1], value[2]);
  } else if (value.length === 4) {
    gl.uniform4f(location, value[0], value[1], value[2], value[3]);
  } else {
    gl.uniform1fv(location, value);
  }
}

/**
 * Runs the camera's post-effect chain over the composited frame.
 *
 * Each stage reads the previous stage's colour (the composite, for stage 0)
 * plus the mask attachments, and writes into the other ping target. The masks
 * are bound once for the whole chain rather than per stage — they are inputs
 * throughout, never written.
 *
 * @returns the texture holding the final image, or null when no chain ran (in
 *   which case the caller presents the composite directly).
 */
export function renderPostChain(
  gl: WebGL2RenderingContext,
  camera: CameraT,
  cameraWorldPos: { x: number; y: number; z: number },
  cellSize: { x: number; y: number; z: number },
  subPixelOffset?: SubPixelOffset,
): WebGLTexture | null {
  frameCounter++;

  const effects = camera.postEffects;
  if (!effects || effects.length === 0) return null;

  const res = camera.glResources;
  if (!res.postChainFramebuffers[0] || !res.postChainFramebuffers[1]) {
    // Targets are allocated lazily; a chain added after init lands here for one
    // frame until allocateCameraTargets catches up.
    return null;
  }

  const compiled = compileStages(gl, camera, effects);
  const active = compiled.filter(
    (stage, i) => stage.program !== null && effects[i].enabled,
  );
  if (active.length === 0) return null;

  const width = res.fullResolution.width;
  const height = res.fullResolution.height;
  const bridge = computeFboUvBridge(camera, subPixelOffset);
  const timeSeconds =
    ((typeof performance !== 'undefined' ? performance.now() : Date.now()) -
      startTime) /
    1000;

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.viewport(0, 0, width, height);
  gl.bindBuffer(gl.ARRAY_BUFFER, res.fullscreenQuadBuffer);

  // Masks are constant across the chain — bind once.
  gl.activeTexture(gl.TEXTURE0 + UNIT_IDS);
  gl.bindTexture(gl.TEXTURE_2D, res.compositeIdTexture);
  gl.activeTexture(gl.TEXTURE0 + UNIT_AUX);
  gl.bindTexture(gl.TEXTURE_2D, res.compositeAuxTexture);
  gl.activeTexture(gl.TEXTURE0 + UNIT_DEPTH);
  gl.bindTexture(gl.TEXTURE_2D, res.depthTexture);

  let source = res.compositeTexture;
  let target = 0;

  for (let i = 0; i < active.length; i++) {
    const stage = active[i];
    const effect = effects.find((e) => e.name === stage.name);
    const program = stage.program;
    if (!program || !effect) continue;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.postChainFramebuffers[target]);
    gl.useProgram(program);

    gl.activeTexture(gl.TEXTURE0 + UNIT_COLOR);
    gl.bindTexture(gl.TEXTURE_2D, source);

    const l = stage.loc;
    gl.uniform1i(l.u_color, UNIT_COLOR);
    gl.uniform1i(l.u_ids, UNIT_IDS);
    gl.uniform1i(l.u_aux, UNIT_AUX);
    gl.uniform1i(l.u_depth, UNIT_DEPTH);
    gl.uniform2f(l.u_depthUvScale, bridge.scaleX, bridge.scaleY);
    gl.uniform2f(l.u_depthUvOffset, bridge.offsetX, bridge.offsetY);
    gl.uniform2f(l.u_resolution, width, height);
    gl.uniform2f(l.u_texelSize, 1 / width, 1 / height);
    gl.uniform1f(l.u_time, timeSeconds);
    gl.uniform1i(l.u_frame, frameCounter);
    gl.uniform1i(l.u_stageIndex, i);
    gl.uniform1f(l.u_orbitYaw, camera.orbitYaw);
    gl.uniform1f(l.u_axonometricAngle, camera.axonometricAngle);
    gl.uniform1f(l.u_zoom, camera.zoom);
    gl.uniform1f(l.u_pixelScale, camera.pixelScale);
    gl.uniform3f(
      l.u_cameraWorldPos,
      cameraWorldPos.x,
      cameraWorldPos.y,
      cameraWorldPos.z,
    );
    gl.uniform3f(l.u_cellSize, cellSize.x, cellSize.y, cellSize.z);

    for (const [key, location] of stage.userLoc) {
      const value = effect.uniforms[key];
      if (value !== undefined) uploadUserUniform(gl, location, value);
    }

    const aPosition = gl.getAttribLocation(program, 'a_position');
    const aUV = gl.getAttribLocation(program, 'a_uv');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    source = res.postChainTextures[target];
    target = target === 0 ? 1 : 0;
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Leave no chain texture resident: several of these are attachments of
  // framebuffers the next frame binds, and a texture that is both a sampler
  // binding and an attachment makes WebGL silently fail every draw call.
  for (const unit of [UNIT_COLOR, UNIT_IDS, UNIT_AUX, UNIT_DEPTH]) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  gl.activeTexture(gl.TEXTURE0);

  return source;
}

/** Deletes this camera's compiled stage programs. Called from dispose. */
export function clearPostChainCache(
  gl: WebGL2RenderingContext | null,
  cameraId: number,
): void {
  const stages = stageCache.get(cameraId);
  if (stages && gl) {
    for (const stage of stages) {
      if (stage.program) gl.deleteProgram(stage.program);
    }
  }
  stageCache.delete(cameraId);
}
