import type { ApiField, ApiMethod, ApiMethodArg, ComponentApiDoc } from "./component-api-types";

const O = (
  key: string,
  type: string,
  desc: string,
  defaultValue?: string,
): ApiField => (defaultValue !== undefined ? { key, type, desc, default: defaultValue } : { key, type, desc });
const A = (name: string, type: string, desc: string): ApiMethodArg => ({ name, type, desc });
const M = (
  key: string,
  signature: string,
  desc: string,
  args: ApiMethodArg[] = [],
): ApiMethod => (args.length > 0 ? { key, signature, desc, args } : { key, signature, desc });

const BASE_OPTIONS: ApiField[] = [
  O("name", "string", "Component name passed to newComponent (required)."),
  O("overrideKey", "string?", "MethodRegistry key for custom init/update/show/hide overrides."),
  O("updateOverride", "string?", "MethodRegistry key for a custom per-frame update."),
  O("initOverride", "string?", "MethodRegistry key for custom init."),
];

const BASE_DATA: ApiField[] = [
  O("name", "string", "Human-readable identifier; used by nexus name shorthand."),
  O("type", "COMPONENT_TYPE", "Registry key for this instance."),
  O("id", "number?", "Runtime-assigned instance id."),
  O("parent", "ComponentData | null", "Owning nexus, or null for scene roots."),
  O("loader", "boolean?", "True when this component generates children on init."),
  O("unique", "ComponentUnique?", "FALSE, LOCAL, GLOBAL, or NAME uniqueness rule."),
  O("overrideKey", "string?", "Scene-serialization override key."),
  O("updateOverride", "string?", "Registered custom update method key."),
  O("initOverride", "string?", "Registered custom init method key."),
  O("ready", "Promise<boolean>?", "Resolves when async init completes."),
];

const BASE_METHODS: ApiMethod[] = [
  M("init", "init()", "Optional async setup hook (engine-driven)."),
  M("initProgressive", "initProgressive()", "Optional generator for multi-frame init."),
  M("update", "update(dt)", "Optional per-frame tick (engine-driven).", [
    A("dt", "number", "Frame delta time from engine loop (ms)."),
  ]),
  M("dispose", "dispose()", "Optional teardown hook."),
];

function withBaseOptions(extra: ApiField[]): ApiField[] {
  return [...BASE_OPTIONS, ...extra];
}

export const COMPONENT_API: Record<string, ComponentApiDoc> = {
  component: {
    options: [...BASE_OPTIONS],
    data: [...BASE_DATA],
    methods: [...BASE_METHODS],
  },

  nexus: {
    options: withBaseOptions([]),
    data: [
      O("components", "ComponentData[]", "Child components attached to this nexus."),
      O("paused", "boolean", "When true, update traversal skips this subtree."),
      O("script", "string?", "Optional scene script module path."),
    ],
    methods: [
      M("addComponent", "addComponent(component)", "Attach a child; enforces unique rules.", [
        A("component", "ComponentData", "Child component to attach."),
      ]),
      M("addComponents", "addComponents(components)", "Attach multiple children.", [
        A("components", "ComponentData[] | Record<string, ComponentData>", "Children as array or keyed object."),
      ]),
      M("getComponentById", "getComponentById(id, recursive?)", "Find by runtime id.", [
        A("id", "number", "Runtime component id."),
        A("recursive", "boolean?", "Search child nexuses when true."),
      ]),
      M("getComponentByType", "getComponentByType(type, recursive?)", "First match by type.", [
        A("type", "string", "Component type registry key."),
        A("recursive", "boolean?", "Search child nexuses when true."),
      ]),
      M("getComponentsByType", "getComponentsByType(type, recursive?)", "All matches by type.", [
        A("type", "string", "Component type registry key."),
        A("recursive", "boolean?", "Search child nexuses when true."),
      ]),
      M("getComponentByName", "getComponentByName(name, recursive?)", "First match by name.", [
        A("name", "string", "Component name."),
        A("recursive", "boolean?", "Search child nexuses when true."),
      ]),
      M("getComponentsByName", "getComponentsByName(name, recursive?)", "All matches by name.", [
        A("name", "string", "Component name."),
        A("recursive", "boolean?", "Search child nexuses when true."),
      ]),
      M("getComponentByTypeAndName", "getComponentByTypeAndName(type, name, recursive?)", "First type+name match.", [
        A("type", "string", "Component type registry key."),
        A("name", "string", "Component name."),
        A("recursive", "boolean?", "Search child nexuses when true."),
      ]),
      M("getComponentsByTypeAndName", "getComponentsByTypeAndName(type, name, recursive?)", "All type+name matches.", [
        A("type", "string", "Component type registry key."),
        A("name", "string", "Component name."),
        A("recursive", "boolean?", "Search child nexuses when true."),
      ]),
      M("dispose", "dispose()", "Dispose all children depth-first."),
    ],
  },

  transform: {
    options: withBaseOptions([
      O("position", "Vector3D?", "Local position. Default (0,0,0).", "new Omosuen.Vector3D(0, 0, 0)"),
      O("rotation", "Vector3D?", "Euler rotation in radians. Default (0,0,0).", "new Omosuen.Vector3D(0, 0, 0)"),
      O("scale", "Vector3D?", "Per-axis scale. Default (1,1,1).", "new Omosuen.Vector3D(1, 1, 1)"),
    ]),
    data: [
      O("position", "Vector3D", "Local position."),
      O("rotation", "Vector3D", "Local Euler rotation (radians)."),
      O("scale", "Vector3D", "Local scale."),
      O("worldPosition", "Vector3D", "Cached composed world position."),
      O("worldRotation", "Vector3D", "Cached composed world rotation."),
      O("worldScale", "Vector3D", "Cached composed world scale."),
    ],
    methods: [
      M("init", "init()", "No-op async init."),
      M("setPosition", "setPosition(x, y, z)", "Set local position.", [
        A("x", "number", "Local X coordinate."),
        A("y", "number", "Local Y coordinate."),
        A("z", "number", "Local Z coordinate."),
      ]),
      M("translate", "translate(dx, dy, dz)", "Offset local position.", [
        A("dx", "number", "X offset."),
        A("dy", "number", "Y offset."),
        A("dz", "number", "Z offset."),
      ]),
      M("getPosition", "getPosition()", "Get world position."),
      M("setRotation", "setRotation(x, y, z)", "Set local rotation.", [
        A("x", "number", "Euler X rotation (radians)."),
        A("y", "number", "Euler Y rotation (radians)."),
        A("z", "number", "Euler Z rotation (radians)."),
      ]),
      M("rotate", "rotate(dx, dy, dz)", "Add to local rotation.", [
        A("dx", "number", "X rotation delta (radians)."),
        A("dy", "number", "Y rotation delta (radians)."),
        A("dz", "number", "Z rotation delta (radians)."),
      ]),
      M("getRotation", "getRotation()", "Get world rotation."),
      M("setScale", "setScale(x, y, z)", "Set local scale.", [
        A("x", "number", "Scale factor on X."),
        A("y", "number", "Scale factor on Y."),
        A("z", "number", "Scale factor on Z."),
      ]),
      M("scaleBy", "scaleBy(sx, sy, sz)", "Multiply local scale.", [
        A("sx", "number", "X scale multiplier."),
        A("sy", "number", "Y scale multiplier."),
        A("sz", "number", "Z scale multiplier."),
      ]),
      M("getScale", "getScale()", "Get world scale."),
      M("getWorldInto", "getWorldInto(outPos, outRot, outScale)", "Write world transform into vectors.", [
        A("outPos", "Vector3D | null", "Output world position; pass null to skip."),
        A("outRot", "Vector3D | null", "Output world rotation; pass null to skip."),
        A("outScale", "Vector3D | null", "Output world scale; pass null to skip."),
      ]),
    ],
  },

  messenger: {
    options: withBaseOptions([
      O("listeners", "ListenerConfig[]?", "Pattern + callbackKey pairs registered on init.", "[]"),
    ]),
    data: [O("listeners", "ListenerConfig[]", "Declared listener configs.")],
    methods: [
      M("send", "send(message, receiver?, body?)", "Queue a targeted message.", [
        A("message", "string", "Message identifier (e.g. attack, dialogue:start)."),
        A("receiver", "MessageReceiverOptions | null?", "Receiver filters; null broadcasts to all."),
        A("body", "MessageBody?", "Optional message payload."),
      ]),
      M("broadcast", "broadcast(message, body?)", "Queue a broadcast message.", [
        A("message", "string", "Message identifier."),
        A("body", "MessageBody?", "Optional message payload."),
      ]),
      M("on", "on(pattern, callbackKey)", "Register a listener; returns handle.", [
        A("pattern", "string | RegExp | ALL_MESSAGES | ANY_MESSAGES", "Message pattern to match."),
        A("callbackKey", "string", "MethodRegistry message-listener callback key."),
      ]),
      M("removeListener", "removeListener(handle)", "Remove a listener.", [
        A("handle", "ListenerHandle", "Handle returned by on()."),
      ]),
      M("init", "init()", "Register declared listeners."),
      M("dispose", "dispose()", "Remove listeners and purge queue."),
    ],
  },

  timer: {
    options: withBaseOptions([
      O("time", "number?", "Initial elapsed ms. Default 0.", "0"),
      O("speed", "number?", "Time multiplier. Default 1.", "1"),
      O("duration", "number", "Fire interval in ms (required).", "1000"),
      O("repeat", "number | boolean?", "false once, true forever, or repeat count.", "false"),
      O("destroy", "boolean?", "Dispose after final fire. Default false.", "false"),
      O("events", "string[]?", "MethodRegistry timer keys to invoke on fire.", "[]"),
    ]),
    data: [
      O("time", "number", "Elapsed time (ms)."),
      O("speed", "number", "Speed multiplier."),
      O("duration", "number", "Fire interval (ms)."),
      O("repeat", "number | boolean", "Repeat behavior."),
      O("destroy", "boolean", "Auto-dispose after completion."),
      O("running", "boolean", "Whether timer is counting."),
      O("events", "Set<string>", "Registered event method keys."),
    ],
    methods: [
      M("init", "init()", "No-op async init."),
      M("update", "update(dt)", "Accumulate time and fire events.", [
        A("dt", "number", "Frame delta time from engine loop (ms)."),
      ]),
      M("dispose", "dispose()", "Stop and clear events."),
      M("setTime", "setTime(time)", "Set elapsed time.", [
        A("time", "number", "Elapsed time in ms."),
      ]),
      M("getTime", "getTime()", "Get elapsed time."),
      M("setSpeed", "setSpeed(speed)", "Set speed multiplier.", [
        A("speed", "number", "Time multiplier."),
      ]),
      M("getSpeed", "getSpeed()", "Get speed multiplier."),
      M("setDuration", "setDuration(duration)", "Set fire interval.", [
        A("duration", "number", "Fire interval in ms."),
      ]),
      M("getDuration", "getDuration()", "Get fire interval."),
      M("setRepeat", "setRepeat(repeat)", "Set repeat behavior.", [
        A("repeat", "number | boolean", "false once, true forever, or repeat count."),
      ]),
      M("getRepeat", "getRepeat()", "Get repeat behavior."),
      M("addEvent", "addEvent(key)", "Add event method key.", [
        A("key", "string", "MethodRegistry timer callback key."),
      ]),
      M("removeEvent", "removeEvent(key)", "Remove event method key.", [
        A("key", "string", "MethodRegistry timer callback key."),
      ]),
      M("start", "start()", "Begin counting."),
      M("stop", "stop()", "Pause counting."),
      M("restart", "restart()", "Reset and start."),
    ],
  },

  "flag-manager": {
    options: withBaseOptions([]),
    data: [O("flags", "Set<string>", "Named boolean flags (GLOBAL unique per scene).")],
    methods: [
      M("hasFlag", "hasFlag(flag)", "Whether flag is set.", [
        A("flag", "string", "Flag name to check."),
      ]),
      M("hasAllFlags", "hasAllFlags(flags)", "All flags present.", [
        A("flags", "string | string[]", "One flag or array of flags."),
      ]),
      M("hasAnyFlag", "hasAnyFlag(flags)", "Any flag present.", [
        A("flags", "string | string[]", "One flag or array of flags."),
      ]),
      M("hasNoneOfFlags", "hasNoneOfFlags(flags)", "None of flags present.", [
        A("flags", "string | string[]", "One flag or array of flags."),
      ]),
      M("addFlag", "addFlag(flag)", "Add one flag.", [
        A("flag", "string", "Flag name to add."),
      ]),
      M("addFlags", "addFlags(flags)", "Add multiple flags.", [
        A("flags", "string[]", "Flag names to add."),
      ]),
      M("removeFlag", "removeFlag(flag)", "Remove one flag.", [
        A("flag", "string", "Flag name to remove."),
      ]),
      M("removeFlags", "removeFlags(flags)", "Remove multiple flags.", [
        A("flags", "string[]", "Flag names to remove."),
      ]),
      M("getFlags", "getFlags()", "All flags as array."),
      M("clearFlags", "clearFlags()", "Remove all flags."),
      M("dispose", "dispose()", "Clear flags."),
    ],
  },

  viewport: {
    options: withBaseOptions([
      O("width", "number?", "Canvas width in px. Default 800.", "800"),
      O("height", "number?", "Canvas height in px. Default 600.", "600"),
      O("offsetX", "number?", "Container left offset. Default 0.", "0"),
      O("offsetY", "number?", "Container top offset. Default 0.", "0"),
      O("backgroundColor", "Vector4D?", "RGBA clear color.", "new Omosuen.Vector4D(0, 0, 0, 1)"),
      O("autoResize", "boolean?", "Sync buffer to CSS size. Default true.", "true"),
    ]),
    data: [
      O("width", "number", "Drawing buffer width."),
      O("height", "number", "Drawing buffer height."),
      O("offsetX", "number", "Screen offset X."),
      O("offsetY", "number", "Screen offset Y."),
      O("backgroundColor", "Vector4D", "Background clear color."),
      O("canvas", "HTMLCanvasElement | null", "WebGL canvas."),
      O("gl", "WebGL2RenderingContext | null", "WebGL2 context."),
      O("container", "HTMLElement", "DOM wrapper element."),
      O("autoResize", "boolean", "Auto-resize to CSS layout."),
    ],
    methods: [
      M("init", "init()", "Append container and init WebGL."),
      M("update", "update(dt)", "Auto-resize when CSS size changes.", [
        A("dt", "number", "Frame delta time from engine loop (ms)."),
      ]),
      M("resize", "resize(w, h)", "Resize drawing buffer.", [
        A("w", "number", "Drawing buffer width in px."),
        A("h", "number", "Drawing buffer height in px."),
      ]),
      M("clear", "clear()", "Clear color and depth."),
      M("setBackgroundColor", "setBackgroundColor(r,g,b,a)", "Set clear color.", [
        A("r", "number", "Red channel 0–1."),
        A("g", "number", "Green channel 0–1."),
        A("b", "number", "Blue channel 0–1."),
        A("a", "number", "Alpha channel 0–1."),
      ]),
      M("setOffset", "setOffset(x, y)", "Set container position.", [
        A("x", "number", "Container left offset in px."),
        A("y", "number", "Container top offset in px."),
      ]),
    ],
  },

  camera: {
    options: withBaseOptions([
      O("zoom", "number?", "Zoom level. Default 1.", "1"),
      O("pixelScale", "number?", "Retro pixelation scale. Default 2.", "2"),
      O("axonometricAngle", "number?", "Projection angle / pitch (degrees). Default 30.", "30"),
      O("orbitYaw", "number?", "Orbit yaw (degrees), rotates world X/Z around +Y before projection. Default 0.", "0"),
      O("viewportRef", "string", "Viewport component name (required).", "'MainViewport'"),
      O("revealYOffset", "number?", "Reveal clip offset above target.", "16"),
      O("revealFadeHeight", "number?", "Dither fade height below clip.", "8"),
      O("revealRadius", "number?", "Cylindrical reveal radius.", "256"),
      O("depthCues", "DepthCuesOptions?", "Partial depth-cue weights."),
    ]),
    data: [
      O("zoom", "number", "Current zoom."),
      O("pixelScale", "number", "Pixelation scale."),
      O("axonometricAngle", "number", "Projection angle / pitch (degrees)."),
      O("orbitYaw", "number", "Orbit yaw (degrees); 0 = original fixed-azimuth view."),
      O("viewportRef", "string", "Referenced viewport name."),
      O("zoomTarget", "{x,y} | null", "Viewport-local zoom anchor."),
      O("glResources", "object", "WebGL programs, buffers, FBOs."),
      O("revealTarget", "{x,y,z} | null", "Y-slice reveal world point."),
      O("revealYOffset", "number", "Clip offset above reveal target."),
      O("revealFadeHeight", "number", "Dither fade height."),
      O("revealRadius", "number", "Cylindrical reveal radius."),
      O("revealVolume", "AABB | null", "Box reveal override."),
      O("depthCues", "DepthCues | null", "Resolved depth-cue weights."),
    ],
    methods: [
      M("render", "render(dt)", "Render cell-maps and sprites.", [
        A("dt", "number", "Frame delta time from engine loop (ms)."),
      ]),
      M("collectRenderables", "collectRenderables()", "Gather renderables for pass."),
      M("pan", "pan(offsetX, offsetY)", "Pan view.", [
        A("offsetX", "number", "Horizontal pan offset."),
        A("offsetY", "number", "Vertical pan offset."),
      ]),
      M("setZoom", "setZoom(zoom)", "Set zoom level.", [
        A("zoom", "number", "Zoom multiplier."),
      ]),
      M("setZoomTarget", "setZoomTarget(x, y)", "Set zoom anchor.", [
        A("x", "number", "Viewport-local anchor X."),
        A("y", "number", "Viewport-local anchor Y."),
      ]),
      M("resetZoomTarget", "resetZoomTarget()", "Clear zoom anchor."),
      M("setOrbitYaw", "setOrbitYaw(degrees)", "Set orbit yaw, rotating world X/Z around +Y before projection.", [
        A("degrees", "number", "New orbit yaw in degrees; normalized into [0, 360)."),
      ]),
      M("orbitBy", "orbitBy(deltaDegrees)", "Rotate orbit yaw by a relative amount (drag/keyboard controls).", [
        A("deltaDegrees", "number", "Amount to add to the current orbit yaw, in degrees."),
      ]),
      M("setPixelScale", "setPixelScale(scale)", "Set pixelation scale.", [
        A("scale", "number", "Pixelation scale factor."),
      ]),
      M("resize", "resize()", "Re-sync the offscreen framebuffer to the current viewport size. Call after resizing the viewport."),
      M("setRevealTarget", "setRevealTarget(x,y,z)", "Enable Y-slice reveal.", [
        A("x", "number", "World reveal point X."),
        A("y", "number", "World reveal point Y."),
        A("z", "number", "World reveal point Z."),
      ]),
      M("clearRevealTarget", "clearRevealTarget()", "Disable Y-slice reveal."),
      M("setRevealVolume", "setRevealVolume(min, max)", "Set box reveal volume.", [
        A("min", "{x,y,z}", "AABB minimum corner in world space."),
        A("max", "{x,y,z}", "AABB maximum corner in world space."),
      ]),
      M("clearRevealVolume", "clearRevealVolume()", "Revert to cylindrical reveal."),
      M("screenPick", "screenPick(points, count, out, opts?)", "Screen shape to world hits.", [
        A("points", "number[]", "Flat [x0,y0,...] viewport pixel coordinates."),
        A("count", "number", "Point count: 1 point, 2 line, 3 triangle, 4 quad."),
        A("out", "PickBuffer", "Output buffer filled near→far with hits."),
        A("opts", "PickOptions?", "Pick mode, entity types, line thickness."),
      ]),
      M("screenToWorldRay", "screenToWorldRay(px, py, outO, outD)", "Pixel to world ray.", [
        A("px", "number", "Viewport pixel X."),
        A("py", "number", "Viewport pixel Y."),
        A("outO", "Vector3D", "Output ray origin in world space."),
        A("outD", "Vector3D", "Output normalized ray direction."),
      ]),
      M("init", "init()", "Wire viewport and compile shaders."),
      M("dispose", "dispose()", "Release GL resources."),
    ],
  },

  "cell-map": {
    options: withBaseOptions([
      O("materials", "Material[]", "Material defs with texture-map keys (required).", "[{ albedoTextureKey: 'grass', normalTextureKey: 'grass', emissionTextureKey: 'grass', materialTextureKey: 'grass', albedoFrame: 0, normalFrame: 0, emissionFrame: 0, materialFrame: 0 }]"),
      O("materialMap", "Array3D<number>?", "Per-cell material indices. Hand-authored path: required together with mapSize (omit both for the generative path).", "new Omosuen.Array3D(new Omosuen.Vector3D(8, 4, 8), 0)"),
      O("shapeMap", "Array3D<number>?", "Per-cell shape indices.", "new Omosuen.Array3D(new Omosuen.Vector3D(8, 4, 8), 1)"),
      O("meshes", "Mesh[]?", "Custom mesh table.", "[]"),
      O("emissionMap", "Array3D<number>?", "Per-cell emission 0–31.", "new Omosuen.Array3D(new Omosuen.Vector3D(8, 4, 8), 0)"),
      O("emissionColorMap", "Array3D<number>?", "Per-cell highlight RGB.", "new Omosuen.Array3D(new Omosuen.Vector3D(8, 4, 8), 0)"),
      O("visibilityMap", "Array3D<boolean>?", "Per-cell visibility.", "new Omosuen.Array3D(new Omosuen.Vector3D(8, 4, 8), true)"),
      O("cellSize", "Vector3D", "World size of one cell (required).", "new Omosuen.Vector3D(1, 1, 1)"),
      O("mapSize", "Vector3D?", "Map dimensions in cells. Hand-authored path: required together with materialMap (omit both for the generative path).", "new Omosuen.Vector3D(8, 4, 8)"),
      O("chunkSize", "Vector3D?", "Cells per streaming chunk per axis. Pick once at construction/deserialize time.", "new Omosuen.Vector3D(32, 32, 20)"),
      O("windowRadius", "{x,y,z}?", "Padding radius in chunks around the focus point. Default auto-covers the whole authored map on the hand-authored path, {1,1,1} on the generative path.", "{ x: 1, y: 1, z: 1 }"),
      O("generateCell", "((x,y,z) => CellData | undefined) | string?", "Per-cell generator, or a key registered via registerMethod('cell-map-generator', key, fn). Must be a pure function of its coordinates. Registry-keyed generators survive save/load; raw functions don't."),
      O("generateChunk", "((cx,cy,cz) => CellData[]) | string?", "Bulk per-chunk generator (preferred over generateCell when both supplied). Same live-function-or-registry-key shape, resolved independently."),
      O("smoothing", "number?", "Surface-net smoothing iterations.", "0"),
      O("smoothingWeights", "number | Array3D<number>?", "Per-cell smoothing weight. Generative path only accepts a uniform number.", "8"),
      O("normalSmoothing", "number?", "Normal smoothing 0–1.", "0"),
      O("revealExempt", "boolean?", "Exempt from camera reveal clip.", "false"),
      O("autoFocusFromCamera", "boolean?", "Render loop drives window focus from the camera every frame.", "true"),
      O("autoResizeFromZoom", "boolean?", "Render loop drives window radius from camera zoom, capped by maxTerrainLoadDimensions.", "mirrors autoFocusFromCamera"),
      O("maxTerrainLoadDimensions", "{x,y,z}?", "World-unit cap on how far auto-resize/setWindowRadius may grow the window.", "{ x: 512, y: 512, z: 512 }"),
      O("renderDistance", "{x,y,z}?", "Half-extents (chunks) of the render loop's draw/cull volume.", "{ x: 1, y: 1, z: 1 }"),
      O("frustumPadding", "{x,y,z}?", "Diagnostic-only additive padding (world units) on the render volume.", "{ x: 0, y: 0, z: 0 }"),
    ]),
    data: [
      O("materials", "Material[]", "Material definitions."),
      O("materialMap", "Array3D<number>", "Material index per cell."),
      O("shapeMap", "Array3D<number>", "Shape index per cell."),
      O("meshes", "Mesh[]", "Mesh geometry table."),
      O("emissionMap", "Array3D<number>", "Emission intensity map."),
      O("emissionColorMap", "Array3D<number>", "Highlight color map for the resident window; off-window highlights persist via cold storage, same as primary cell data."),
      O("emissionColorVersion", "number", "Version bumped on every in-window highlight write."),
      O("emissionColorFullVersion", "number", "Last full GPU texture rebuild version."),
      O("emissionColorDirtyRegions", "CellEmissionColorDirtyRegion[]", "Per-cell delta log for incremental GPU texture updates."),
      O("customShapesPendingIndices", "number[]", "Custom shape indices added since the last GPU upload."),
      O("customShapesFullResync", "boolean", "Custom shape buffers need a full re-upload."),
      O("visibilityMap", "Array3D<boolean>", "Visibility per cell."),
      O("cellSize", "Vector3D", "Cell world dimensions."),
      O("mapSize", "Vector3D", "Current resident WINDOW's size in cells -- not the whole authored/generated map. Use getBounds() for world-space placement."),
      O("chunkSize", "Vector3D", "Cells per streaming chunk per axis."),
      O("window", "CellWindow", "Owns the resident window's origin/radius and shift orchestration."),
      O("packedData", "CellPackedReadView", "Read-only WASM cell store view (resident window only)."),
      O("needsGPUUpdate", "boolean", "Mesh needs GPU upload."),
      O("chunks", "ChunkMesh[]", "Chunk mesh segments."),
      O("chunkGridSize", "{x,y,z}", "Chunk grid dimensions."),
      O("smoothing", "number", "Smoothing iteration count."),
      O("smoothingWeights", "Array3Di", "Packed smoothing weights."),
      O("normalSmoothing", "number", "Normal smoothing 0–1."),
      O("revealExempt", "boolean", "Exempt from reveal clipping."),
      O("autoFocusFromCamera", "boolean", "Render loop drives window focus from the camera."),
      O("autoResizeFromZoom", "boolean", "Render loop drives window radius from camera zoom."),
      O("maxTerrainLoadDimensions", "{x,y,z}", "Cap on auto-resize/setWindowRadius growth."),
      O("renderDistance", "{x,y,z}", "Render loop draw/cull volume half-extents."),
      O("frustumPadding", "{x,y,z}", "Additive render-volume padding."),
    ],
    methods: [
      M("getCellData", "getCellData(coords)", "Get unpacked cell at coordinates.", [
        A("coords", "Vector3D", "Cell grid coordinates."),
      ]),
      M("setCellData", "setCellData(coords, data)", "Set full cell data.", [
        A("coords", "Vector3D", "Cell grid coordinates."),
        A("data", "CellData", "Material, shape, emission, visibility."),
      ]),
      M("setMaterial", "setMaterial(coords, index)", "Set material index.", [
        A("coords", "Vector3D", "Cell grid coordinates."),
        A("index", "number", "Material table index."),
      ]),
      M("setShape", "setShape(coords, index)", "Set shape index.", [
        A("coords", "Vector3D", "Cell grid coordinates."),
        A("index", "number", "Shape/mesh table index."),
      ]),
      M("setEmission", "setEmission(coords, intensity)", "Set emission 0–31.", [
        A("coords", "Vector3D", "Cell grid coordinates."),
        A("intensity", "number", "Emission intensity 0–31."),
      ]),
      M("setEmissionColor", "setEmissionColor(coords, color)", "Set highlight color at a world cell coordinate; off-window writes persist via cold storage.", [
        A("coords", "Vector3D", "World cell coordinates."),
        A("color", "Vector3D", "Highlight RGB channels 0–1."),
      ]),
      M("getEmissionColor", "getEmissionColor(coords)", "Get highlight color at a world cell coordinate.", [
        A("coords", "Vector3D", "World cell coordinates."),
      ]),
      M("setVisible", "setVisible(coords, visible)", "Set cell visibility.", [
        A("coords", "Vector3D", "Cell grid coordinates."),
        A("visible", "boolean", "Whether cell is visible."),
      ]),
      M("getMaterial", "getMaterial(index)", "Get material by index.", [
        A("index", "number", "Material table index."),
      ]),
      M("getMesh", "getMesh(index)", "Get mesh by index.", [
        A("index", "number", "Mesh table index."),
      ]),
      M("addMaterial", "addMaterial(material)", "Append material.", [
        A("material", "Material", "Material definition to append."),
      ]),
      M("addMesh", "addMesh(mesh)", "Append mesh.", [
        A("mesh", "Mesh", "Mesh geometry to append."),
      ]),
      M("markGPUClean", "markGPUClean()", "Clear needsGPUUpdate."),
      M("cellToWorldCoordinates", "cellToWorldCoordinates(coords)", "Top-face center in world space.", [
        A("coords", "Vector3D", "Cell grid coordinates."),
      ]),
      M("getBounds", "getBounds()", "World AABB of the current resident window."),
      M("raycast", "raycast(origin, dir, opts?)", "Raycast rendered surface.", [
        A("origin", "Vector3D", "Ray origin in world space."),
        A("dir", "Vector3D", "Ray direction (need not be normalized)."),
        A("opts", "RaycastOptions?", "Max distance and smooth-normal flag."),
      ]),
      M("getSurfacePoint", "getSurfacePoint(coords, opts?)", "Accurate top-surface point.", [
        A("coords", "Vector3D", "Cell grid coordinates."),
        A("opts", "RaycastOptions?", "Max distance and smooth-normal flag."),
      ]),
      M("sampleSurfaceHeight", "sampleSurfaceHeight(x, z, opts?)", "Topmost surface at (x,z). Default maxDistance scales off window size.", [
        A("x", "number", "World X coordinate."),
        A("z", "number", "World Z coordinate."),
        A("opts", "RaycastOptions?", "Max distance and smooth-normal flag."),
      ]),
      M("setFocus", "setFocus(worldX, worldY, worldZ)", "Move the resident window to cover a world position, shifting if needed.", [
        A("worldX", "number", "World X coordinate."),
        A("worldY", "number", "World Y coordinate."),
        A("worldZ", "number", "World Z coordinate."),
      ]),
      M("setWindowRadius", "setWindowRadius(radius)", "Grow/shrink the window's padding radius, clamped by maxTerrainLoadDimensions.", [
        A("radius", "{x,y,z}", "New radius in chunks per axis."),
      ]),
      M("advanceWindowGeneration", "advanceWindowGeneration()", "Advance a pending shift/resize's chunk generation by one frame's budget; call every frame."),
      M("refreshChunks", "refreshChunks(min, max)", "Force chunks to re-derive from the generator instead of treating a previously-visited answer as permanent (fixes generative worlds that grow over time). null min refreshes the whole resident window. Resident chunks with a live edit are skipped, not overwritten.", [
        A("min", "{x,y,z} | null", "World cell coordinate range start, or null for the whole resident window."),
        A("max", "{x,y,z}?", "World cell coordinate range end (required unless min is null)."),
      ]),
      M("setCells", "setCells(entries, opts?)", "Frame-budgeted bulk write of already-known cell values, batching dirty-marking per chunk. Returns a Promise resolved once applied.", [
        A("entries", "{x,y,z,data: CellData}[]", "Cell values to write."),
        A("opts", "{budgetMs?: number}?", "Per-frame time budget (default 4ms)."),
      ]),
      M("advanceSetCells", "advanceSetCells()", "Advance a pending setCells batch by one frame's budget; call every frame (renderer-driven)."),
      M("takePendingBufferCleanup", "takePendingBufferCleanup()", "Drain evicted chunk meshes whose GPU buffers still need deleting (renderer-driven)."),
      M("flush", "flush()", "Flush dirty cells to WASM store."),
    ],
  },

  sprite: {
    options: withBaseOptions([
      O("textureMapKeys", "{albedo?,normal?,material?,emission?}?", "Texture-map keys per channel.", "{ albedo: '', normal: '', material: '', emission: '' }"),
      O("frame", "{albedo?,normal?,emission?,material?}?", "Initial frame per channel.", "{ albedo: 0, normal: 0, emission: 0, material: 0 }"),
      O("anchor", "Vector2D?", "Pivot from top-left (px).", "new Omosuen.Vector2D(0, 0)"),
      O("tint", "Vector4D?", "RGBA tint 0–1.", "new Omosuen.Vector4D(1, 1, 1, 1)"),
      O("opacity", "number?", "Alpha 0–1.", "1"),
      O("showSilhouette", "boolean?", "Flat silhouette when occluded.", "false"),
      O("silhouetteColor", "Vector4D?", "Silhouette color.", "new Omosuen.Vector4D(0.2, 0.4, 0.8, 0.5)"),
      O("visible", "boolean?", "Whether renderer draws sprite.", "true"),
      O("renderOrder", "number?", "Sibling draw order.", "0"),
      O("emissionIntensity", "number?", "Self-illumination dial (clamped 0–1); scales the emission texture, or albedo as a fallback when no emission texture is assigned.", "0"),
      O("emissionColor", "Vector3D?", "Flat additive RGB highlight, added independent of emissionIntensity.", "new Omosuen.Vector3D(0, 0, 0)"),
    ]),
    data: [
      O("textureMapKeys", "object", "Texture-map key per channel."),
      O("frame", "object", "Current frame index per channel."),
      O("anchor", "Vector2D", "Anchor in pixels."),
      O("tint", "Vector4D", "Color tint."),
      O("opacity", "number", "Alpha."),
      O("showSilhouette", "boolean", "Silhouette when occluded."),
      O("silhouetteColor", "Vector4D", "Silhouette color."),
      O("visible", "boolean", "Render visibility."),
      O("renderOrder", "number", "Draw order among siblings."),
      O("emissionIntensity", "number", "Self-illumination dial, 0–1."),
      O("emissionColor", "Vector3D", "Additive RGB highlight."),
    ],
    methods: [
      M("init", "init()", "Validate texture-map references."),
      M("setFrame", "setFrame(index, channels?)", "Set frame on channel(s).", [
        A("index", "number", "Frame index in texture-map."),
        A("channels", "ChannelType | ChannelType[]?", "Channel(s) to update; omit for all."),
      ]),
      M("setTint", "setTint(r,g,b,a)", "Set tint.", [
        A("r", "number", "Red channel 0–1."),
        A("g", "number", "Green channel 0–1."),
        A("b", "number", "Blue channel 0–1."),
        A("a", "number", "Alpha channel 0–1."),
      ]),
      M("setOpacity", "setOpacity(alpha)", "Set opacity.", [
        A("alpha", "number", "Opacity 0–1."),
      ]),
      M("setVisible", "setVisible(visible)", "Toggle visibility.", [
        A("visible", "boolean", "Whether renderer draws sprite."),
      ]),
      M("setRenderOrder", "setRenderOrder(order)", "Set draw order.", [
        A("order", "number", "Draw order among sibling sprites."),
      ]),
      M("setEmissionIntensity", "setEmissionIntensity(intensity)", "Set/clamp the self-illumination dial.", [
        A("intensity", "number", "Emission intensity, clamped 0–1."),
      ]),
      M("setEmissionColor", "setEmissionColor(r,g,b)", "Set the additive emission color.", [
        A("r", "number", "Red channel 0–1."),
        A("g", "number", "Green channel 0–1."),
        A("b", "number", "Blue channel 0–1."),
      ]),
      M("getEmissionColor", "getEmissionColor()", "Returns a copy of the current emission color (Vector3D)."),
    ],
  },

  "texture-map": {
    options: withBaseOptions([
      O("textureMapKey", "string", "Unique atlas lookup key (required).", "'hero_albedo'"),
      O("filePath", "string", "Source image path (required).", "'assets/hero.png'"),
      O("sourceImage", "CanvasImageSource?", "In-memory image instead of filePath."),
      O("imageType", "Vector4D[] | GridConfig?", "Frame extraction config."),
      O("atlasManager", "AtlasManagerT?", "Auto-register with atlas-manager."),
    ]),
    data: [
      O("textureMapKey", "string", "Unique lookup key."),
      O("filePath", "string", "Source image path."),
      O("sourceImage", "CanvasImageSource?", "Runtime source image."),
      O("imageType", "ImageType", "Frame extraction mode."),
      O("originalFrames", "OriginalFrame[]", "Source frame defs."),
      O("packedFrames", "PackedFrame[]", "Atlas-packed frames."),
      O("frameIndexMap", "Map<number,PackedFrame>", "Frame index lookup."),
    ],
    methods: [
      M("getOriginalFrame", "getOriginalFrame(index)", "Get source frame.", [
        A("index", "number", "Frame index."),
      ]),
      M("getPackedFrame", "getPackedFrame(index)", "Get packed frame.", [
        A("index", "number", "Frame index."),
      ]),
      M("isPacked", "isPacked()", "Whether frames are packed."),
      M("getFrameCount", "getFrameCount()", "Number of frames."),
      M("clearPackedFrames", "clearPackedFrames()", "Clear packed data."),
      M("setPackedFrames", "setPackedFrames(frames)", "Set packed frames.", [
        A("frames", "PackedFrame[]", "Atlas-packed frame array."),
      ]),
      M("dispose", "dispose()", "Mark disposed."),
    ],
  },

  "atlas-manager": {
    options: withBaseOptions([
      O("config", "AtlasManagerConfig?", "atlasSize, maxAtlases, padding, retainAtlas.", "{ atlasSize: 4096, maxAtlases: 16, padding: 1, retainAtlas: false }"),
    ]),
    data: [
      O("textureMapIds", "Set<string>", "Pending texture-map ids."),
      O("textureMapsByKey", "Map<string,TextureMapT>", "Texture-map registry."),
      O("atlases", "ImageData[]", "Compiled atlas textures."),
      O("compiled", "boolean", "Atlases ready flag."),
      O("atlasVersion", "number", "Version bumped on recompile."),
      O("config", "object", "Resolved atlas config."),
      O("imageCache", "Map<string,CanvasImageSource>", "Loaded image cache."),
      O("imageLoading", "Map<string,Promise>", "In-flight image loads."),
      O("atlasCanvases", "HTMLCanvasElement[]", "Retained atlas canvases."),
      O("packState", "PackerState | null", "Packer free-space state."),
      O("packedByKey", "Map<string,PackedRegion>", "Packed region dedup map."),
      O("_releaseScheduled", "boolean", "CPU atlas drop scheduled."),
      O("dirtyRegions", "AtlasDirtyRegion[]", "Incremental update rects."),
      O("fullVersion", "number", "Last full compile version."),
    ],
    methods: [
      M("initProgressive", "initProgressive()", "Resumable atlas compile across frames."),
      M("addTextureMap", "addTextureMap(map)", "Queue texture-map.", [
        A("map", "TextureMapT", "Texture-map component to queue."),
      ]),
      M("getTextureMap", "getTextureMap(key)", "Get texture-map by key.", [
        A("key", "string", "textureMapKey lookup."),
      ]),
      M("getOrCreateTextureMap", "getOrCreateTextureMap(key, factory)", "Get or create shared map.", [
        A("key", "string", "textureMapKey identity."),
        A("factory", "() => Promise<TextureMapT | null>", "Creates map when key is new."),
      ]),
      M("processTextureMaps", "processTextureMaps()", "Load, pack, and compile."),
      M("getAtlas", "getAtlas(index)", "Get atlas ImageData.", [
        A("index", "number", "Atlas index (0–15)."),
      ]),
      M("getAtlasCount", "getAtlasCount()", "Number of atlases."),
      M("rebuildAtlases", "rebuildAtlases()", "Rebuild CPU atlas data."),
      M("clear", "clear()", "Clear atlases and pending maps."),
      M("loadImage", "loadImage(path)", "Async load image.", [
        A("path", "string", "Image file path."),
      ]),
      M("getImage", "getImage(path)", "Sync get cached image.", [
        A("path", "string", "Image file path."),
      ]),
      M("hasImage", "hasImage(path)", "Image cached.", [
        A("path", "string", "Image file path."),
      ]),
      M("isLoading", "isLoading(path)", "Load in flight.", [
        A("path", "string", "Image file path."),
      ]),
      M("removeImage", "removeImage(path)", "Evict cached image.", [
        A("path", "string", "Image file path."),
      ]),
      M("getImageCacheSize", "getImageCacheSize()", "Cache entry count."),
      M("dispose", "dispose()", "Release resources."),
    ],
  },

  light: {
    options: withBaseOptions([
      O("lightType", "'ambient'|'point'|'spot'|'directional'", "Light discriminator (required).", "'point'"),
      O("color", "Vector3D?", "RGB 0–1.", "new Omosuen.Vector3D(1, 1, 1)"),
      O("brightness", "number?", "Brightness 0–1.", "1"),
      O("radius", "number?", "Travel distance (point/spot).", "100"),
      O("hardness", "number?", "Edge softness 0–1.", "0"),
      O("direction", "Vector3D?", "World direction (directional).", "new Omosuen.Vector3D(0, -1, 0)"),
    ]),
    data: [
      O("lightType", "LightType", "ambient | point | spot | directional."),
      O("color", "Vector3D", "Light color."),
      O("brightness", "number", "Brightness 0–1."),
      O("radius", "number", "Radius (point/spot)."),
      O("hardness", "number", "Falloff hardness."),
      O("direction", "Vector3D", "Direction (directional)."),
    ],
    methods: [
      M("init", "init()", "No-op init."),
      M("dispose", "dispose()", "Mark disposed."),
      M("setColor", "setColor(color)", "Set color.", [
        A("color", "Vector3D", "RGB color channels 0–1."),
      ]),
      M("getColor", "getColor()", "Get color."),
      M("setBrightness", "setBrightness(v)", "Set brightness.", [
        A("v", "number", "Brightness 0–1."),
      ]),
      M("getBrightness", "getBrightness()", "Get brightness."),
      M("setRadius", "setRadius(r)", "Set radius.", [
        A("r", "number", "Light travel distance (point/spot)."),
      ]),
      M("getRadius", "getRadius()", "Get radius."),
      M("setHardness", "setHardness(h)", "Set hardness.", [
        A("h", "number", "Edge falloff hardness 0–1."),
      ]),
      M("getHardness", "getHardness()", "Get hardness."),
      M("setDirection", "setDirection(d)", "Set direction.", [
        A("d", "Vector3D", "World-space light direction."),
      ]),
      M("getDirection", "getDirection()", "Get direction."),
      M("setLightType", "setLightType(t)", "Set light type.", [
        A("t", "LightType", "ambient | point | spot | directional."),
      ]),
      M("getLightType", "getLightType()", "Get light type."),
    ],
  },

  "animation-controller": {
    options: withBaseOptions([
      O("animations", "Animation[] | string?", "Inline animations or animationMapKey."),
      O("channels", "ChannelType[]?", "Sprite channels to drive.", "['albedo']"),
      O("speed", "number?", "Playback speed multiplier.", "1"),
      O("layers", "AnimationLayer[]?", "Sprite layer bindings.", "[]"),
    ]),
    data: [
      O("animations", "Map<string,Animation>", "Named animation defs."),
      O("animationMapRef", "string?", "Shared animation-map key."),
      O("state", "AnimationState", "playing | paused | stopped."),
      O("currentAnimation", "string | null", "Active animation name."),
      O("currentFrameIndex", "number", "Index in frames array."),
      O("frameTime", "number", "Accumulated ms for frame."),
      O("speed", "number", "Playback speed."),
      O("channels", "ChannelType[]", "Animated channels."),
      O("layers", "AnimationLayer[]", "Layer bindings."),
      O("_layerSprites", "(SpriteT|null)[]?", "Resolved sprite cache per layer."),
    ],
    methods: [
      M("init", "init()", "Resolve animation-map; bind sprites."),
      M("update", "update(dt)", "Advance frames.", [
        A("dt", "number", "Frame delta time from engine loop (ms)."),
      ]),
      M("addAnimation", "addAnimation(anim)", "Add animation.", [
        A("anim", "Animation", "Named animation with frames and timing."),
      ]),
      M("removeAnimation", "removeAnimation(name)", "Remove animation.", [
        A("name", "string", "Animation name to remove."),
      ]),
      M("hasAnimation", "hasAnimation(name)", "Animation exists.", [
        A("name", "string", "Animation name to check."),
      ]),
      M("getAnimation", "getAnimation(name)", "Get animation def.", [
        A("name", "string", "Animation name."),
      ]),
      M("play", "play(name, restart?)", "Start animation.", [
        A("name", "string", "Animation name to play."),
        A("restart", "boolean?", "Reset to first frame when true."),
      ]),
      M("pause", "pause()", "Pause playback."),
      M("resume", "resume()", "Resume playback."),
      M("stop", "stop()", "Stop and reset."),
      M("getState", "getState()", "Playback state."),
      M("isPlaying", "isPlaying()", "Currently playing."),
      M("getCurrentAnimation", "getCurrentAnimation()", "Current animation name."),
      M("getCurrentFrame", "getCurrentFrame()", "Current frame number."),
      M("setSpeed", "setSpeed(speed)", "Set playback speed.", [
        A("speed", "number", "Playback speed multiplier (>= 0)."),
      ]),
      M("getSpeed", "getSpeed()", "Get playback speed."),
      M("setChannels", "setChannels(channels)", "Set channels.", [
        A("channels", "ChannelType[]", "Sprite channels to animate."),
      ]),
      M("getChannels", "getChannels()", "Get channels."),
      M("setLayerVisible", "setLayerVisible(name, visible)", "Toggle layer visibility.", [
        A("name", "string", "Layer name."),
        A("visible", "boolean", "Whether layer sprite is visible."),
      ]),
      M("addLayer", "addLayer(layer)", "Add layer binding.", [
        A("layer", "AnimationLayer", "Sprite layer binding config."),
      ]),
      M("getLayer", "getLayer(name)", "Get layer by name.", [
        A("name", "string", "Layer name."),
      ]),
      M("getLayers", "getLayers()", "Get all layers."),
    ],
  },

  "animation-map": {
    options: withBaseOptions([
      O("animationMapKey", "string", "Unique key for controllers (required).", "'hero_anims'"),
      O("animations", "Animation[]?", "Shared frozen animation defs.", "[]"),
    ]),
    data: [
      O("animationMapKey", "string", "Unique lookup key."),
      O("animations", "Map<string,Animation>", "Frozen named animations."),
    ],
    methods: [
      M("getAnimation", "getAnimation(name)", "Get animation or null.", [
        A("name", "string", "Animation name."),
      ]),
      M("hasAnimation", "hasAnimation(name)", "Whether animation exists.", [
        A("name", "string", "Animation name to check."),
      ]),
      M("getAnimationNames", "getAnimationNames()", "All animation names."),
    ],
  },

  "input-controller": {
    options: withBaseOptions([
      O("bindings", "ActionBinding[]?", "Input-to-action bindings.", "[]"),
      O("preventDefault", "boolean?", "Prevent default on bound keys.", "true"),
      O("target", "EventTarget?", "DOM listener target.", "window"),
    ]),
    data: [
      O("bindings", "ActionBinding[]", "Action bindings."),
      O("activeInputs", "Set<string>", "Currently pressed inputs."),
      O("actionCallbacks", "Map<string,ActionCallback[]>", "Registered callbacks."),
      O("_eventHandlers", "Map<string,EventListener>", "DOM listener refs."),
      O("preventDefault", "boolean", "Prevent default flag."),
      O("target", "EventTarget", "Listener attachment target."),
    ],
    methods: [
      M("init", "init()", "Attach DOM listeners."),
      M("update", "update(dt)", "Poll gamepad state.", [
        A("dt", "number", "Frame delta time from engine loop (ms)."),
      ]),
      M("dispose", "dispose()", "Remove listeners."),
      M("bindAction", "bindAction(binding)", "Add binding.", [
        A("binding", "ActionBinding", "Input-to-action mapping."),
      ]),
      M("unbindAction", "unbindAction(action, type?)", "Remove binding.", [
        A("action", "string", "Action name to unbind."),
        A("type", "InputEventType?", "Limit removal to this event type."),
      ]),
      M("onAction", "onAction(action, callback)", "Register callback.", [
        A("action", "string", "Action name."),
        A("callback", "ActionCallback", "Handler invoked on action."),
      ]),
      M("offAction", "offAction(action, callback?)", "Unregister callback.", [
        A("action", "string", "Action name."),
        A("callback", "ActionCallback?", "Specific callback; omit to remove all."),
      ]),
      M("isActionPressed", "isActionPressed(action)", "Action currently active.", [
        A("action", "string", "Action name to query."),
      ]),
      M("getAxis", "getAxis(neg, pos)", "Analog axis from paired actions.", [
        A("neg", "string", "Negative-direction action name."),
        A("pos", "string", "Positive-direction action name."),
      ]),
    ],
  },

  collider: {
    options: withBaseOptions([
      O("shape", "'box'|'sphere'?", "Collision shape.", "'box'"),
      O("size", "Vector3D?", "Box half-extents.", "new Omosuen.Vector3D(0.5, 0.5, 0.5)"),
      O("radius", "number?", "Sphere radius.", "0.5"),
      O("offset", "Vector3D?", "Local offset from transform.", "new Omosuen.Vector3D(0, 0, 0)"),
    ]),
    data: [
      O("shape", "'box'|'sphere'", "Collision shape."),
      O("size", "Vector3D", "Box half-extents."),
      O("radius", "number", "Sphere radius."),
      O("offset", "Vector3D", "Local offset."),
    ],
    methods: [
      M("init", "init()", "No-op init."),
      M("getWorldCenter", "getWorldCenter()", "World-space center."),
      M("getWorldBounds", "getWorldBounds()", "World-space AABB."),
      M("intersectsCollider", "intersectsCollider(other)", "Test overlap.", [
        A("other", "ColliderT", "Other collider to test against."),
      ]),
      M("getOccupiedCells", "getOccupiedCells(cellMap)", "Cells in volume.", [
        A("cellMap", "CellMapT", "Cell-map to query."),
      ]),
      M("getOccupiedSolidCells", "getOccupiedSolidCells(cellMap)", "Solid cells in volume.", [
        A("cellMap", "CellMapT", "Cell-map to query."),
      ]),
      M("intersectsCellMap", "intersectsCellMap(cellMap, opts?)", "Test cell-map overlap.", [
        A("cellMap", "CellMapT", "Cell-map to test against."),
        A("opts", "ProcessCollisionsOptions?", "skipMeshCheck for fast AABB test."),
      ]),
      M("processCollisions", "processCollisions(cellMap, opts?)", "Run collision pipeline.", [
        A("cellMap", "CellMapT", "Cell-map for collision queries."),
        A("opts", "ProcessCollisionsOptions?", "skipMeshCheck for fast AABB test."),
      ]),
      M("setShape", "setShape(shape)", "Set shape.", [
        A("shape", "'box' | 'sphere'", "Collision volume shape."),
      ]),
      M("setSize", "setSize(x,y,z)", "Set box size.", [
        A("x", "number", "Box half-extent X."),
        A("y", "number", "Box half-extent Y."),
        A("z", "number", "Box half-extent Z."),
      ]),
      M("setRadius", "setRadius(r)", "Set sphere radius.", [
        A("r", "number", "Sphere radius."),
      ]),
      M("setOffset", "setOffset(x,y,z)", "Set offset.", [
        A("x", "number", "Local offset X from transform."),
        A("y", "number", "Local offset Y from transform."),
        A("z", "number", "Local offset Z from transform."),
      ]),
    ],
  },

  "event-collider": {
    options: withBaseOptions([
      O("shape", "'box'|'sphere'?", "Trigger volume shape.", "'box'"),
      O("size", "Vector3D?", "Box half-extents.", "new Omosuen.Vector3D(0.5, 0.5, 0.5)"),
      O("radius", "number?", "Sphere radius.", "0.5"),
      O("offset", "Vector3D?", "Local offset.", "new Omosuen.Vector3D(0, 0, 0)"),
    ]),
    data: [
      O("shape", "'box'|'sphere'", "Trigger shape."),
      O("size", "Vector3D", "Box half-extents."),
      O("radius", "number", "Sphere radius."),
      O("offset", "Vector3D", "Local offset."),
      O("triggers", "Record<number,boolean>", "Overlapping collider ids."),
      O("onEnter", "function | null", "Enter callback."),
      O("onExit", "function | null", "Exit callback."),
      O("while", "function | null", "Per-frame overlap callback."),
    ],
    methods: [
      M("init", "init()", "Init trigger tracking."),
      M("update", "update(dt)", "Detect enter/exit/while.", [
        A("dt", "number", "Frame delta time from engine loop (ms)."),
      ]),
      M("dispose", "dispose()", "Clear triggers."),
      M("addTrigger", "addTrigger(collider)", "Track collider.", [
        A("collider", "ColliderT", "Collider to track for overlap."),
      ]),
      M("removeTrigger", "removeTrigger(id)", "Stop tracking.", [
        A("id", "number", "Runtime id of collider to untrack."),
      ]),
      M("clearTriggers", "clearTriggers()", "Clear all triggers."),
      M("setOnEnter", "setOnEnter(fn)", "Set enter callback.", [
        A("fn", "((collider: ColliderT) => void) | null", "Called when collider enters volume."),
      ]),
      M("setOnExit", "setOnExit(fn)", "Set exit callback.", [
        A("fn", "((collider: ColliderT) => void) | null", "Called when collider exits volume."),
      ]),
      M("setWhile", "setWhile(fn)", "Set while callback.", [
        A("fn", "((collider: ColliderT, dt: number) => void) | null", "Called each frame while overlapping."),
      ]),
    ],
  },

  "speed-dial": {
    options: withBaseOptions([O("speed", "number?", "Subtree time-scale multiplier.", "1")]),
    data: [O("speed", "number", "deltaTime multiplier (>= 0).")],
    methods: [
      M("setSpeed", "setSpeed(speed)", "Set time-scale.", [
        A("speed", "number", "Subtree deltaTime multiplier (>= 0)."),
      ]),
      M("getSpeed", "getSpeed()", "Get time-scale."),
    ],
  },

  "audio-track": {
    options: withBaseOptions([O("filePath", "string", "Audio file path (required).", "'assets/music.ogg'")]),
    data: [O("filePath", "string", "Path to audio asset.")],
    methods: [
      M("init", "init()", "No-op; player loads buffers."),
      M("dispose", "dispose()", "Mark disposed."),
    ],
  },

  "audio-effect": {
    options: withBaseOptions([
      O("pitchShift", "number?", "Semitones.", "0"),
      O("speedShift", "number?", "Speed multiplier.", "1"),
      O("reverb", "number?", "Reverb 0–1.", "0"),
      O("mix", "number[]?", "Multi-band EQ levels.", "[]"),
      O("volume", "number?", "Volume 0–1.", "1"),
      O("pan", "number?", "Stereo pan -1..1.", "0"),
      O("spatial", "boolean?", "HRTF spatial panning.", "false"),
      O("spatialX", "number?", "Spatial X.", "0"),
      O("spatialY", "number?", "Spatial Y.", "0"),
      O("spatialZ", "number?", "Spatial Z.", "0"),
      O("transitionBuffer", "number?", "Pitch transition pre-buffer ms.", "150"),
    ]),
    data: [
      O("pitchShift", "number", "Pitch shift (semitones)."),
      O("speedShift", "number", "Speed multiplier."),
      O("reverb", "number", "Reverb send."),
      O("mix", "number[]", "EQ band levels."),
      O("volume", "number", "Effect volume."),
      O("pan", "number", "Stereo pan."),
      O("spatial", "boolean", "Spatial panning flag."),
      O("spatialX", "number", "Spatial X."),
      O("spatialY", "number", "Spatial Y."),
      O("spatialZ", "number", "Spatial Z."),
      O("transitionBuffer", "number", "Transition buffer ms."),
    ],
    methods: [
      M("init", "init()", "No-op init."),
      M("dispose", "dispose()", "Mark disposed."),
    ],
  },

  "audio-player": {
    options: withBaseOptions([
      O("masterVolume", "number?", "Master volume 0–1.", "1"),
      O("muted", "boolean?", "Mute output.", "false"),
    ]),
    data: [
      O("masterVolume", "number", "Master volume."),
      O("muted", "boolean", "Muted flag."),
      O("_audioContext", "AudioContext | null", "Web Audio context."),
      O("_masterGain", "GainNode | null", "Master gain node."),
      O("_activeSources", "Map<number,ActiveSource>", "Playing sources."),
      O("_nextSourceId", "number", "Source id counter."),
      O("_bufferCache", "Map<string,AudioBuffer>", "Decoded buffer cache."),
      O("_bufferLoading", "Map<string,Promise>", "In-flight decodes."),
      O("_reverbConvolver", "ConvolverNode | null", "Shared reverb node."),
      O("_workletBlobUrl", "string | null", "Stretcher worklet blob URL."),
    ],
    methods: [
      M("init", "init()", "Create AudioContext and nodes."),
      M("dispose", "dispose()", "Stop sources; close context."),
      M("play", "play(track, repeat?, effect?)", "Play audio-track; returns source id.", [
        A("track", "AudioTrackT", "Audio-track component to play."),
        A("repeat", "boolean?", "Loop playback when true."),
        A("effect", "AudioEffectT?", "Optional effect settings."),
      ]),
      M("stop", "stop(sourceId)", "Stop a source.", [
        A("sourceId", "number", "Source id returned by play()."),
      ]),
      M("stopAll", "stopAll()", "Stop all sources."),
      M("setMasterVolume", "setMasterVolume(v)", "Set master volume.", [
        A("v", "number", "Master volume 0–1."),
      ]),
      M("mute", "mute()", "Mute output."),
      M("unmute", "unmute()", "Unmute output."),
    ],
  },

  "ui-overlay": {
    options: withBaseOptions([
      O("htmlConstructorKey", "string?", "Registered HTML constructor key."),
      O("cssOverrides", "Record<string,string>?", "Inline CSS on container.", "{}"),
      O("bindings", "UIBinding[]?", "DOM event bindings.", "[]"),
      O("previousOverlayId", "number?", "Back-navigation target overlay id."),
    ]),
    data: [
      O("element", "HTMLDivElement | null", "Root overlay element."),
      O("bindings", "UIBinding[]", "Event binding configs."),
      O("cssOverrides", "Record<string,string>", "Applied CSS overrides."),
      O("previousOverlayId", "number?", "Previous overlay for back nav."),
      O("container", "HTMLElement", "DOM container."),
      O("showOverride", "string?", "Custom show method key."),
      O("hideOverride", "string?", "Custom hide method key."),
      O("htmlConstructorKey", "string?", "HTML constructor key."),
      O("_htmlConstructed", "boolean", "HTML built flag."),
    ],
    methods: [
      M("hide", "hide()", "Hide overlay."),
      M("show", "show()", "Show overlay."),
      M("back", "back()", "Navigate to previous overlay."),
      M("applyBindings", "applyBindings()", "Attach DOM listeners."),
      M("init", "init()", "Build HTML and apply bindings."),
      M("update", "update(dt)", "Per-frame overlay update.", [
        A("dt", "number", "Frame delta time from engine loop (ms)."),
      ]),
    ],
  },

  "data-layer": {
    options: withBaseOptions([]),
    data: [
      O("storage", "Map<string,DataLayerType>", "Typed key-value storage."),
      O("typeMap", "Map<string,string>", "Per-key type lock."),
      O("$data", "Proxy", "Property-access proxy (dataLayer.$data.key)."),
    ],
    methods: [
      M("set", "set(key, value)", "Set with type validation.", [
        A("key", "string", "Storage key."),
        A("value", "DataLayerType", "Scalar, vector, boolean, or homogeneous array."),
      ]),
      M("get", "get(key)", "Get value or null.", [
        A("key", "string", "Storage key."),
      ]),
      M("has", "has(key)", "Key exists.", [
        A("key", "string", "Storage key."),
      ]),
      M("delete", "delete(key)", "Remove key.", [
        A("key", "string", "Storage key."),
      ]),
      M("setAll", "setAll(data)", "Batch set.", [
        A("data", "Record<string, unknown>", "Key-value pairs to set."),
      ]),
      M("getAll", "getAll(keys)", "Batch get.", [
        A("keys", "string[]", "Keys to retrieve."),
      ]),
      M("push", "push(key, value)", "Append to array key.", [
        A("key", "string", "Array-valued storage key."),
        A("value", "DataLayerScalar", "Element to append (type-validated)."),
      ]),
      M("setAt", "setAt(key, index, value)", "Set array element.", [
        A("key", "string", "Array-valued storage key."),
        A("index", "number", "Array index to set."),
        A("value", "DataLayerScalar", "Element value (type-validated)."),
      ]),
      M("getAt", "getAt(key, index)", "Get array element.", [
        A("key", "string", "Array-valued storage key."),
        A("index", "number", "Array index to read."),
      ]),
      M("removeAt", "removeAt(key, index)", "Remove array element.", [
        A("key", "string", "Array-valued storage key."),
        A("index", "number", "Array index to remove."),
      ]),
      M("arrayLength", "arrayLength(key)", "Array length.", [
        A("key", "string", "Array-valued storage key."),
      ]),
      M("dispose", "dispose()", "Clear storage."),
    ],
  },
};

export function getComponentApi(id: string): ComponentApiDoc | undefined {
  return COMPONENT_API[id];
}
