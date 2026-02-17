precision mediump float;
uniform sampler2D u_renderTexture;
varying vec2 v_uv;

void main() {
      // Sample with NEAREST filtering for pixel-perfect look
    gl_FragColor = texture2D(u_renderTexture, v_uv);
}