/** Core Omosuen component types (matches `BUILDERS` in the engine registry). */

export interface ComponentDocEntry {
  id: string;
  title: string;
  blurb: string;
  category: string;
}

/** Shared `ComponentData` base — not a spawnable type, but documented for all types. */
export const BASE_COMPONENT_DOC: ComponentDocEntry = {
  id: "component",
  title: "component",
  category: "Foundation",
  blurb:
    "Every engine type is a plain data object with shared identity fields, lifecycle hooks, and Proxy-dispatched methods.",
};

export const COMPONENT_DOC_CATEGORIES = [
  "Scene",
  "Rendering",
  "Animation",
  "Input",
  "Audio",
  "UI",
] as const;

export const ENGINE_COMPONENTS: ComponentDocEntry[] = [
  {
    id: "nexus",
    title: "nexus",
    category: "Scene",
    blurb: "Container node for the component tree; scenes are root nexuses.",
  },
  {
    id: "transform",
    title: "transform",
    category: "Scene",
    blurb: "Position, rotation, and scale in world space.",
  },
  {
    id: "messenger",
    title: "messenger",
    category: "Scene",
    blurb: "Pattern-matched message bus for decoupled scene logic.",
  },
  {
    id: "timer",
    title: "timer",
    category: "Scene",
    blurb: "Interval and one-shot callbacks driven by the engine loop.",
  },
  {
    id: "flag-manager",
    title: "flag-manager",
    category: "Scene",
    blurb: "Named boolean flags polled once per frame.",
  },
  {
    id: "viewport",
    title: "viewport",
    category: "Rendering",
    blurb: "WebGL canvas, size, and background for a camera target.",
  },
  {
    id: "camera",
    title: "camera",
    category: "Rendering",
    blurb: "Axonometric view with orbit yaw, zoom, and render passes for cell-maps and sprites.",
  },
  {
    id: "cell-map",
    title: "cell-map",
    category: "Rendering",
    blurb: "Voxel terrain from shape/material maps with WASM meshing.",
  },
  {
    id: "sprite",
    title: "sprite",
    category: "Rendering",
    blurb: "Textured billboard quad with atlas frames, tint, and material-driven specular/emission.",
  },
  {
    id: "texture-map",
    title: "texture-map",
    category: "Rendering",
    blurb: "Source frames packed into atlases for sprites and materials.",
  },
  {
    id: "atlas-manager",
    title: "atlas-manager",
    category: "Rendering",
    blurb: "Compiles and uploads texture atlases for the render pipeline.",
  },
  {
    id: "light",
    title: "light",
    category: "Rendering",
    blurb: "Ambient, directional, point, and spot lights for unified shading.",
  },
  {
    id: "vision-source",
    title: "vision-source",
    category: "Rendering",
    blurb: "Fog-of-war reveal source: soft radial + real line-of-sight raycasting.",
  },
  {
    id: "fog-of-war",
    title: "fog-of-war",
    category: "Rendering",
    blurb: "Scene-wide memory/never-viewed styling, and the per-frame driver for tracked-sprite phantom stand-ins.",
  },
  {
    id: "animation-controller",
    title: "animation-controller",
    category: "Animation",
    blurb: "Frame-based playback over sibling sprites.",
  },
  {
    id: "animation-map",
    title: "animation-map",
    category: "Animation",
    blurb: "Shared, reusable animation definitions referenced by controllers.",
  },
  {
    id: "input-controller",
    title: "input-controller",
    category: "Input",
    blurb: "Keyboard and pointer input mapped to registered handlers.",
  },
  {
    id: "collider",
    title: "collider",
    category: "Input",
    blurb: "Physics-style overlap queries against cell-map solidity.",
  },
  {
    id: "event-collider",
    title: "event-collider",
    category: "Input",
    blurb: "Screen-space hit regions that dispatch UI-style events.",
  },
  {
    id: "speed-dial",
    title: "speed-dial",
    category: "Input",
    blurb: "Radial menu overlay for quick actions.",
  },
  {
    id: "audio-track",
    title: "audio-track",
    category: "Audio",
    blurb: "Static audio asset handle (fetch/decode once).",
  },
  {
    id: "audio-effect",
    title: "audio-effect",
    category: "Audio",
    blurb: "WASM time-stretch / pitch effect applied to a track.",
  },
  {
    id: "audio-player",
    title: "audio-player",
    category: "Audio",
    blurb: "Playback instance for a track or effect chain.",
  },
  {
    id: "ui-overlay",
    title: "ui-overlay",
    category: "UI",
    blurb: "DOM overlay from registered HTML constructors and bindings.",
  },
  {
    id: "data-layer",
    title: "data-layer",
    category: "UI",
    blurb: "Key/value store exposed to UI overlays.",
  },
];

const byId = new Map(ENGINE_COMPONENTS.map((c) => [c.id, c]));

export function getComponentDoc(id: string): ComponentDocEntry | undefined {
  if (id === BASE_COMPONENT_DOC.id) {
    return BASE_COMPONENT_DOC;
  }
  return byId.get(id);
}

export function isValidComponentDocId(id: string): boolean {
  return id === BASE_COMPONENT_DOC.id || byId.has(id);
}
