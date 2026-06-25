precision mediump float;

    // Render mode selector
uniform lowp int u_renderMode;  // 0 = cells, 1 = sprites

    // Shared uniforms
uniform sampler2D u_albedoTexture;
uniform sampler2D u_normalTexture;
uniform vec4 u_uvBounds;
uniform bool u_hasNormal;

    // Cell-specific uniforms (Mode 0)
uniform highp vec3 u_cellSize;
uniform highp vec3 u_mapSize;
uniform vec4 u_normalUVBounds;

    // Per-side (per-triplanar-plane) frames for cells (Mode 0).
    // Plane <-> visible side:  YZ = +X (south-east),  XZ = +Y (up),  XY = +Z (south-west)
uniform vec4 u_albedoBoundsYZ;
uniform vec4 u_albedoBoundsXZ;
uniform vec4 u_albedoBoundsXY;
uniform vec2 u_albedoSizeYZ;
uniform vec2 u_albedoSizeXZ;
uniform vec2 u_albedoSizeXY;
uniform vec4 u_normalBoundsYZ;
uniform vec4 u_normalBoundsXZ;
uniform vec4 u_normalBoundsXY;
uniform vec2 u_normalSizeYZ;
uniform vec2 u_normalSizeXZ;
uniform vec2 u_normalSizeXY;

    // Optional per-vertex UV mode (custom shapes): sample the base frame by v_uv
    // instead of triplanar. u_useMeshUV is set per draw range.
uniform bool u_useMeshUV;
uniform vec4 u_albedoBoundsBase;
uniform vec4 u_normalBoundsBase;

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

    // Silhouette uniforms (sprite mode — renders flat color when occluded)
uniform bool u_showSilhouette;
uniform vec4 u_silhouetteColor;

    // Per-fragment line-of-sight raycasting (both modes)
uniform bool u_hasVisibilityMask;
uniform sampler2D u_cellSolidity;   // R8: 0=empty, 255=solid
uniform highp vec3 u_revealTarget;  // World-space reveal target position

    // Depth cues (cell mode; each weight 0 = off, early-out → free)
uniform float u_aoWeight;
uniform float u_aoRadius;
uniform float u_aoScatter;
uniform float u_shadowWeight;
uniform float u_shadowDistance;
uniform float u_shadowScatter;
    // Edge-softening style shared by AO + shadow scatter.
    // 0 = dither (white noise), 1 = soft-grain (value noise), 2 = smooth-fade (blur),
    // 3 = retro-dither (ordered Bayer).
uniform int u_scatterType;
uniform float u_heightRampWeight;
uniform float u_heightRampMinY;
uniform float u_heightRampMaxY;
uniform vec3 u_heightRampLow;
uniform vec3 u_heightRampHigh;

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

    // Axonometric angle uniform
uniform float u_axonometricAngle;

    // Varying inputs (shared)
varying vec2 v_uv;
varying vec3 v_normal;
varying vec3 v_worldPos;
varying vec2 v_screenPos;
varying vec3 v_worldNormal;
varying vec3 v_origWorldPos;

// Transform world direction to isometric screen space
// Same projection matrix as the vertex shader
vec3 worldDirToIso(vec3 d) {
    const float ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread
    float sinA = sin(radians(u_axonometricAngle));
    return normalize(vec3(
        d.x * ISO_H - d.z * ISO_H,
        d.x * sinA - d.y + d.z * sinA,
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

// Check if a cell at integer coordinates is solid by sampling the solidity texture.
// Out-of-bounds cells are empty — without this, CLAMP_TO_EDGE would fold the lookup
// back onto a real edge cell and report false occlusion (e.g. AO at the map border).
bool isCellSolid(vec3 cell) {
    if(cell.x < 0.0 || cell.x >= u_mapSize.x ||
       cell.y < 0.0 || cell.y >= u_mapSize.y ||
       cell.z < 0.0 || cell.z >= u_mapSize.z) {
        return false;
    }
    float u = (cell.x + 0.5) / u_mapSize.x;
    float v = (cell.y + cell.z * u_mapSize.y + 0.5)
              / (u_mapSize.y * u_mapSize.z);
    return texture2D(u_cellSolidity, vec2(u, v)).r > 0.5;
}

// 3D DDA ray march using continuous cell-space positions (Amanatides & Woo).
// Each fragment traces its own ray from origin to dest, producing per-pixel
// clipping boundaries instead of snapping to cell edges.
const int MAX_RAY_STEPS = 96;
bool isRayBlocked(vec3 origin, vec3 dest) {
    vec3 startCell = floor(origin);
    vec3 endCell = floor(dest);

    // Same cell — trivially not blocked
    if(startCell == endCell) return false;

    vec3 dir = dest - origin;
    vec3 s = sign(dir);

    // t increment per full cell crossing
    float tDeltaX = dir.x != 0.0 ? abs(1.0 / dir.x) : 1e10;
    float tDeltaY = dir.y != 0.0 ? abs(1.0 / dir.y) : 1e10;
    float tDeltaZ = dir.z != 0.0 ? abs(1.0 / dir.z) : 1e10;

    // t to reach the first cell boundary from the continuous origin
    float tMaxX = dir.x > 0.0 ? (startCell.x + 1.0 - origin.x) * tDeltaX
                 : dir.x < 0.0 ? (origin.x - startCell.x) * tDeltaX
                 : 1e10;
    float tMaxY = dir.y > 0.0 ? (startCell.y + 1.0 - origin.y) * tDeltaY
                 : dir.y < 0.0 ? (origin.y - startCell.y) * tDeltaY
                 : 1e10;
    float tMaxZ = dir.z > 0.0 ? (startCell.z + 1.0 - origin.z) * tDeltaZ
                 : dir.z < 0.0 ? (origin.z - startCell.z) * tDeltaZ
                 : 1e10;

    vec3 pos = startCell;

    for(int i = 0; i < MAX_RAY_STEPS; i++) {
        // Advance along axis with smallest tMax
        if(tMaxX <= tMaxY && tMaxX <= tMaxZ) {
            pos.x += s.x; tMaxX += tDeltaX;
        } else if(tMaxY <= tMaxZ) {
            pos.y += s.y; tMaxY += tDeltaY;
        } else {
            pos.z += s.z; tMaxZ += tDeltaZ;
        }

        // Reached destination cell — not blocked
        if(pos == endCell) return false;

        // Out of bounds — not blocked
        if(pos.x < 0.0 || pos.x >= u_mapSize.x ||
           pos.y < 0.0 || pos.y >= u_mapSize.y ||
           pos.z < 0.0 || pos.z >= u_mapSize.z) return false;

        // Intermediate solid cell — blocked
        if(isCellSolid(pos)) return true;
    }
    return false;
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

// ── Scatter helpers (shared by AO + cast shadow so they match) ──────────────────────
// Cheap mediump-friendly per-fragment hash in [0,1) (no sin / large constants).
float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

// 2D value noise in [0,1): smoothstep-interpolated hash on the integer grid → smooth,
// low-frequency grain (vs the high-frequency white noise of hash21).
float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Ordered 4x4 Bayer threshold in [0,1) (recursive 2x2 build; no arrays/bitops).
float bayer2(vec2 c) { return 2.0 * c.x + 3.0 * c.y - 4.0 * c.x * c.y; } // c in {0,1}^2 → 0..3
float bayer4(vec2 frag) {
    vec2 p = floor(frag);
    vec2 hi = mod(floor(p * 0.5), 2.0);
    vec2 lo = mod(p, 2.0);
    return (4.0 * bayer2(hi) + bayer2(lo) + 0.5) / 16.0;
}

// Per-fragment sample offset in [-0.5,0.5]^2 for the noisy scatter modes (NOT
// smooth-fade, which blurs a fixed kernel instead). 1 = soft-grain (smooth, world-
// stable), 3 = retro-dither (ordered, screen-space), else 0 = dither (white noise).
vec2 scatterOffset(vec2 worldSeed) {
    if(u_scatterType == 1) {
        vec2 s = worldSeed * 0.6;
        return vec2(vnoise(s), vnoise(s + 19.7)) - 0.5;
    } else if(u_scatterType == 3) {
        return vec2(bayer4(gl_FragCoord.xy), bayer4(gl_FragCoord.xy + vec2(2.0, 1.0))) - 0.5;
    }
    return vec2(hash21(worldSeed), hash21(worldSeed + 7.31)) - 0.5;
}

// ── Ambient occlusion ───────────────────────────────────────────────────────────────
// Darken a fragment only by neighbors that rise ABOVE its surface (cliff bases / inner
// corners). Same-level neighbors are the coplanar surface itself, so flat open tops
// stay unoccluded. `off` jitters which cell is sampled (cell-space, horizontal).
// worldPos is pre-smoothing (v_origWorldPos) so floor() lands in the right cell.
float aoSample(vec3 worldPos, vec2 off) {
    vec3 cell = floor(worldPos / u_cellSize + vec3(off.x, 0.0, off.y));
    int rings = u_aoRadius >= 1.5 ? 2 : 1;
    float occ = 0.0;
    float total = 0.0;
    for(int ring = 1; ring <= 2; ring++) {
        if(ring > rings) break;
        float rw = 1.0 / float(ring); // nearer rings weigh more
        for(int dx = -1; dx <= 1; dx++) {
            for(int dz = -1; dz <= 1; dz++) {
                if(dx == 0 && dz == 0) continue;
                vec3 o = vec3(float(dx * ring), 0.0, float(dz * ring));
                total += rw * 1.5;
                if(isCellSolid(cell + o + vec3(0.0, 1.0, 0.0))) occ += rw * 1.0;
                if(isCellSolid(cell + o + vec3(0.0, 2.0, 0.0))) occ += rw * 0.5;
            }
        }
    }
    return total > 0.0 ? occ / total : 0.0;
}

// smooth-fade AO: a genuine continuous gradient (not per-cell). Occlusion fades with
// the fragment's real horizontal DISTANCE to each taller neighbor, so the halo is a
// smooth radial falloff with no cell blockiness and no grain. `scatter` widens the
// falloff radius (broader, softer halo).
float aoSmooth(vec3 worldPos) {
    vec3 cp = worldPos / u_cellSize;
    vec3 base = floor(cp);
    vec2 fragXZ = cp.xz;
    float radius = 1.4 + u_aoScatter * 2.0; // cells
    float occ = 0.0;
    for(int dx = -3; dx <= 3; dx++) {
        for(int dz = -3; dz <= 3; dz++) {
            if(dx == 0 && dz == 0) continue;
            float dist = distance(fragXZ, vec2(base.x + float(dx) + 0.5, base.z + float(dz) + 0.5));
            if(dist >= radius) continue;
            // Taller neighbor one (strong) or two (soft) cells above this fragment.
            float solid = 0.0;
            if(isCellSolid(base + vec3(float(dx), 1.0, float(dz)))) solid = 1.0;
            else if(isCellSolid(base + vec3(float(dx), 2.0, float(dz)))) solid = 0.5;
            if(solid <= 0.0) continue;
            float w = 1.0 - dist / radius;
            occ += solid * w * w; // quadratic distance falloff
        }
    }
    return clamp(occ * 0.7, 0.0, 1.0);
}

float computeAO(vec3 worldPos) {
    if(u_aoScatter <= 0.0) return aoSample(worldPos, vec2(0.0));
    if(u_scatterType == 2) return aoSmooth(worldPos); // continuous distance gradient
    vec2 seed = worldPos.xz / u_cellSize.xz;
    return aoSample(worldPos, scatterOffset(seed) * u_aoScatter);
}

// ── Directional cast shadow ─────────────────────────────────────────────────────────
// March the solidity grid from the fragment toward the first directional light (reuses
// the DDA). `off` jitters the ray origin (cell-space, horizontal). 1 = blocked, 0 = lit.
float shadowSample(vec3 worldPos, vec3 worldNormal, vec2 off) {
    vec3 origin = worldPos / u_cellSize + worldNormal * 0.05 + vec3(off.x, 0.0, off.y);
    vec3 toLight = normalize((-u_dirLightDir[0]) / u_cellSize);
    vec3 dest = origin + toLight * u_shadowDistance;
    return isRayBlocked(origin, dest) ? 1.0 : 0.0;
}

float computeCastShadow(vec3 worldPos, vec3 worldNormal) {
    if(u_numDirLights == 0) return 0.0;
    if(u_shadowScatter <= 0.0) return shadowSample(worldPos, worldNormal, vec2(0.0));
    if(u_scatterType == 2) {
        // smooth-fade: average a FILLED disk of rays (golden-angle sunflower). Filling
        // the disk (not just its rim) makes coverage change gradually across the
        // penumbra → a smooth, continuous soft edge (matching the AO gradient) instead
        // of banding. Heavier (N marches) — this is the quality mode.
        float s = u_shadowScatter * 1.5; // penumbra half-width in cells
        float sum = 0.0;
        for(int i = 0; i < 16; i++) {
            float fi = float(i) + 0.5;
            float a = fi * 2.39996323;                 // golden angle
            vec2 off = vec2(cos(a), sin(a)) * sqrt(fi / 16.0) * s;
            sum += shadowSample(worldPos, worldNormal, off);
        }
        return sum / 16.0;
    }
    vec2 seed = worldPos.xz / u_cellSize.xz;
    return shadowSample(worldPos, worldNormal, scatterOffset(seed) * u_shadowScatter);
}

void main() {
    if(u_renderMode == 0) {
        // ============================================================
        // MODE 0: CELL RENDERING (Triplanar world-space texture mapping)
        // ============================================================

        // Per-fragment line-of-sight raycasting (early discard skips expensive texture/lighting work)
        // Uses pre-smoothing positions so floor() resolves consistently across each face
        if(u_hasVisibilityMask) {
            vec3 fragPos = v_origWorldPos / u_cellSize;
            vec3 targetPos = u_revealTarget / u_cellSize;

            // Different cell from target — ray march to check visibility
            if(floor(fragPos) != floor(targetPos)) {
                if(isRayBlocked(targetPos, fragPos)) discard;

                // Cull exterior faces of solid cells viewed from inside:
                // If the fragment is in a solid cell and its face normal points
                // in the same direction as the ray (away from target), the face
                // is on the far side of the wall — discard it.
                if(isCellSolid(floor(fragPos))) {
                    vec3 rayDir = fragPos - targetPos;
                    if(dot(rayDir, v_worldNormal) > 0.0) discard;
                }
            }
        }

        vec4 albedo;
        vec3 finalNormal;

        if(u_useMeshUV) {
            // Per-vertex UV mode (custom shapes): sample by the mesh's own UVs, but
            // pick the per-side frame by the dominant axis of the world normal so an
            // asymmetric tile (e.g. grass-cap: grass top / dirt sides) maps crisply
            // per face. Per-side bounds default to the base frame when a material has
            // no `sides`, so back-compat is preserved (all faces show the base frame).
            vec3 an = abs(v_worldNormal);
            vec4 ab, nb;
            if(an.x >= an.y && an.x >= an.z) { ab = u_albedoBoundsYZ; nb = u_normalBoundsYZ; } // +X side
            else if(an.y >= an.z)            { ab = u_albedoBoundsXZ; nb = u_normalBoundsXZ; } // +Y up
            else                             { ab = u_albedoBoundsXY; nb = u_normalBoundsXY; } // +Z side
            albedo = texture2D(u_albedoTexture, mix(ab.xy, ab.zw, v_uv));
            if(u_hasNormal) {
                vec2 nUV = mix(nb.xy, nb.zw, v_uv);
                vec3 normalMap = texture2D(u_normalTexture, nUV).rgb * 2.0 - 1.0;
                finalNormal = normalize(v_normal + normalMap * 0.5);
            } else {
                finalNormal = normalize(v_normal);
            }
        } else {
            // Triplanar world-space mapping (default for cubes + non-UV shapes).
            vec3 blendWeights = abs(normalize(v_worldNormal));
            blendWeights = blendWeights / (blendWeights.x + blendWeights.y + blendWeights.z);

            // Triplanar albedo sampling with bilinear interpolation to prevent shimmer.
            // Each plane uses its own per-side frame (bounds + size).
            // The two vertical planes (YZ, XY) use world-Y as their V coordinate.
            // World-Y runs bottom->up but the atlas V runs top->down (frame top =
            // smaller texture-v), so V is negated here to align image-up with
            // world-up (negation is exactly periodic in texSize.y, so tiling stays
            // seamless). The XZ top plane has no vertical axis and is left as-is.
            vec4 albedoYZ = sampleBilinear(u_albedoTexture, vec2(v_worldPos.z, -v_worldPos.y), u_albedoSizeYZ, u_albedoBoundsYZ);
            vec4 albedoXZ = sampleBilinear(u_albedoTexture, vec2(v_worldPos.x, v_worldPos.z), u_albedoSizeXZ, u_albedoBoundsXZ);
            vec4 albedoXY = sampleBilinear(u_albedoTexture, vec2(v_worldPos.x, -v_worldPos.y), u_albedoSizeXY, u_albedoBoundsXY);

            // Floor-based UVs for normal maps (shimmer-insensitive, saves texture lookups).
            // Same world-Y V negation as the albedo planes, so normals stay aligned.
            vec2 normalizedUV_YZ = (mod(floor(vec2(v_worldPos.z, -v_worldPos.y)), u_normalSizeYZ) + 0.5) / u_normalSizeYZ;
            vec2 normalizedUV_XZ = (mod(floor(vec2(v_worldPos.x, v_worldPos.z)), u_normalSizeXZ) + 0.5) / u_normalSizeXZ;
            vec2 normalizedUV_XY = (mod(floor(vec2(v_worldPos.x, -v_worldPos.y)), u_normalSizeXY) + 0.5) / u_normalSizeXY;

            // Blend the three albedo samples using normal weights
            albedo = albedoYZ * blendWeights.x + albedoXZ * blendWeights.y + albedoXY * blendWeights.z;

            // Triplanar normal mapping (if available)
            if(u_hasNormal) {
                vec2 normalAtlasUV_YZ = mix(u_normalBoundsYZ.xy, u_normalBoundsYZ.zw, normalizedUV_YZ);
                vec2 normalAtlasUV_XZ = mix(u_normalBoundsXZ.xy, u_normalBoundsXZ.zw, normalizedUV_XZ);
                vec2 normalAtlasUV_XY = mix(u_normalBoundsXY.xy, u_normalBoundsXY.zw, normalizedUV_XY);

                vec3 normalMapYZ = texture2D(u_normalTexture, normalAtlasUV_YZ).rgb;
                vec3 normalMapXZ = texture2D(u_normalTexture, normalAtlasUV_XZ).rgb;
                vec3 normalMapXY = texture2D(u_normalTexture, normalAtlasUV_XY).rgb;

                vec3 normalMap = normalMapYZ * blendWeights.x + normalMapXZ * blendWeights.y + normalMapXY * blendWeights.z;
                normalMap = normalMap * 2.0 - 1.0;
                finalNormal = normalize(v_normal + normalMap * 0.5);
            } else {
                finalNormal = normalize(v_normal);
            }
        }

        // Dynamic lighting
        vec3 lighting = computeLighting(finalNormal, v_worldPos);

        // Depth cues (cell mode): AO + cast shadow darken lighting; the height ramp
        // tints albedo. Each is weight-gated, so disabled cues cost nothing.
        if(u_aoWeight > 0.0) {
            lighting *= 1.0 - u_aoWeight * computeAO(v_origWorldPos);
        }
        if(u_shadowWeight > 0.0) {
            lighting *= 1.0 - u_shadowWeight * computeCastShadow(v_origWorldPos, v_worldNormal);
        }
        if(u_heightRampWeight > 0.0) {
            float t = clamp((v_worldPos.y - u_heightRampMinY)
                / max(0.0001, u_heightRampMaxY - u_heightRampMinY), 0.0, 1.0);
            albedo.rgb *= mix(vec3(1.0), mix(u_heightRampLow, u_heightRampHigh, t), u_heightRampWeight);
        }

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

        // Per-fragment line-of-sight raycasting (hide sprites in non-visible cells)
        if(u_hasVisibilityMask) {
            vec3 fragPos = v_origWorldPos / u_cellSize;
            vec3 targetPos = u_revealTarget / u_cellSize;

            if(floor(fragPos) != floor(targetPos)) {
                if(isRayBlocked(targetPos, fragPos)) discard;
            }
        }

        // Occlusion test: discard sprite fragments behind cells (or show silhouette)
        vec2 screenUV = gl_FragCoord.xy / u_screenSize;
        vec2 fboUV = screenUV * u_fboUvScale + u_fboUvOffset;
        float cellDepth = texture2D(u_depthTexture, fboUV).r;
        if(cellDepth < gl_FragCoord.z) {
            if(u_showSilhouette) {
                gl_FragColor = u_silhouetteColor;
                return;
            }
            discard;
        }

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
