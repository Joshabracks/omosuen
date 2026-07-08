import type { SiteState } from "./state";

export interface SiteCtx {
  state: { data: SiteState };
  target?: string;
  text?: string;
}
