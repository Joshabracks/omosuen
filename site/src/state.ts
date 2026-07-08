export interface SiteState {
  view: string;
  engineVersion: string;
}

export const initialState: SiteState = {
  view: "landing",
  engineVersion: "0.20.0",
};
