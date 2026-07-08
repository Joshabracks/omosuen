import { parseSiteHash } from "./docs-routing";

export type SiteView = "landing" | "docs";

export interface SiteState {
  view: SiteView;
  /** Active component doc id when `view === 'docs'`, else null. */
  docsComponent: string | null;
  /** Mobile docs nav drawer; collapsed by default. */
  docsSidebarOpen: boolean;
  engineVersion: string;
}

function stateFromLocation(): Pick<SiteState, "view" | "docsComponent"> {
  if (typeof window === "undefined") {
    return { view: "landing", docsComponent: null };
  }
  return parseSiteHash(window.location.hash);
}

export const initialState: SiteState = {
  ...stateFromLocation(),
  docsSidebarOpen: false,
  engineVersion: "0.20.0",
};
