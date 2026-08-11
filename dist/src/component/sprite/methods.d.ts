import { ComponentData, ComponentMethods } from '../types';
import { SpriteT } from './data';
import { Vector3D } from '../../math';
export type ChannelType = 'albedo' | 'normal' | 'material' | 'emission';
export interface SpriteMethods extends ComponentMethods {
    init: (component: ComponentData) => Promise<void>;
    setFrame: (sprite: SpriteT, index: number, channels?: ChannelType | ChannelType[]) => void;
    setTint: (sprite: SpriteT, r: number, g: number, b: number, a: number) => void;
    setOpacity: (sprite: SpriteT, alpha: number) => void;
    setVisible: (sprite: SpriteT, visible: boolean) => void;
    setRenderOrder: (sprite: SpriteT, order: number) => void;
    setEmissionIntensity: (sprite: SpriteT, intensity: number) => void;
    setEmissionColor: (sprite: SpriteT, r: number, g: number, b: number) => void;
    getEmissionColor: (sprite: SpriteT) => Vector3D;
}
export declare const Sprite: SpriteMethods;
//# sourceMappingURL=methods.d.ts.map