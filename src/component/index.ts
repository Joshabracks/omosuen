export * from './types';
export * from './registry';

// Re-export component-specific types and methods (but not builders to avoid conflicts)
export type { NexusT as nexus, NexusMethods } from './nexus';
export type {
  UIOverlayT as ui_overlay,
  UIOverlayMethods,
  UIBinding,
} from './ui-overlay';
export type {
  DataLayer as data_layer,
  DataLayerMethods,
  DataLayerType,
} from './data-layer';
export type {
  FlagManagerT as flag_manager,
  FlagManagerMethods,
} from './flag-manager';

// Export ComponentUnique enum for developers to use
export { ComponentUnique } from './types';

// Export serializers for scene management
export { NexusSerializer } from './nexus/data';
export { UIOverlaySerializer } from './ui-overlay/data';
export { DataLayerSerializer } from './data-layer/data';
export { FlagManagerSerializer } from './flag-manager/data';
