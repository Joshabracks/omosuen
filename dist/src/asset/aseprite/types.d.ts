export interface AseLayer {
    index: number;
    name: string;
    visible: boolean;
    type: number;
    childLevel: number;
    blendMode: number;
    opacity: number;
}
export interface AseCel {
    layerIndex: number;
    x: number;
    y: number;
    w: number;
    h: number;
    opacity: number;
    pixels: Uint8Array | null;
    linkedFrame?: number;
}
export interface AseFrame {
    durationMs: number;
    cels: AseCel[];
}
export interface AseTag {
    name: string;
    from: number;
    to: number;
    loopDir: number;
    repeat: number;
}
export interface AseFile {
    width: number;
    height: number;
    colorDepth: number;
    frameCount: number;
    layers: AseLayer[];
    frames: AseFrame[];
    tags: AseTag[];
}
//# sourceMappingURL=types.d.ts.map