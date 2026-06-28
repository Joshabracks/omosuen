import { ComponentData, ComponentMethods } from '../types';
import { FlagManagerT } from './data';
export interface FlagManagerMethods extends ComponentMethods {
    hasFlag: (fm: FlagManagerT, flag: string) => boolean;
    hasAllFlags: (fm: FlagManagerT, flags: string | string[]) => boolean;
    hasAnyFlag: (fm: FlagManagerT, flags: string | string[]) => boolean;
    hasNoneOfFlags: (fm: FlagManagerT, flags: string | string[]) => boolean;
    addFlag: (fm: FlagManagerT, flag: string) => void;
    addFlags: (fm: FlagManagerT, flags: string[]) => void;
    removeFlag: (fm: FlagManagerT, flag: string) => void;
    removeFlags: (fm: FlagManagerT, flags: string[]) => void;
    getFlags: (fm: FlagManagerT) => string[];
    clearFlags: (fm: FlagManagerT) => void;
    dispose: (component: ComponentData) => void;
}
export declare const FlagManager: FlagManagerMethods;
//# sourceMappingURL=methods.d.ts.map