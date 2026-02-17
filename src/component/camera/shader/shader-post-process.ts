export const postProcessVertexShader = `
    attribute vec2 a_position;
    attribute vec2 a_uv;
    varying vec2 v_uv;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_uv = a_uv;
    }
  `;

export const postProcessFragmentShader = `
    precision mediump float;
    uniform sampler2D u_renderTexture;
    varying vec2 v_uv;

    void main() {
      // Sample with NEAREST filtering for pixel-perfect look
      gl_FragColor = texture2D(u_renderTexture, v_uv);
    }
  `;
