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

    // Dynamic lighting uniforms
uniform vec3 u_ambientColor;
uniform float u_ambientBrightness;

const int MAX_DIR_LIGHTS = 4;
uniform int u_numDirLights;
uniform vec3 u_dirLightDir[MAX_DIR_LIGHTS];
uniform vec3 u_dirLightColor[MAX_DIR_LIGHTS];
uniform float u_dirLightBrightness[MAX_DIR_LIGHTS];

const int MAX_POINT_LIGHTS = 8;
uniform int u_numPointLights;
uniform vec3 u_pointLightPos[MAX_POINT_LIGHTS];
uniform vec3 u_pointLightColor[MAX_POINT_LIGHTS];
uniform float u_pointLightBrightness[MAX_POINT_LIGHTS];
uniform float u_pointLightRadius[MAX_POINT_LIGHTS];
uniform float u_pointLightHardness[MAX_POINT_LIGHTS];

const int MAX_SPOT_LIGHTS = 8;
uniform int u_numSpotLights;
uniform vec3 u_spotLightPos[MAX_SPOT_LIGHTS];
uniform vec3 u_spotLightColor[MAX_SPOT_LIGHTS];
uniform float u_spotLightBrightness[MAX_SPOT_LIGHTS];
uniform float u_spotLightRadius[MAX_SPOT_LIGHTS];
uniform float u_spotLightHardness[MAX_SPOT_LIGHTS];

    // Varying inputs (shared)
varying vec2 v_uv;
varying vec3 v_normal;
varying vec3 v_worldPos;
varying vec2 v_screenPos;
varying vec3 v_worldNormal;

// Transform world direction to isometric screen space
// Same projection matrix as the vertex shader
vec3 worldDirToIso(vec3 d) {
    return normalize(vec3(
        d.x * 0.866 - d.z * 0.866,
        d.x * 0.5 - d.y + d.z * 0.5,
        0.0
    ));
}

// Distance attenuation with hardness control
float attenuate(float dist, float radius, float hardness) {
    float inner = radius * hardness;
    return 1.0 - smoothstep(inner, radius, dist);
}

// Compute lighting from all dynamic light sources
vec3 computeLighting(vec3 normal, vec3 worldPos) {
    // Ambient
    vec3 lighting = u_ambientColor * u_ambientBrightness;

    // Directional lights (normal-dependent diffuse)
    for (int i = 0; i < MAX_DIR_LIGHTS; i++) {
        if (i >= u_numDirLights) break;
        vec3 isoDir = worldDirToIso(-u_dirLightDir[i]);
        float diff = max(dot(normal, isoDir), 0.0);
        lighting += u_dirLightColor[i] * u_dirLightBrightness[i] * diff;
    }

    // Point lights (normal-dependent diffuse + distance attenuation)
    for (int i = 0; i < MAX_POINT_LIGHTS; i++) {
        if (i >= u_numPointLights) break;
        vec3 toLight = u_pointLightPos[i] - worldPos;
        float dist = length(toLight);
        if (dist >= u_pointLightRadius[i]) continue;
        float atten = attenuate(dist, u_pointLightRadius[i], u_pointLightHardness[i]);
        vec3 isoDir = worldDirToIso(normalize(toLight));
        float diff = max(dot(normal, isoDir), 0.0);
        lighting += u_pointLightColor[i] * u_pointLightBrightness[i] * diff * atten;
    }

    // Spot lights (ambient within sphere — no normal dependency, just distance)
    for (int i = 0; i < MAX_SPOT_LIGHTS; i++) {
        if (i >= u_numSpotLights) break;
        float dist = length(u_spotLightPos[i] - worldPos);
        if (dist >= u_spotLightRadius[i]) continue;
        float atten = attenuate(dist, u_spotLightRadius[i], u_spotLightHardness[i]);
        lighting += u_spotLightColor[i] * u_spotLightBrightness[i] * atten;
    }

    return lighting;
}

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

        // Dynamic lighting
        vec3 lighting = computeLighting(finalNormal, v_worldPos);

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

        // Dynamic lighting
        vec3 lighting = computeLighting(finalNormal, v_worldPos);

        // Apply lighting and tint
        vec4 tinted = albedo * u_tint * vec4(lighting, 1.0);

        // Apply opacity to final alpha channel
        gl_FragColor = vec4(tinted.rgb, tinted.a * u_opacity);
    }
}
