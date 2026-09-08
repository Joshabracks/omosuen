import { ComponentMethods } from '../types';
import { SpeedDialT } from './data';
export interface SpeedDialMethods extends ComponentMethods {
    type: 'speed-dial';
    setSpeed: (dial: SpeedDialT, speed: number) => void;
    getSpeed: (dial: SpeedDialT) => number;
}
export declare const SpeedDial: SpeedDialMethods;
//# sourceMappingURL=methods.d.ts.map