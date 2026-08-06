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
    // Size of the currently-resident cell grid (today: the whole map; once the
    // engine's shiftable hot window lands, the window's size — see
    // .design/completed_tasks/cell-map-overhaul/06-camera-reveal-fix.md). u_windowOrigin is the
    // world-cell-space corner that grid starts at (today always (0,0,0)).
uniform highp vec3 u_windowSize;
uniform highp vec3 u_windowOrigin;
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
    // Per-side emissive-texture frames for cells (Mode 0). Sampled like albedo and
    // scaled by per-cell v_emission; falls back to albedo when u_hasEmissionTexture
    // is false (reuses the u_emissionTexture sampler declared below).
uniform bool u_hasEmissionTexture;
uniform vec4 u_emissionBoundsYZ;
uniform vec4 u_emissionBoundsXZ;
uniform vec4 u_emissionBoundsXY;
uniform vec2 u_emissionSizeYZ;
uniform vec2 u_emissionSizeXZ;
uniform vec2 u_emissionSizeXY;
    // Per-cell emission (highlight) color: RGB texture keyed by cell coordinate
    // (Mode 0). Added flat, independent of v_emission. Default black = no-op.
uniform bool u_hasCellEmissionColor;
uniform sampler2D u_cellEmissionColor;

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
uniform vec4 u_emissionUVBounds;
uniform vec4 u_materialUVBounds;
uniform float u_emissionIntensity;
uniform vec3 u_emissionColor;
uniform highp vec3 u_cameraWorldPos;
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

const int MAX_POINT_LIGHTS = 64;
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
varying vec3 v_worldPos;
varying vec2 v_screenPos;
varying vec3 v_worldNormal;
varying vec3 v_origWorldPos;
varying float v_emission;

// Distance attenuation with hardness control
float attenuate(float dist, float radius, float hardness) {
    float inner = radius * hardness;
    return 1.0 - smoothstep(inner, radius, dist);
}

// Compute lighting from all dynamic light sources. `normal` must be a true
// world-space unit normal — the dot products below are genuine 3D Lambertian
// terms, so lighting is independent of camera orientation (orbit yaw/tilt)
// by construction, unlike the old iso-projected-space dot product this replaced.
vec3 computeLighting(vec3 normal, vec3 worldPos) {
    // Ambient
    vec3 lighting = u_ambientColor * u_ambientBrightness;

    // Directional lights (normal-dependent diffuse)
    for (int i = 0; i < MAX_DIR_LIGHTS; i++) {
        if (i >= u_numDirLights) break;
        float diff = max(dot(normal, normalize(-u_dirLightDir[i])), 0.0);
        lighting += u_dirLightColor[i] * u_dirLightBrightness[i] * diff;
    }

    // Point lights (normal-dependent diffuse + distance attenuation)
    for (int i = 0; i < MAX_POINT_LIGHTS; i++) {
        if (i >= u_numPointLights) break;
        vec3 toLight = u_pointLightPos[i] - worldPos;
        float dist = length(toLight);
        if (dist >= u_pointLightRadius[i]) continue;
        float atten = attenuate(dist, u_pointLightRadius[i], u_pointLightHardness[i]);
        float diff = max(dot(normal, normalize(toLight)), 0.0);
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

// Minimal Blinn-Phong specular for sprite material (metallic/roughness). Deliberately
// cheap — no Fresnel/GGX/energy normalization, just enough view-dependent glint to sell
// "metal vs cloth" at 2.5D scale. metallic gates presence (non-metal sprites are bit-for-
// bit unchanged from today); roughness only shapes highlight width.
vec3 computeSpecular(vec3 normal, vec3 worldPos, vec3 viewDir, float metallic, float roughness) {
    if(metallic <= 0.0) return vec3(0.0);
    float shininess = mix(4.0, 64.0, 1.0 - clamp(roughness, 0.0, 1.0));
    vec3 spec = vec3(0.0);

    for(int i = 0; i < MAX_DIR_LIGHTS; i++) {
        if(i >= u_numDirLights) break;
        vec3 lightDir = normalize(-u_dirLightDir[i]);
        vec3 halfDir = normalize(lightDir + viewDir);
        float specTerm = pow(max(dot(normal, halfDir), 0.0), shininess);
        spec += u_dirLightColor[i] * u_dirLightBrightness[i] * specTerm;
    }

    for(int i = 0; i < MAX_POINT_LIGHTS; i++) {
        if(i >= u_numPointLights) break;
        vec3 toLight = u_pointLightPos[i] - worldPos;
        float dist = length(toLight);
        if(dist >= u_pointLightRadius[i]) continue;
        float atten = attenuate(dist, u_pointLightRadius[i], u_pointLightHardness[i]);
        vec3 halfDir = normalize(normalize(toLight) + viewDir);
        float specTerm = pow(max(dot(normal, halfDir), 0.0), shininess);
        spec += u_pointLightColor[i] * u_pointLightBrightness[i] * specTerm * atten;
    }

    // Spot lights intentionally excluded — computeLighting treats them as pure ambient-
    // within-sphere (no normal dependency / no light direction), so there's no vector to
    // build a half-angle from.
    return spec * metallic;
}

// Check if a cell at integer coordinates is solid by sampling the solidity texture.
// Out-of-bounds cells are empty — without this, CLAMP_TO_EDGE would fold the lookup
// back onto a real edge cell and report false occlusion (e.g. AO at the map border).
bool isCellSolid(vec3 cell) {
    // `cell` is a world-cell coordinate; translate into the resident grid's
    // own local space before bounds-checking/sampling — a no-op today
    // (u_windowOrigin is always (0,0,0) until the shiftable hot window
    // lands), but this is the seam that makes it correct once it does.
    vec3 local = cell - u_windowOrigin;
    if(local.x < 0.0 || local.x >= u_windowSize.x ||
       local.y < 0.0 || local.y >= u_windowSize.y ||
       local.z < 0.0 || local.z >= u_windowSize.z) {
        return false;
    }
    float u = (local.x + 0.5) / u_windowSize.x;
    float v = (local.y + local.z * u_windowSize.y + 0.5)
              / (u_windowSize.y * u_windowSize.z);
    return texture2D(u_cellSolidity, vec2(u, v)).r > 0.5;
}

// Per-cell emission (highlight) color, sampled by integer cell coordinate using the
// same grid->2D flatten as isCellSolid. Out-of-bounds cells contribute nothing.
vec3 cellEmissionColorAt(vec3 cell) {
    vec3 local = cell - u_windowOrigin;
    if(local.x < 0.0 || local.x >= u_windowSize.x ||
       local.y < 0.0 || local.y >= u_windowSize.y ||
       local.z < 0.0 || local.z >= u_windowSize.z) {
        return vec3(0.0);
    }
    float u = (local.x + 0.5) / u_windowSize.x;
    float v = (local.y + local.z * u_windowSize.y + 0.5)
              / (u_windowSize.y * u_windowSize.z);
    return texture2D(u_cellEmissionColor, vec2(u, v)).rgb;
}

// Map a face fragment to the solid cell that owns it. `a_origPosition` sits on
// cell corners, so a naive floor(orig/cellSize) lands in the neighbor cell on
// +X/+Y/+Z faces (and breaks the top row, where y+1 is out of map bounds).
vec3 emissionCellFromFace(vec3 orig, vec3 normal) {
    vec3 cell = floor(orig / u_cellSize);
    if(normal.x > 0.5) cell.x -= 1.0;
    if(normal.y > 0.5) cell.y -= 1.0;
    if(normal.z > 0.5) cell.z -= 1.0;
    return cell;
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

        // Out of bounds — not blocked (same world->local translation as isCellSolid,
        // kept consistent so this early-exit and isCellSolid's own check agree).
        vec3 localPos = pos - u_windowOrigin;
        if(localPos.x < 0.0 || localPos.x >= u_windowSize.x ||
           localPos.y < 0.0 || localPos.y >= u_windowSize.y ||
           localPos.z < 0.0 || localPos.z >= u_windowSize.z) return false;

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
        // True world-space base normal (flat-shaded per-face normal). Normal-map
        // perturbations below are converted into this same world space (rather than
        // the old iso-projected pseudo-space) so lighting stays camera-orientation-
        // independent — see computeLighting.
        vec3 baseNormal = normalize(v_worldNormal);
        // Emissive-texture color (Part B), sampled alongside albedo only when a
        // material provides an emission texture; otherwise falls back to albedo below.
        vec3 emissionTexColor = vec3(0.0);

        if(u_useMeshUV) {
            // Per-vertex UV mode (custom shapes): sample by the mesh's own UVs, but
            // pick the per-side frame by the dominant axis of the world normal so an
            // asymmetric tile (e.g. grass-cap: grass top / dirt sides) maps crisply
            // per face. Per-side bounds default to the base frame when a material has
            // no `sides`, so back-compat is preserved (all faces show the base frame).
            vec3 an = abs(v_worldNormal);
            vec4 ab, nb;
            int axis; // 0 = +X side (YZ plane), 1 = +Y up (XZ plane), 2 = +Z side (XY plane)
            if(an.x >= an.y && an.x >= an.z) { ab = u_albedoBoundsYZ; nb = u_normalBoundsYZ; axis = 0; }
            else if(an.y >= an.z)            { ab = u_albedoBoundsXZ; nb = u_normalBoundsXZ; axis = 1; }
            else                             { ab = u_albedoBoundsXY; nb = u_normalBoundsXY; axis = 2; }
            albedo = texture2D(u_albedoTexture, mix(ab.xy, ab.zw, v_uv));
            if(u_hasEmissionTexture) {
                vec4 eb = axis == 0 ? u_emissionBoundsYZ : axis == 1 ? u_emissionBoundsXZ : u_emissionBoundsXY;
                emissionTexColor = texture2D(u_emissionTexture, mix(eb.xy, eb.zw, v_uv)).rgb;
            }
            if(u_hasNormal) {
                vec2 nUV = mix(nb.xy, nb.zw, v_uv);
                vec3 nm = texture2D(u_normalTexture, nUV).rgb * 2.0 - 1.0;
                // Map the tangent-space sample (r,g,b) onto this plane's world axes —
                // matches the (u,v) = (z,-y) / (x,z) / (x,-y) sampling convention below.
                vec3 pert = axis == 0 ? vec3(sign(v_worldNormal.x) * nm.b, -nm.g, nm.r)
                          : axis == 1 ? vec3(nm.r, sign(v_worldNormal.y) * nm.b, nm.g)
                          :             vec3(nm.r, -nm.g, sign(v_worldNormal.z) * nm.b);
                finalNormal = normalize(baseNormal + pert * 0.5);
            } else {
                finalNormal = baseNormal;
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

            // Triplanar emissive-texture sampling (same planes/weights as albedo).
            if(u_hasEmissionTexture) {
                vec4 emYZ = sampleBilinear(u_emissionTexture, vec2(v_worldPos.z, -v_worldPos.y), u_emissionSizeYZ, u_emissionBoundsYZ);
                vec4 emXZ = sampleBilinear(u_emissionTexture, vec2(v_worldPos.x, v_worldPos.z), u_emissionSizeXZ, u_emissionBoundsXZ);
                vec4 emXY = sampleBilinear(u_emissionTexture, vec2(v_worldPos.x, -v_worldPos.y), u_emissionSizeXY, u_emissionBoundsXY);
                emissionTexColor = (emYZ * blendWeights.x + emXZ * blendWeights.y + emXY * blendWeights.z).rgb;
            }

            // Triplanar normal mapping (if available). Each plane's tangent-space
            // sample is converted to a world-space perturbation BEFORE blending
            // (each plane maps its own (u,v,n) onto different world axes, so they
            // can't be blended as raw texture values the way albedo can).
            if(u_hasNormal) {
                vec2 normalAtlasUV_YZ = mix(u_normalBoundsYZ.xy, u_normalBoundsYZ.zw, normalizedUV_YZ);
                vec2 normalAtlasUV_XZ = mix(u_normalBoundsXZ.xy, u_normalBoundsXZ.zw, normalizedUV_XZ);
                vec2 normalAtlasUV_XY = mix(u_normalBoundsXY.xy, u_normalBoundsXY.zw, normalizedUV_XY);

                vec3 nmYZ = texture2D(u_normalTexture, normalAtlasUV_YZ).rgb * 2.0 - 1.0;
                vec3 nmXZ = texture2D(u_normalTexture, normalAtlasUV_XZ).rgb * 2.0 - 1.0;
                vec3 nmXY = texture2D(u_normalTexture, normalAtlasUV_XY).rgb * 2.0 - 1.0;

                // Same (u,v) = (z,-y) / (x,z) / (x,-y) axis mapping as the albedo/UV
                // sampling above, projected onto true world axes per plane.
                vec3 pertYZ = vec3(sign(v_worldNormal.x) * nmYZ.b, -nmYZ.g, nmYZ.r);
                vec3 pertXZ = vec3(nmXZ.r, sign(v_worldNormal.y) * nmXZ.b, nmXZ.g);
                vec3 pertXY = vec3(nmXY.r, -nmXY.g, sign(v_worldNormal.z) * nmXY.b);

                vec3 pert = pertYZ * blendWeights.x + pertXZ * blendWeights.y + pertXY * blendWeights.z;
                finalNormal = normalize(baseNormal + pert * 0.5);
            } else {
                finalNormal = baseNormal;
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

        // Self-illumination = two independent additive terms on top of lighting:
        //  • emissive texture (or albedo when a material has none) × per-cell v_emission
        //  • per-cell flat highlight color (independent of v_emission; 0 = off)
        // With no emission texture and no highlight this is exactly the legacy
        // `albedo.rgb*lighting + albedo.rgb*v_emission`.
        vec3 emissionSample = u_hasEmissionTexture ? emissionTexColor : albedo.rgb;
        vec3 highlight = u_hasCellEmissionColor
            ? cellEmissionColorAt(emissionCellFromFace(v_origWorldPos, v_worldNormal))
            : vec3(0.0);
        vec3 cellColor = albedo.rgb * lighting
                       + emissionSample * v_emission
                       + highlight;
        gl_FragColor = vec4(cellColor, albedo.a);

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

        // Sprites are billboards with no real oriented surface — world-up is used
        // as a sensible, camera-orientation-independent base normal (a standee
        // catching overhead/directional light), matching the cell top-plane's
        // (u,v,n) = (x,z,y) convention for normal-map perturbation.
        vec3 finalNormal;
        vec3 baseNormal = vec3(0.0, 1.0, 0.0);
        if(u_hasNormal) {
          // Sample normal map from same UV coords as albedo
            vec2 normalAtlasUV = mix(u_normalUVBounds.xy, u_normalUVBounds.zw, v_uv);
            vec3 nm = texture2D(u_normalTexture, normalAtlasUV).rgb * 2.0 - 1.0;
            vec3 pert = vec3(nm.r, nm.b, nm.g);
            finalNormal = normalize(baseNormal + pert * 0.5);
        } else {
            finalNormal = baseNormal;
        }

        // Emission texture (or albedo fallback below), sampled from the same UV
        // rect convention as normal/albedo — a single atlas frame, no triplanar.
        vec3 emissionTexColor = vec3(0.0);
        if(u_hasEmission) {
            vec2 emissionAtlasUV = mix(u_emissionUVBounds.xy, u_emissionUVBounds.zw, v_uv);
            emissionTexColor = texture2D(u_emissionTexture, emissionAtlasUV).rgb;
        }

        // Material (metallic/roughness) texture: R = metallic, G = roughness.
        // Defaults (0 metallic, fully rough) make computeSpecular a no-op when unset.
        float metallic = 0.0;
        float roughness = 1.0;
        if(u_hasMaterial) {
            vec2 materialAtlasUV = mix(u_materialUVBounds.xy, u_materialUVBounds.zw, v_uv);
            vec4 materialSample = texture2D(u_materialTexture, materialAtlasUV);
            metallic = materialSample.r;
            roughness = materialSample.g;
        }

        // Dynamic lighting
        vec3 lighting = computeLighting(finalNormal, v_worldPos);

        // Specular highlight (material-driven; zero cost when u_hasMaterial is false,
        // since metallic defaults to 0.0 and computeSpecular early-outs on it).
        vec3 viewDir = normalize(u_cameraWorldPos - v_worldPos);
        vec3 specular = computeSpecular(finalNormal, v_worldPos, viewDir, metallic, roughness);

        // Emission: texture-driven glow (or albedo fallback) scaled by intensity, plus
        // an independent flat additive highlight — mirrors cell mode's two-term emission.
        vec3 spriteEmission = (u_hasEmission ? emissionTexColor : albedo.rgb) * u_emissionIntensity
                             + u_emissionColor;

        // Tint scales lit albedo only — emission/specular stay additive and untinted,
        // matching cell mode's convention (glow/highlight terms aren't albedo-scaled).
        vec3 litColor = albedo.rgb * lighting * u_tint.rgb + specular + spriteEmission;
        vec4 tinted = vec4(litColor, albedo.a * u_tint.a);

        // Apply opacity to final alpha channel
        gl_FragColor = vec4(tinted.rgb, tinted.a * u_opacity);
    }
}
