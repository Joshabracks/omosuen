// A texture-map whose frames come and go: one per (shared) sprite layer, holding
// exactly the frames some entity currently needs. Frames are reference counted,
// drawn once into a cell of a grid canvas, and dropped from the texture-map's
// `originalFrames` when the last holder releases them — which is what lets the
// atlas-manager reclaim their atlas space on its next compile.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Vector2D, markForDisposal, newComponent } from 'omosuen';
/** Grid canvases stay at or under this width, growing downward. */
const TARGET_WIDTH = 2048;
/** Canvas dimension ceiling (well inside every evergreen browser's limit). */
const MAX_DIMENSION = 16384;
/** Compact once at least this many released cells are dead weight… */
const COMPACT_MIN_DEAD = 32;
/**
 * Cells are append-only within a *generation*: a released cell's slot is never
 * reused in place, because the atlas dedups frames by (filePath, source rect) —
 * redrawing a slot under the same path could make the atlas keep serving the
 * old pixels. Instead, once dead cells outnumber live ones the canvas is
 * repacked into a new generation with a new synthetic filePath, so every frame
 * gets a fresh atlas key and the old ones are reclaimed.
 */
export class LayerTexture {
    constructor(key, basePath, cellW, cellH) {
        this.key = key;
        this.basePath = basePath;
        this.cellW = cellW;
        this.cellH = cellH;
        /** The texture-map component, once there's something to show. */
        this.tm = null;
        this.generation = 0;
        this.cells = new Map();
        this.nextSlot = 0;
        this.dead = 0;
        this.changed = false;
        this.compacted = false;
        this.pathsToEvict = [];
        this.cols = Math.max(1, Math.floor(TARGET_WIDTH / cellW));
        this.rows = 1;
        this.canvas = createCanvas(this.cols * cellW, cellH);
        this.ctx = get2d(this.canvas);
    }
    /** The synthetic source path the atlas keys this texture's frames by. */
    get filePath() {
        return this.generation === 0 ? this.basePath : `${this.basePath}#${this.generation}`;
    }
    get frameCount() {
        return this.cells.size;
    }
    has(frame) {
        return this.cells.has(frame);
    }
    /**
     * Takes a reference on `frame`, drawing it with `paint` the first time anyone
     * holds it.
     */
    acquire(frame, w, h, paint) {
        const existing = this.cells.get(frame);
        if (existing) {
            existing.refs++;
            return;
        }
        if (this.nextSlot >= this.cols * this.rows)
            this.makeRoom();
        const slot = this.nextSlot++;
        const x = (slot % this.cols) * this.cellW;
        const y = Math.floor(slot / this.cols) * this.cellH;
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(x, y, w, h);
        this.ctx.clip(); // a cel hanging off its frame never bleeds into a neighbour
        paint(this.ctx, x, y);
        this.ctx.restore();
        this.cells.set(frame, { slot, refs: 1, w, h });
        this.changed = true;
    }
    /** Drops a reference on `frame`; the frame leaves the texture at zero. */
    release(frame) {
        const cell = this.cells.get(frame);
        if (!cell)
            return;
        if (--cell.refs > 0)
            return;
        this.cells.delete(frame);
        this.dead++;
        this.changed = true;
    }
    /** True when this texture's component is still the one the atlas serves. */
    isLive(atlasManager) {
        if (!this.tm)
            return this.cells.size === 0;
        if (this.tm._disposed)
            return false;
        const registered = atlasManager.getTextureMap(this.key);
        return !!registered && registered.id === this.tm.id;
    }
    /**
     * Pushes pending changes to the texture-map: creates it on first content,
     * repacks when dead cells dominate, rewrites `originalFrames`, and disposes it
     * once empty. Returns whether the atlas needs a compile to pick changes up.
     */
    async commit(owner, atlasManager) {
        if (!this.changed && !this.compacted)
            return false;
        if (this.cells.size === 0) {
            this.disposeComponent(atlasManager);
            this.reset();
            return true;
        }
        if (this.dead >= COMPACT_MIN_DEAD && this.dead > this.cells.size)
            this.compact();
        if (!this.tm) {
            const tm = await newComponent('texture-map', {
                name: this.key,
                textureMapKey: this.key,
                filePath: this.filePath,
                sourceImage: this.canvas,
                // Frames are set directly below (sparse, absolute frame indices),
                // bypassing extractOriginalFrames's array-position-tied layout.
                imageType: [],
            }, owner);
            if (!tm)
                throw new Error(`[image-loader] failed to create texture-map '${this.key}'`);
            tm._generated = true;
            tm.originalFrames = this.originalFrames();
            this.tm = tm;
            atlasManager.addTextureMap(tm);
        }
        else {
            this.tm.filePath = this.filePath;
            this.tm.sourceImage = this.canvas;
            this.tm.originalFrames = this.originalFrames();
        }
        for (const path of this.pathsToEvict)
            atlasManager.removeImage(path);
        this.pathsToEvict = [];
        this.changed = false;
        this.compacted = false;
        return true;
    }
    /** Disposes the component outright (scene teardown / last holder gone). */
    disposeComponent(atlasManager) {
        if (!this.tm)
            return;
        const tm = this.tm;
        this.tm = null;
        // `dispose()` drops it from the atlas registry immediately — an empty
        // texture-map left registered would be packed as one whole-image frame.
        // `markForDisposal` then detaches it from the tree at end of frame.
        tm.dispose();
        markForDisposal(tm);
        atlasManager.removeImage(this.filePath);
    }
    reset() {
        this.generation++; // a later re-creation never reuses an old atlas key
        this.rows = 1;
        this.canvas = createCanvas(this.cols * this.cellW, this.cellH);
        this.ctx = get2d(this.canvas);
        this.nextSlot = 0;
        this.dead = 0;
        this.changed = false;
        this.compacted = false;
        this.pathsToEvict = [];
    }
    originalFrames() {
        const frames = Array.from(this.cells.entries()).sort((a, b) => a[0] - b[0]);
        return frames.map(([frameIndex, c]) => ({
            frameIndex,
            position: new Vector2D((c.slot % this.cols) * this.cellW, Math.floor(c.slot / this.cols) * this.cellH),
            size: new Vector2D(c.w, c.h),
        }));
    }
    /** Grows the grid downward, or repacks if there's dead space to win back. */
    makeRoom() {
        if (this.dead > 0 && this.dead >= this.cells.size) {
            this.compact();
            if (this.nextSlot < this.cols * this.rows)
                return;
        }
        const needRows = Math.floor(this.nextSlot / this.cols) + 1;
        const rows = Math.max(needRows, this.rows * 2);
        const maxRows = Math.floor(MAX_DIMENSION / this.cellH);
        const newRows = Math.min(rows, maxRows);
        if (newRows < needRows) {
            throw new Error(`[image-loader] texture '${this.key}' is full (${this.cells.size} frames of ` +
                `${this.cellW}×${this.cellH}); select fewer frames`);
        }
        const next = createCanvas(this.cols * this.cellW, newRows * this.cellH);
        const ctx = get2d(next);
        ctx.drawImage(this.canvas, 0, 0);
        this.canvas = next;
        this.ctx = ctx;
        this.rows = newRows;
    }
    /** Repacks live cells, in frame order, into a fresh generation. */
    compact() {
        const live = Array.from(this.cells.entries()).sort((a, b) => a[0] - b[0]);
        const rows = Math.max(1, Math.ceil(live.length / this.cols));
        const next = createCanvas(this.cols * this.cellW, rows * this.cellH);
        const ctx = get2d(next);
        live.forEach(([, cell], slot) => {
            const sx = (cell.slot % this.cols) * this.cellW;
            const sy = Math.floor(cell.slot / this.cols) * this.cellH;
            const dx = (slot % this.cols) * this.cellW;
            const dy = Math.floor(slot / this.cols) * this.cellH;
            ctx.drawImage(this.canvas, sx, sy, this.cellW, this.cellH, dx, dy, this.cellW, this.cellH);
            cell.slot = slot;
        });
        this.pathsToEvict.push(this.filePath);
        this.generation++;
        this.canvas = next;
        this.ctx = ctx;
        this.rows = rows;
        this.nextSlot = live.length;
        this.dead = 0;
        this.compacted = true;
    }
}
function createCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
}
function get2d(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('[aseprite] failed to acquire a 2D canvas context');
    return ctx;
}
