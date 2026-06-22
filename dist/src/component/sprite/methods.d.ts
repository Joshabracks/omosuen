import { ComponentData, ComponentMethods } from '../types';
import { SpriteT } from './data';
export type ChannelType = 'albedo' | 'normal' | 'material' | 'emission';
export interface SpriteMethods extends ComponentMethods {
    init: (component: ComponentData) => Promise<void>;
    setFrame: (sprite: SpriteT, index: number, channels?: ChannelType | ChannelType[]) => void;
    setTint: (sprite: SpriteT, r: number, g: number, b: number, a: number) => void;
    setOpacity: (sprite: SpriteT, alpha: number) => void;
}
export declare const Sprite: SpriteMethods;
//# sourceMappingURL=methods.d.ts.map