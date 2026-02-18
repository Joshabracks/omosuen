precision mediump float;

    // Render mode selector
uniform lowp int u_renderMode;  // 0 = cells, 1 = sprites

    // Shared uniforms
uniform sampler2D u_albedoTexture;
uniform sampler2D u_normalTexture;
uniform vec4 u_uvBounds;
uniform bool u_hasNormal;

    // Cell-specific uniforms (Mode 0)
uniform vec4 u_normalUVBounds;
uniform vec2 u_textureSize;

    // Sprite-specific uniforms (Mode 1)
uniform sampler2D u_materialTexture;
uniform sampler2D u_emissionTexture;
uniform bool u_hasMaterial;
uniform bool u_hasEmission;
uniform vec4 u_tint;
uniform float u_opacity;

    // Occlusion mask uniforms (sprite mode — samples cell FBO depth texture)
uniform sampler2D u_depthTexture;
uniform vec2 u_fboUvScale;
uniform vec2 u_fboUvOffset;
uniform vec2 u_screenSize;

    // Varying inputs (shared)
varying vec2 v_uv;
varying vec3 v_normal;
varying vec3 v_worldPos;
varying vec2 v_screenPos;
varying vec3 v_worldNormal;

// Manual bilinear interpolation for atlas-safe texel blending.
// Prevents shimmer by smoothly transitioning between neighboring texels
// instead of hard floor() snapping.
vec4 sampleBilinear(sampler2D tex, vec2 worldCoord, vec2 texSize, vec4 bounds) {
    vec2 f = fract(worldCoord);
    vec2 base = floor(worldCoord);

    // 4 neighboring texel centers
    vec2 uv00 = (mod(base,                  texSize) + 0.5) / texSize;
    vec2 uv10 = (mod(base + vec2(1.0, 0.0), texSize) + 0.5) / texSize;
    vec2 uv01 = (mod(base + vec2(0.0, 1.0), texSize) + 0.5) / texSize;
    vec2 uv11 = (mod(base + vec2(1.0, 1.0), texSize) + 0.5) / texSize;

    // Map to atlas bounds
    vec4 s00 = texture2D(tex, mix(bounds.xy, bounds.zw, uv00));
    vec4 s10 = texture2D(tex, mix(bounds.xy, bounds.zw, uv10));
    vec4 s01 = texture2D(tex, mix(bounds.xy, bounds.zw, uv01));
    vec4 s11 = texture2D(tex, mix(bounds.xy, bounds.zw, uv11));

    // Bilinear blend
    return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}

void main() {
    if(u_renderMode == 0) {
        // ============================================================
        // MODE 0: CELL RENDERING (Triplanar world-space texture mapping)
        // ============================================================

        // Calculate blend weights from world-space normal
        vec3 blendWeights = abs(normalize(v_worldNormal));
        blendWeights = blendWeights / (blendWeights.x + blendWeights.y + blendWeights.z);

        // Triplanar albedo sampling with bilinear interpolation to prevent shimmer
        vec4 albedoYZ = sampleBilinear(u_albedoTexture, vec2(v_worldPos.z, v_worldPos.y), u_textureSize, u_uvBounds);
        vec4 albedoXZ = sampleBilinear(u_albedoTexture, vec2(v_worldPos.x, v_worldPos.z), u_textureSize, u_uvBounds);
        vec4 albedoXY = sampleBilinear(u_albedoTexture, vec2(v_worldPos.x, v_worldPos.y), u_textureSize, u_uvBounds);

        // Floor-based UVs for normal maps (shimmer-insensitive, saves texture lookups)
        vec2 normalizedUV_YZ = (mod(floor(vec2(v_worldPos.z, v_worldPos.y)), u_textureSize) + 0.5) / u_textureSize;
        vec2 normalizedUV_XZ = (mod(floor(vec2(v_worldPos.x, v_worldPos.z)), u_textureSize) + 0.5) / u_textureSize;
        vec2 normalizedUV_XY = (mod(floor(vec2(v_worldPos.x, v_worldPos.y)), u_textureSize) + 0.5) / u_textureSize;

        // Blend the three albedo samples using normal weights
        vec4 albedo = albedoYZ * blendWeights.x + albedoXZ * blendWeights.y + albedoXY * blendWeights.z;

        // Triplanar normal mapping (if available)
        vec3 finalNormal;
        if(u_hasNormal) {
            vec2 normalAtlasUV_YZ = mix(u_normalUVBounds.xy, u_normalUVBounds.zw, normalizedUV_YZ);
            vec2 normalAtlasUV_XZ = mix(u_normalUVBounds.xy, u_normalUVBounds.zw, normalizedUV_XZ);
            vec2 normalAtlasUV_XY = mix(u_normalUVBounds.xy, u_normalUVBounds.zw, normalizedUV_XY);

            vec3 normalMapYZ = texture2D(u_normalTexture, normalAtlasUV_YZ).rgb;
            vec3 normalMapXZ = texture2D(u_normalTexture, normalAtlasUV_XZ).rgb;
            vec3 normalMapXY = texture2D(u_normalTexture, normalAtlasUV_XY).rgb;

            vec3 normalMap = normalMapYZ * blendWeights.x + normalMapXZ * blendWeights.y + normalMapXY * blendWeights.z;
            normalMap = normalMap * 2.0 - 1.0;
            finalNormal = normalize(v_normal + normalMap * 0.5);
        } else {
            finalNormal = normalize(v_normal);
        }

        // Directional light in screen space
        vec3 lightDir = normalize(vec3(0.5, -0.7, 0.0));
        float diffuse = max(dot(finalNormal, lightDir), 0.0);
        float ambient = 0.4;
        float lighting = ambient + diffuse * 0.6;

        gl_FragColor = vec4(albedo.rgb * lighting, albedo.a);

    } else {
        // ============================================================
        // MODE 1: SPRITE RENDERING (Atlas sampling with normal mapping and lighting)
        // ============================================================

        // Sample UV within atlas bounds
        vec2 atlasUV = mix(u_uvBounds.xy, u_uvBounds.zw, v_uv);

        // Albedo (always required)
        vec4 albedo = texture2D(u_albedoTexture, atlasUV);

        // Discard fully transparent pixels early
        if(albedo.a < 0.01)
            discard;

        // Occlusion test: discard sprite fragments behind cells
        vec2 screenUV = gl_FragCoord.xy / u_screenSize;
        vec2 fboUV = screenUV * u_fboUvScale + u_fboUvOffset;
        float cellDepth = texture2D(u_depthTexture, fboUV).r;
        if(cellDepth < gl_FragCoord.z)
            discard;

        // Normal mapping for sprites (if available)
        vec3 finalNormal;
        if(u_hasNormal) {
          // Sample normal map from same UV coords as albedo
            vec2 normalAtlasUV = mix(u_normalUVBounds.xy, u_normalUVBounds.zw, v_uv);
            vec3 normalMap = texture2D(u_normalTexture, normalAtlasUV).rgb;

          // Convert from [0,1] range to [-1,1] range
            normalMap = normalMap * 2.0 - 1.0;

          // Perturb the base normal (billboard facing camera)
            finalNormal = normalize(v_normal + normalMap * 0.5);
        } else {
            finalNormal = v_normal;
        }

        // Directional light in screen space (same as cell-maps for consistency)
        vec3 lightDir = normalize(vec3(0.5, -0.7, 0.0));
        float diffuse = max(dot(finalNormal, lightDir), 0.0);
        float ambient = 0.4;
        float lighting = ambient + diffuse * 0.6;

        // Apply lighting and tint
        vec4 tinted = albedo * u_tint * vec4(vec3(lighting), 1.0);

        // Apply opacity to final alpha channel
        gl_FragColor = vec4(tinted.rgb, tinted.a * u_opacity);
    }
}