import type State from "./State.js";
export declare function register(state: State): string;
export declare function get(id: string): State | undefined;
export declare function unregister(id: string): void;
