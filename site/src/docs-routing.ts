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

/** Parses `#landing`, `#docs`, `#docs/sprite`, etc. */
export function parseSiteHash(hash: string): ParsedSiteHash {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;

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
