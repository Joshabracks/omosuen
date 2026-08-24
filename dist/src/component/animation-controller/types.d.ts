export interface Animation {
    name: string;
    frames: number[];
    frameRate: number;
    frameDurations?: number[];
    loop: boolean;
    onComplete?: string;
}
export interface AnimationLayer {
    name: string;
    spriteName: string;
    slot?: string;
    visible: boolean;
}
export type AnimationState = 'playing' | 'paused' | 'stopped';
//# sourceMappingURL=types.d.ts.map