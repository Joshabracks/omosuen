import { ComponentData, ComponentMethods } from '../types';
import { UIOverlayT, UIBinding } from './data';
import { getHtmlConstructor } from '../registry';
import { getActiveScene } from '../../scene';

export interface UIOverlayMethods extends ComponentMethods {
  hide?: (u: UIOverlayT) => void;
  show?: (u: UIOverlayT) => void;
  back: (u: UIOverlayT) => void;
  applyBindings: (u: UIOverlayT) => void;
  init: (component: ComponentData) => Promise<void>;
  update: (component: ComponentData, deltaTime: number) => void;
}

export const UIOverlay: UIOverlayMethods = {
  type: 'ui-overlay',
  hide(u: UIOverlayT) {
    if (u.hideOverride) {
      // @ts-expect-error - Dynamic method access via registered override
      const overrideMethod = UIOverlay[u.hideOverride];
      if (overrideMethod && typeof overrideMethod === 'function') {
        overrideMethod(u);
      } else {
        console.warn(
          `[ui-overlay] Custom hide method '${u.hideOverride}' not found for '${u.name}'. Using default behavior.`,
        );
        u.container.style.display = 'none';
      }
    } else {
      u.container.style.display = 'none';
    }
  },

  show(u: UIOverlayT) {
    if (u.showOverride) {
      // @ts-expect-error - Dynamic method access via registered override
      const overrideMethod = UIOverlay[u.showOverride];
      if (overrideMethod && typeof overrideMethod === 'function') {
        overrideMethod(u);
      } else {
        console.warn(
          `[ui-overlay] Custom show method '${u.showOverride}' not found for '${u.name}'. Using default behavior.`,
        );
        u.container.style.display = 'block';
      }
    } else {
      u.container.style.display = 'block';
    }
  },

  back(u: UIOverlayT) {
    // Hide current overlay
    if (u.hideOverride) {
      // @ts-expect-error - Dynamic method access via registered override
      const overrideMethod = UIOverlay[u.hideOverride];
      if (overrideMethod && typeof overrideMethod === 'function') {
        overrideMethod(u);
      } else {
        console.warn(
          `[ui-overlay] Custom hide method '${u.hideOverride}' not found for '${u.name}'. Using default behavior.`,
        );
        if (UIOverlay.hide) {
          UIOverlay.hide(u);
        }
      }
    } else if (UIOverlay.hide) {
      UIOverlay.hide(u);
    }

    // Show previous overlay (look up by ID)
    if (u.previousOverlayId !== undefined) {
      const scene = getActiveScene();
      if (!scene) {
        console.warn(
          `[ui-overlay] Cannot navigate back from '${u.name}' - no active scene`,
        );
        return;
      }

      // @ts-expect-error - getComponentById exists but not in type def yet
      const previousOverlay = scene.getComponentById(
        u.previousOverlayId,
        true,
      ) as UIOverlayT | null;

      if (!previousOverlay) {
        console.warn(
          `[ui-overlay] Previous overlay with ID ${u.previousOverlayId} not found for '${u.name}'`,
        );
        return;
      }

      if (previousOverlay.showOverride) {
        // @ts-expect-error - Dynamic method access via registered override
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const overrideMethod = UIOverlay[previousOverlay.showOverride];
        if (overrideMethod && typeof overrideMethod === 'function') {
          overrideMethod(previousOverlay);
        } else {
          console.warn(
            `[ui-overlay] Custom show method '${previousOverlay.showOverride}' not found for '${previousOverlay.name}'. Using default behavior.`,
          );
          if (UIOverlay.show) {
            UIOverlay.show(previousOverlay);
          }
        }
      } else if (UIOverlay.show) {
        UIOverlay.show(previousOverlay);
      }
    }
  },

  async init(component: ComponentData): Promise<void> {
    const u = component as UIOverlayT;
    // Append container to DOM during init (after scene is loaded)
    if (u.container && !u.container.parentNode) {
      document.body.appendChild(u.container);
    }
  },

  update(component: ComponentData, _deltaTime: number) {
    const u = component as UIOverlayT;

    // Construct HTML on first update if htmlConstructorKey is set
    if (!u._htmlConstructed && u.htmlConstructorKey) {
      const constructor = getHtmlConstructor(u.htmlConstructorKey);
      if (constructor) {
        try {
          const html = constructor(u);
          u.container.innerHTML = html;
          // Apply bindings automatically after HTML construction
          UIOverlay.applyBindings(u);
          u._htmlConstructed = true;
        } catch (error) {
          console.error(
            `[ui-overlay] Failed to construct HTML for '${u.name}' using constructor '${u.htmlConstructorKey}':`,
            error,
          );
        }
      } else {
        console.warn(
          `[ui-overlay] HTML constructor '${u.htmlConstructorKey}' not found for component '${u.name}'. ` +
            `Call registerHtmlConstructor('${u.htmlConstructorKey}', func) before loading this component.`,
        );
        u._htmlConstructed = true; // Don't keep trying
      }
    }
  },

  applyBindings(u: UIOverlayT) {
    u.bindings.forEach((binding: UIBinding) => {
      if (!binding._methodFunc) {
        console.warn(
          `[ui-overlay] Skipping binding for '${binding.selector}' - method '${binding.methodKey}' not found`,
        );
        return;
      }

      const elements = Array.from(document.querySelectorAll(binding.selector));
      if (!elements.length) return;

      elements.forEach((element: Element) =>
        binding.onActions.forEach((action: string) =>
          element.addEventListener(
            action,
            binding._methodFunc as EventListener,
          ),
        ),
      );
    });
  },

  dispose(c: ComponentData) {
    // Remove event listeners
    const u = c as UIOverlayT;
    u.bindings.forEach((binding) => {
      if (!binding._methodFunc) return;

      const elements = document.querySelectorAll(binding.selector);
      elements.forEach((element) => {
        binding.onActions.forEach((action) => {
          element.removeEventListener(
            action,
            binding._methodFunc as EventListener,
          );
        });
      });
    });

    // Remove element from DOM
    if (u.element && u.element.parentNode) {
      u.element.parentNode.removeChild(u.element);
    }

    // TODO: Clean up registered override methods when no more components
    // with the same overrideKey exist. This requires an activeScene/component
    // tracking system to efficiently determine if other components are still
    // using the same overrideKey. When implemented, use unregisterComponentMethod()
    // to clean up methods like: unregisterComponentMethod('ui-overlay', u.showOverride)

    u.bindings = [];
    u.element = null;
    u._disposed = true;
  },
};
