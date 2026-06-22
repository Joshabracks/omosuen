export interface Animation {
    name: string;
    frames: number[];
    frameRate: number;
    loop: boolean;
    onComplete?: string;
}
export type AnimationState = 'playing' | 'paused' | 'stopped';
//# sourceMappingURL=types.d.ts.map