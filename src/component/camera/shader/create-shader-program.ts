/**
 * Creates and compiles a WebGL shader program from vertex and fragment shader source code.
 *
 * @param gl - WebGL2 rendering context
 * @param vertexSource - GLSL vertex shader source code
 * @param fragmentSource - GLSL fragment shader source code
 * @returns Compiled shader program, or null if compilation failed
 */
export function createShaderProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram | null {
  // Compile vertex shader
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  if (!vertexShader) {
    console.error('[camera] Failed to create vertex shader');
    return null;
  }

  gl.shaderSource(vertexShader, vertexSource);
  gl.compileShader(vertexShader);

  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    console.error(
      '[camera] Vertex shader compilation failed:',
      gl.getShaderInfoLog(vertexShader),
    );
    gl.deleteShader(vertexShader);
    return null;
  }

  // Compile fragment shader
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!fragmentShader) {
    console.error('[camera] Failed to create fragment shader');
    gl.deleteShader(vertexShader);
    return null;
  }

  gl.shaderSource(fragmentShader, fragmentSource);
  gl.compileShader(fragmentShader);

  if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
    console.error(
      '[camera] Fragment shader compilation failed:',
      gl.getShaderInfoLog(fragmentShader),
    );
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  // Link program
  const program = gl.createProgram();
  if (!program) {
    console.error('[camera] Failed to create shader program');
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(
      '[camera] Shader program linking failed:',
      gl.getProgramInfoLog(program),
    );
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.deleteProgram(program);
    return null;
  }

  // Shaders can be deleted after linking
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  return program;
}
