/** Draws one frame's pixels with its top-left at (x, y); the cell is pre-clipped. */
export type CellPainter = (ctx: CanvasRenderingContext2D, x: number, y: number) => void;
/**
 * Cells are append-only within a *generation*: a released cell's slot is never
 * reused in place, because the atlas dedups frames by (filePath, source rect) —
 * redrawing a slot under the same path could make the atlas keep serving the
 * old pixels. Instead, once dead cells outnumber live ones the canvas is
 * repacked into a new generation with a new synthetic filePath, so every frame
 * gets a fresh atlas key and the old ones are reclaimed.
 */
export declare class LayerTexture {
    readonly key: string;
    private readonly basePath;
    private readonly cellW;
    private readonly cellH;
    /** The texture-map component, once there's something to show. */
    tm: any | null;
    private generation;
    private canvas;
    private ctx;
    private readonly cols;
    private rows;
    private readonly cells;
    private nextSlot;
    private dead;
    private changed;
    private compacted;
    private pathsToEvict;
    constructor(key: string, basePath: string, cellW: number, cellH: number);
    /** The synthetic source path the atlas keys this texture's frames by. */
    get filePath(): string;
    get frameCount(): number;
    has(frame: number): boolean;
    /**
     * Takes a reference on `frame`, drawing it with `paint` the first time anyone
     * holds it.
     */
    acquire(frame: number, w: number, h: number, paint: CellPainter): void;
    /** Drops a reference on `frame`; the frame leaves the texture at zero. */
    release(frame: number): void;
    /** True when this texture's component is still the one the atlas serves. */
    isLive(atlasManager: any): boolean;
    /**
     * Pushes pending changes to the texture-map: creates it on first content,
     * repacks when dead cells dominate, rewrites `originalFrames`, and disposes it
     * once empty. Returns whether the atlas needs a compile to pick changes up.
     */
    commit(owner: any, atlasManager: any): Promise<boolean>;
    /** Disposes the component outright (scene teardown / last holder gone). */
    disposeComponent(atlasManager: any): void;
    private reset;
    private originalFrames;
    /** Grows the grid downward, or repacks if there's dead space to win back. */
    private makeRoom;
    /** Repacks live cells, in frame order, into a fresh generation. */
    private compact;
}
