import type { SiteState, SiteView } from "./state";

export interface SiteCtx {
  state: { data: SiteState };
  target?: string;
  text?: string;
  view?: SiteView;
  docsComponent?: string | null;
}
