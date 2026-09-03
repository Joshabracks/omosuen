import { isValidComponentDocId } from "./data/engine-components";
import { isValidPluginDocId } from "./data/plugin-components";
import type { SiteView } from "./state";

export interface ParsedSiteHash {
  view: SiteView;
  docsComponent: string | null;
}

function isValidDocsId(id: string): boolean {
  return isValidComponentDocId(id) || isValidPluginDocId(id);
}

/** Parses `#landing`, `#demo`, `#docs`, `#docs/sprite`, etc. */
export function parseSiteHash(hash: string): ParsedSiteHash {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;

  if (raw === "demo") {
    return { view: "demo", docsComponent: null };
  }

  if (raw === "docs" || raw.startsWith("docs/")) {
    const segment = raw.split("/")[1] ?? "";
    const docsComponent =
      segment && isValidDocsId(segment) ? segment : null;
    return { view: "docs", docsComponent };
  }

  return { view: "landing", docsComponent: null };
}

export function docsComponentHref(id: string): string {
  return `#docs/${id}`;
}

export function docsOverviewHref(): string {
  return "#docs";
}

export function demoHref(): string {
  return "#demo";
}

/**
 * Which engine scene a view needs. The demo is its own scene because `cell-map`
 * is a process-wide singleton — the landing hero already holds the only one, so
 * the two cannot be resident at the same time.
 */
export function sceneForView(view: SiteView): string {
  return view === "demo" ? "textris" : "site";
}
