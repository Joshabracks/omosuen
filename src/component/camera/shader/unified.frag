#version 300 es
precision mediump float;

out vec4 fragColor;

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
    // engine's shiftable hot window lands, the window's size). u_windowOrigin
    // is the world-cell-space corner that grid starts at (today always
    // (0,0,0)).
uniform highp vec3 u_windowSize;
uniform highp vec3 u_windowOrigin;
// Toroidal wrap offset in CELLS: the window origin modulo the window size,
// computed with integer math on the CPU. See `windowSlot`.
uniform highp ivec3 u_windowWrapOffset;
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
uniform highp sampler2DArray u_cellEmissionColor;  // layer=z

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
    // Fog-of-war: set per-draw-call by the CPU (render-sprites.ts) when this
    // draw call is a "phantom" sprite -- a separate, ordinary sprite entity
    // fog-of-war/methods.ts's update() spawned as a frozen last-seen
    // stand-in for some other (currently obscured) tracked sprite. See
    // SpriteT._fowStatus's doc comment.
uniform bool u_spriteFogMemory;
    // Fog-of-war OPACITY for this draw, 0..1, supplied per draw call from the
    // CPU. Timed, not distance-driven: a live sprite fades in over a fixed
    // duration, and a phantom fades out over one. Distance drives COLOUR only
    // (u_spriteVisibility). See fog-of-war/methods.ts for why.
uniform float u_spriteFogAlpha;
    // Fog-of-war visibility for THIS sprite, 0..1, computed once on the CPU
    // (render-sprites.ts, via fog-of-war/sweep.ts's computeSpriteVisibility)
    // rather than per fragment. Pure geometry -- radial falloff times the
    // fraction of jittered rays that reach the sprite -- with the
    // u_fogLightInfluence boost applied in the fragment shader on top.
    // 1.0 when there are no vision sources.
uniform float u_spriteVisibility;

    // Occlusion mask uniforms (sprite mode — samples cell FBO depth texture)
uniform sampler2D u_depthTexture;
uniform vec2 u_fboUvScale;
uniform vec2 u_fboUvOffset;
uniform vec2 u_screenSize;

    // Silhouette uniforms (sprite mode — renders flat color when occluded)
uniform bool u_showSilhouette;
uniform vec4 u_silhouetteColor;

    // Per-fragment line-of-sight raycasting (both modes)
uniform highp sampler2DArray u_cellSolidity;   // R8: 0=empty, 255=solid, layer=z

    // Fog-of-war: multiple simultaneous vision sources (both modes). Position
    // is world-space; radius/fadeWidth are world units (outer edge = radius +
    // fadeWidth). u_fogExempt opts a single cell-map draw call out entirely
    // (cellMap.revealExempt) -- not meaningful for sprites, which have no
    // per-cell-map context, so the sprite path never reads it.
const int MAX_VISION_SOURCES = 8;
uniform int u_numVisionSources;
// FogOfWarT.visionMode: true = 'line-of-sight' (raycasts), false = 'distance'
// (range alone). Uploaded per draw alongside the source arrays.
uniform bool u_fogUseLineOfSight;
uniform highp vec3 u_visionSourcePos[MAX_VISION_SOURCES];
uniform float u_visionSourceRadius[MAX_VISION_SOURCES];
uniform float u_visionSourceFadeWidth[MAX_VISION_SOURCES];
// Per-source line-of-sight fraction for THIS sprite, 0..1, sampled once at its
// anchor on the CPU. The expensive half of visibility (eight DDA raycasts)
// stays one-per-sprite; the cheap half (radial falloff) is recomputed per
// fragment against v_spriteGroundPos. Kept per SOURCE rather than pre-combined
// because visibility is max(radial_i * los_i) over sources, which does not
// factor into (max radial) * (max los). All 1.0 in 'distance' mode.
uniform float u_spriteLos[MAX_VISION_SOURCES];
uniform bool u_fogExempt;

    // Fog-of-war persistent "explored" state -- one texel per CELL, the same
    // resolution and toroidal slot addressing as u_cellSolidity, and sized by
    // the same u_windowSize. A true 3D texture, not a 2D array: on an array
    // only s and t are filtered and the layer axis is nearest, which put a hard
    // quantized line across world Z while world X blended smoothly. Sampled
    // NEAREST and blended by hand in exploredAt -- see there.
uniform highp sampler3D u_exploredTexture; // R8: 0=unexplored, 255=explored

    // Fog-of-war style config (fog-of-war component). lightInfluence 0 (the
    // default) means local lighting never affects vision.
uniform float u_fogMemorySaturation;
uniform float u_fogMemoryOpacity;
uniform vec3 u_fogMemoryTint;
uniform float u_fogNeverSaturation;
uniform float u_fogNeverOpacity;
uniform vec3 u_fogNeverTint;
uniform float u_fogLightInfluence;

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
in vec2 v_uv;
in vec3 v_worldPos;
in vec2 v_screenPos;
in vec3 v_worldNormal;
in vec3 v_origWorldPos;
in vec3 v_spriteGroundPos;
in float v_emission;
flat in vec3 v_trueFaceDir;

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

// Normal-independent local light level at a world position -- ambient +
// point/spot distance falloff only (no directional dot-normal diffuse term,
// since this is evaluated at fog-of-war sample points with no real surface
// normal). Feeds u_fogLightInfluence: how much local lighting can extend
// vision beyond what pure geometry (LOS + radius) already grants.
float computeLightLevel(vec3 worldPos) {
    float level = (u_ambientColor.r + u_ambientColor.g + u_ambientColor.b) / 3.0 * u_ambientBrightness;
    for(int i = 0; i < MAX_POINT_LIGHTS; i++) {
        if(i >= u_numPointLights) break;
        float dist = length(u_pointLightPos[i] - worldPos);
        if(dist >= u_pointLightRadius[i]) continue;
        float atten = attenuate(dist, u_pointLightRadius[i], u_pointLightHardness[i]);
        level += u_pointLightBrightness[i] * atten;
    }
    for(int i = 0; i < MAX_SPOT_LIGHTS; i++) {
        if(i >= u_numSpotLights) break;
        float dist = length(u_spotLightPos[i] - worldPos);
        if(dist >= u_spotLightRadius[i]) continue;
        float atten = attenuate(dist, u_spotLightRadius[i], u_spotLightHardness[i]);
        level += u_spotLightBrightness[i] * atten;
    }
    return clamp(level, 0.0, 1.0);
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

// Window-local cell coordinate -> texel slot in a window-sized array texture.
//
// The resident window is addressed toroidally: a cell's slot derives from its
// WORLD position (`u_windowWrapOffset` is the window origin modulo the window
// size), so panning leaves every retained cell in place and only the
// newly-exposed slab is rewritten. Callers must bounds-check `local` FIRST —
// this wraps unconditionally, and a coordinate outside the window would fold
// onto the opposite edge.
//
// Deliberately NOT `mod(worldCell, u_windowSize)`: world cell coordinates get
// large and highp float mod loses exactness. `local` is small and exact, and
// the offset arrives as an integer computed on the CPU.
ivec3 windowSlot(vec3 local) {
    return (ivec3(local) + u_windowWrapOffset) % ivec3(u_windowSize);
}

// Check if a cell at integer coordinates is solid by sampling the solidity texture.
// Out-of-bounds cells are empty — without this, CLAMP_TO_EDGE would fold the lookup
// back onto a real edge cell and report false occlusion (e.g. AO at the map border).
bool isCellSolid(vec3 cell) {
    // `cell` is a world-cell coordinate; translate into the resident grid's
    // own local space before bounds-checking/sampling.
    vec3 local = cell - u_windowOrigin;
    if(local.x < 0.0 || local.x >= u_windowSize.x ||
       local.y < 0.0 || local.y >= u_windowSize.y ||
       local.z < 0.0 || local.z >= u_windowSize.z) {
        return false;
    }
    return texelFetch(u_cellSolidity, windowSlot(local), 0).r > 0.5;
}

// Per-cell emission (highlight) color, sampled by integer cell coordinate using the
// same array-layer lookup as isCellSolid. Out-of-bounds cells contribute nothing.
vec3 cellEmissionColorAt(vec3 cell) {
    vec3 local = cell - u_windowOrigin;
    if(local.x < 0.0 || local.x >= u_windowSize.x ||
       local.y < 0.0 || local.y >= u_windowSize.y ||
       local.z < 0.0 || local.z >= u_windowSize.z) {
        return vec3(0.0);
    }
    return texelFetch(u_cellEmissionColor, windowSlot(local), 0).rgb;
}

// Map a face fragment to the solid cell that owns it. `a_origPosition` sits on
// cell corners, so a naive floor(orig/cellSize) lands in the neighbor cell on
// +X/+Y/+Z faces. `normal` corrects along its single DOMINANT axis only (same
// mutually-exclusive relative-magnitude selection as the mesh-UV/triplanar
// frame picker above) rather than three independent `> 0.5` thresholds -- on
// a smoothed mesh a face's lighting normal can tilt enough that independent
// per-axis checks fire zero times or more than once, both landing on the
// wrong cell. Callers pass v_trueFaceDir (an exact, always-axis-aligned
// direction baked at mesh-build time, independent of any smoothing), not the
// lighting normal, so this is provably correct for the common case; the
// dominant-axis selection stays as defense for the one remaining case where
// an exact face direction isn't available (a non-axis-aligned custom shape
// under smoothing, which falls back to its own geometric normal).
vec3 emissionCellFromFace(vec3 orig, vec3 normal) {
    vec3 cell = floor(orig / u_cellSize);
    vec3 an = abs(normal);
    if(an.x >= an.y && an.x >= an.z) {
        if(normal.x > 0.0) cell.x -= 1.0;
    } else if(an.y >= an.z) {
        if(normal.y > 0.0) cell.y -= 1.0;
    } else {
        if(normal.z > 0.0) cell.z -= 1.0;
    }
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

// ── Fog-of-war ───────────────────────────────────────────────────────────────────────
// One explored sample at an integer world-cell coordinate, translated through
// the same toroidal windowSlot mapping every other cell-resolution texture
// uses. Out-of-window reads as unexplored rather than folding onto an edge
// texel (CLAMP_TO_EDGE would smear the window border inward), matching
// isCellSolid's out-of-bounds handling.
float exploredSample(vec3 cell) {
    vec3 local = cell - u_windowOrigin;
    if(local.x < 0.0 || local.x >= u_windowSize.x ||
       local.y < 0.0 || local.y >= u_windowSize.y ||
       local.z < 0.0 || local.z >= u_windowSize.z) {
        return 0.0;
    }
    ivec3 slot = windowSlot(local);
    return texelFetch(u_exploredTexture, slot, 0).r;
}

// Samples the cell-resolution "explored" texture at a world-CELL-space
// position, returning a smooth 0..1 value. `fragCellPos` is un-windowed
// (world) cell coordinates, same convention as isCellSolid's `cell` param.
//
// The trilinear blend is done here rather than by the sampler. The texture is
// toroidally addressed, so hardware filtering would blend the two opposite
// edges of the buffer together wherever the wrap seam falls -- and the seam
// sits at an arbitrary point INSIDE the visible window, so that would draw a
// hard line straight across the fog. Fetching the eight neighbours
// individually lets each one wrap on its own, so no seam can form, while the
// weights come from the fractional world position and stay continuous across
// it. Eight point fetches is minor next to the eight jittered DDA raycasts
// this shader already runs per fragment.
float exploredAt(vec3 fragCellPos) {
    // Offset by half a cell so the interpolation nodes sit at cell CENTRES:
    // without this the blend is shifted half a cell against the terrain and
    // the boundary reads as misaligned with the tiles it came from.
    vec3 p = fragCellPos - 0.5;
    vec3 base = floor(p);
    vec3 f = p - base;

    float c000 = exploredSample(base + vec3(0.0, 0.0, 0.0));
    float c100 = exploredSample(base + vec3(1.0, 0.0, 0.0));
    float c010 = exploredSample(base + vec3(0.0, 1.0, 0.0));
    float c110 = exploredSample(base + vec3(1.0, 1.0, 0.0));
    float c001 = exploredSample(base + vec3(0.0, 0.0, 1.0));
    float c101 = exploredSample(base + vec3(1.0, 0.0, 1.0));
    float c011 = exploredSample(base + vec3(0.0, 1.0, 1.0));
    float c111 = exploredSample(base + vec3(1.0, 1.0, 1.0));

    return mix(
        mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
        mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y),
        f.z);
}

// One jittered vision ray, reusing isRayBlocked. `off` is a cell-space
// horizontal jitter applied to the SOURCE (not the fragment) -- scattering
// the ray origin, same idea as computeCastShadow's shadowSample.
float visionRaySample(vec3 sourceCellPos, vec3 fragCellPos, vec2 off) {
    vec3 jitteredSource = sourceCellPos + vec3(off.x, 0.0, off.y);
    if(floor(jitteredSource) == floor(fragCellPos)) return 1.0;
    return isRayBlocked(jitteredSource, fragCellPos) ? 0.0 : 1.0;
}

// One vision source's contribution at a fragment: a radial smoothstep
// falloff (radius → radius+fadeWidth) times a soft LOS term -- several
// golden-angle-jittered rays averaged together (same disk-sampling technique
// as computeCastShadow's smooth-fade mode), so both the outer edge and the
// wall-occlusion edge are smooth instead of voxel-hard.
const int VISION_SCATTER_SAMPLES = 8;
float visionSourceVisibility(
    vec3 sourcePos,
    float radius,
    float fadeWidth,
    vec3 fragWorldPos,
    vec3 fragCellPos
) {
    float dist = distance(fragWorldPos, sourcePos);
    float outer = radius + fadeWidth;
    if(dist >= outer) return 0.0;
    // GLSL leaves smoothstep undefined when edge0 == edge1; a zero fadeWidth
    // is a hard-edged source, fully visible right up to `outer`. Guarded to
    // match computeFogVisibility's identical guard on the CPU.
    float radial = outer > radius ? 1.0 - smoothstep(radius, outer, dist) : 1.0;

    // 'distance' mode (FogOfWarT.visionMode): range alone decides, walls
    // included. Mirrored by computeFogVisibility/isVisibleFrom on the CPU off
    // the same setting, so the two stay term for term in either mode. This is
    // also where the mode pays for itself -- eight DDA raycasts per fragment,
    // skipped.
    if(!u_fogUseLineOfSight) return radial;

    vec3 sourceCellPos = sourcePos / u_cellSize;
    float sum = 0.0;
    for(int i = 0; i < VISION_SCATTER_SAMPLES; i++) {
        float fi = float(i) + 0.5;
        float a = fi * 2.39996323; // golden angle
        vec2 off = vec2(cos(a), sin(a)) * sqrt(fi / float(VISION_SCATTER_SAMPLES)) * 0.75;
        sum += visionRaySample(sourceCellPos, fragCellPos, off);
    }
    float los = sum / float(VISION_SCATTER_SAMPLES);
    return radial * los;
}

// A sprite fragment's live visibility: the same max-over-sources as
// computeVisibility, but with the radial term evaluated at THIS fragment's
// ground position and the LOS term taken from the CPU's per-sprite sample.
//
// Terrain shades per fragment while a sprite used to get one number for its
// whole quad, so a sprite and the tile under it disagreed about how fogged
// they were -- most visibly as a sprite at full saturation standing on
// desaturated ground. Splitting the term this way closes that for the radial
// half at no raycast cost. Under 'distance' mode every los_i is 1 and this
// becomes exactly what the terrain path computes, so the two agree completely.
float computeSpriteFragVisibility(vec3 groundPos) {
    float visibility = 0.0;
    for(int i = 0; i < MAX_VISION_SOURCES; i++) {
        if(i >= u_numVisionSources) break;
        float radius = u_visionSourceRadius[i];
        float outer = radius + u_visionSourceFadeWidth[i];
        float dist = distance(groundPos, u_visionSourcePos[i]);
        if(dist >= outer) continue;
        float radial = outer > radius ? 1.0 - smoothstep(radius, outer, dist) : 1.0;
        visibility = max(visibility, radial * u_spriteLos[i]);
    }
    return visibility;
}

// Combined per-fragment live visibility: union (max) over every active
// vision source, then optionally boosted by local light level via
// u_fogLightInfluence -- additive only, so light can extend vision but never
// reduce it below the pure-geometry result (default lightInfluence=0 is a
// no-op here).
float computeVisibility(vec3 fragWorldPos, vec3 fragCellPos) {
    float visibility = 0.0;
    for(int i = 0; i < MAX_VISION_SOURCES; i++) {
        if(i >= u_numVisionSources) break;
        float v = visionSourceVisibility(
            u_visionSourcePos[i],
            u_visionSourceRadius[i],
            u_visionSourceFadeWidth[i],
            fragWorldPos,
            fragCellPos
        );
        visibility = max(visibility, v);
    }
    if(u_fogLightInfluence > 0.0) {
        float lightLevel = computeLightLevel(fragWorldPos);
        visibility = clamp(visibility + lightLevel * u_fogLightInfluence * (1.0 - visibility), 0.0, 1.0);
    }
    return visibility;
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
    vec4 s00 = texture(tex, mix(bounds.xy, bounds.zw, uv00));
    vec4 s10 = texture(tex, mix(bounds.xy, bounds.zw, uv10));
    vec4 s01 = texture(tex, mix(bounds.xy, bounds.zw, uv01));
    vec4 s11 = texture(tex, mix(bounds.xy, bounds.zw, uv11));

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

        // Fog-of-war: compute live visibility + explored state up front
        // (cheap — no texture reads yet) so a fully-hidden fragment discards
        // before paying for triplanar/lighting work below. Uses
        // pre-smoothing positions so floor() resolves consistently across
        // each face. fogActive is false (fog fully bypassed) when this
        // cell-map opts out (cellMap.revealExempt) or no vision source is
        // active in the scene at all.
        bool fogActive = !u_fogExempt && u_numVisionSources > 0;
        vec3 fragCellPos = v_origWorldPos / u_cellSize;
        float fogVisibility = fogActive ? computeVisibility(v_origWorldPos, fragCellPos) : 1.0;
        float fogExplored = fogActive ? exploredAt(fragCellPos) : 1.0;
        float fogStyleOpacity = fogActive ? mix(u_fogNeverOpacity, u_fogMemoryOpacity, fogExplored) : 1.0;
        if(fogVisibility <= 0.0 && fogStyleOpacity <= 0.0) discard;

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
            albedo = texture(u_albedoTexture, mix(ab.xy, ab.zw, v_uv));
            if(u_hasEmissionTexture) {
                vec4 eb = axis == 0 ? u_emissionBoundsYZ : axis == 1 ? u_emissionBoundsXZ : u_emissionBoundsXY;
                emissionTexColor = texture(u_emissionTexture, mix(eb.xy, eb.zw, v_uv)).rgb;
            }
            if(u_hasNormal) {
                vec2 nUV = mix(nb.xy, nb.zw, v_uv);
                vec3 nm = texture(u_normalTexture, nUV).rgb * 2.0 - 1.0;
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

                vec3 nmYZ = texture(u_normalTexture, normalAtlasUV_YZ).rgb * 2.0 - 1.0;
                vec3 nmXZ = texture(u_normalTexture, normalAtlasUV_XZ).rgb * 2.0 - 1.0;
                vec3 nmXY = texture(u_normalTexture, normalAtlasUV_XY).rgb * 2.0 - 1.0;

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
            ? cellEmissionColorAt(emissionCellFromFace(v_origWorldPos, v_trueFaceDir))
            : vec3(0.0);
        vec3 cellColor = albedo.rgb * lighting
                       + emissionSample * v_emission
                       + highlight;

        // Fog-of-war tiered styling: blend from the never-viewed/memory style
        // (desaturation + tint + opacity-as-fade-to-black, no real alpha —
        // this pass draws fully opaque) toward the normal live-visible color
        // as fogVisibility rises. fogStyleOpacity==0 already discarded above
        // unless fogVisibility>0, so nonLiveColor only ever matters when it's
        // actually contributing.
        //
        // Both tiers style the SAME base color -- the fully-textured, lit
        // cellColor -- so `memoryStyle` and `neverViewedStyle` are pure style
        // filters and configuring them identically produces identical output.
        //
        // Remembered terrain used to substitute a flat per-material average
        // color here, captured at observation time, which meant memory could
        // never carry texture detail no matter how it was styled. "What this
        // looked like last time" is now handled where it belongs -- by the
        // geometry itself, which simply isn't rebuilt while a cell is
        // unobserved (see cell-map/deferred-presentation.ts) -- so there is
        // nothing left to substitute.
        vec3 fogOutColor = cellColor;
        if(fogActive) {
            vec3 memoryBase = cellColor;
            float styleSaturation = mix(u_fogNeverSaturation, u_fogMemorySaturation, fogExplored);
            vec3 styleTint = mix(u_fogNeverTint, u_fogMemoryTint, fogExplored);
            float luminance = dot(memoryBase, vec3(0.299, 0.587, 0.114));
            vec3 styledColor = mix(vec3(luminance), memoryBase, styleSaturation) * styleTint;
            vec3 nonLiveColor = mix(vec3(0.0), styledColor, fogStyleOpacity);
            fogOutColor = mix(nonLiveColor, cellColor, fogVisibility);
        }
        fragColor = vec4(fogOutColor, albedo.a);

    } else {
        // ============================================================
        // MODE 1: SPRITE RENDERING (Atlas sampling with normal mapping and lighting)
        // ============================================================

        // Sample UV within atlas bounds
        vec2 atlasUV = mix(u_uvBounds.xy, u_uvBounds.zw, v_uv);

        // Albedo (always required)
        vec4 albedo = texture(u_albedoTexture, atlasUV);

        // Discard fully transparent pixels early
        if(albedo.a < 0.01)
            discard;

        // Fog-of-war visibility for this sprite, 0..1.
        //
        // Supplied by the CPU as u_spriteVisibility rather than computed here.
        // v_origWorldPos in sprite mode is u_spritePosition (see unified.vert)
        // — constant across the whole quad — so calling computeVisibility per
        // fragment re-ran eight DDA raycasts per pixel to produce one number
        // per sprite. Worse, it was a SECOND opinion: fog-of-war's CPU sweep
        // decided _fowStatus and phantom disposal from its own single-ray
        // test, and where the two disagreed (a sight line threading a gap the
        // jittered rays clip) the phantom was disposed while the real sprite
        // was discarded, leaving a hole. One number now drives both.
        //
        // The light-influence boost stays here: it needs a light walk but no
        // raycasts, so it is cheap per fragment, and u_spriteVisibility is
        // deliberately the pure-geometry term for it to build on.
        float fogVis = 1.0;
        if(u_numVisionSources > 0) {
            // Radial term per fragment, LOS term per sprite -- see
            // computeSpriteFragVisibility. u_spriteVisibility is the same value
            // sampled at the anchor, and is what the DISCARD below still uses.
            fogVis = computeSpriteFragVisibility(v_spriteGroundPos);
            if(u_fogLightInfluence > 0.0) {
                float lightLevel = computeLightLevel(v_spriteGroundPos);
                fogVis = clamp(fogVis + lightLevel * u_fogLightInfluence * (1.0 - fogVis), 0.0, 1.0);
            }
            // Both sides are gated on this one number, so there is never a
            // frame with neither the sprite nor its phantom visible -- the bug
            // this replaced.
            //
            // A phantom discards only once vision fully covers its spot. A
            // LIVE sprite never discards: at zero visibility it renders its
            // memory look, identical to the phantom that replaces it.
            //
            // That asymmetry is load-bearing. fog-of-war's sweep runs a phase
            // before this one, off a scene index and world transforms from the
            // previous frame, so on the frame a sprite crosses zero the
            // renderer sees 0.000 while the sweep still has it 'visible'.
            // Discarding here made that one-frame disagreement a blank frame,
            // every single time a sprite left vision. Mirrored on the CPU in
            // fog-of-war/sweep.ts's `fogDiscards`, which is where it is tested.
            // Anchored on u_spriteVisibility, NOT the per-fragment value. This
            // is a lifetime decision -- it must agree with the CPU sweep, which
            // disposes the phantom off that same number. Taken per fragment it
            // would erase part of a phantom's quad and leave the rest.
            if(u_spriteFogMemory && u_spriteVisibility >= 1.0) discard;
        }

        // Occlusion test: discard sprite fragments behind cells (or show silhouette)
        vec2 screenUV = gl_FragCoord.xy / u_screenSize;
        vec2 fboUV = screenUV * u_fboUvScale + u_fboUvOffset;
        float cellDepth = texture(u_depthTexture, fboUV).r;
        if(cellDepth < gl_FragCoord.z) {
            if(u_showSilhouette) {
                fragColor = u_silhouetteColor;
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
            vec3 nm = texture(u_normalTexture, normalAtlasUV).rgb * 2.0 - 1.0;
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
            emissionTexColor = texture(u_emissionTexture, emissionAtlasUV).rgb;
        }

        // Material (metallic/roughness) texture: R = metallic, G = roughness.
        // Defaults (0 metallic, fully rough) make computeSpecular a no-op when unset.
        float metallic = 0.0;
        float roughness = 1.0;
        if(u_hasMaterial) {
            vec2 materialAtlasUV = mix(u_materialUVBounds.xy, u_materialUVBounds.zw, v_uv);
            vec4 materialSample = texture(u_materialTexture, materialAtlasUV);
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

        // Fog-of-war memory styling -- desaturate/tint like terrain memory,
        // using REAL alpha for opacity (sprites already blend, unlike cells,
        // so there's no need for the fade-to-black trick the cell path uses).
        vec3 liveRgb = tinted.rgb;
        float luminance = dot(liveRgb, vec3(0.299, 0.587, 0.114));
        vec3 memoryRgb = mix(vec3(luminance), liveRgb, u_fogMemorySaturation) * u_fogMemoryTint;

        // Fog COLOUR is a pure function of distance, for every live sprite,
        // entering or leaving alike. At fogVis 0 a sprite is pixel-identical to
        // a phantom of the same frame; at 1 it is fully live. Nothing here
        // needs to know which direction it is travelling -- OPACITY carries
        // that, on a timer, in u_spriteFogAlpha.
        //
        // That is what removed the old fade-direction machinery. Telling the
        // two apart had required latching 'visible' at FULL visibility, and
        // since visibility is `radial * (hits/8)` with radial strictly below 1
        // anywhere in the fade band, a sprite that never reached the inner
        // radius could never latch -- so it faded in, faded out, and left no
        // memory behind.
        vec3 finalRgb;
        float fogAlpha;
        if(u_spriteFogMemory) {
            // A phantom is already the memory; only its opacity changes. The
            // CPU supplies that as `1 - presence` of the sprite standing over
            // it, or its own dissolve timer when the sprite has moved on -- so
            // a covered pair is complementary from ONE timer rather than two
            // that have to agree.
            finalRgb = memoryRgb;
            fogAlpha = u_fogMemoryOpacity * u_spriteFogAlpha;
        } else {
            // A live sprite: colour dissolves toward the memory look as it
            // leaves and back toward live as it returns, purely by distance.
            // At fogVis 0 this is pixel-identical to a phantom of the same
            // frame -- which is exactly what replaces it, so the handover
            // cannot be seen. Opacity is the timed fade-in.
            finalRgb = mix(memoryRgb, liveRgb, fogVis);
            fogAlpha = mix(u_fogMemoryOpacity, 1.0, fogVis) * u_spriteFogAlpha;
        }

        // Apply opacity to final alpha channel
        fragColor = vec4(finalRgb, tinted.a * u_opacity * fogAlpha);
    }
}
