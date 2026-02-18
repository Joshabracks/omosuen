precision mediump float;
uniform sampler2D u_renderTexture;
uniform vec2 u_uvScale;
uniform vec2 u_uvOffset;
varying vec2 v_uv;

void main() {
    gl_FragColor = texture2D(u_renderTexture, v_uv * u_uvScale + u_uvOffset);
}