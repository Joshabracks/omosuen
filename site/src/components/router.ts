import { parseSiteHash } from "../docs-routing";
import type { SiteCtx } from "../types";

let hashRouterBound = false;

/** Syncs view + docs component when the user uses hash links or history navigation. */
export function siteRouter(ctx: SiteCtx): string {
  if (typeof window === "undefined" || hashRouterBound) {
    return "";
  }
  hashRouterBound = true;

  const applyHash = (): void => {
    const parsed = parseSiteHash(window.location.hash);
    ctx.state.data.view = parsed.view;
    ctx.state.data.docsComponent = parsed.docsComponent;
    ctx.state.data.docsSidebarOpen = false;
  };

  window.addEventListener("hashchange", applyHash);
  return "";
}
