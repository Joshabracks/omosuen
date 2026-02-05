import { ComponentMethod } from "../registry";
import { ComponentData, ComponentMethods, ComponentOptions } from "../types";
import { ui_overlay, UIBinding, UIOverlayOptions } from "./data";

export interface UIOverlayMethods extends ComponentMethods {
  hide?: (u: ui_overlay) => void;
  show?: (u: ui_overlay) => void;
  back: (u: ui_overlay) => void;
  applyBindings: (u: ui_overlay) => void;
}

export const UIOverlay: UIOverlayMethods = {
  type: 'ui-overlay',
  hide(u: ui_overlay) {
    if (u.hideOverride) {
      // @ts-ignore - Dynamic method access via registered override
      const overrideMethod = UIOverlay[u.hideOverride];
      if (overrideMethod && typeof overrideMethod === "function") {
        overrideMethod(u);
      } else {
        console.warn(
          `[ui-overlay] Custom hide method '${u.hideOverride}' not found for '${u.name}'. Using default behavior.`
        );
        u.container.style.display = "none";
      }
    } else {
      u.container.style.display = "none";
    }
  },

  show(u: ui_overlay) {
    if (u.showOverride) {
      // @ts-ignore - Dynamic method access via registered override
      const overrideMethod = UIOverlay[u.showOverride];
      if (overrideMethod && typeof overrideMethod === "function") {
        overrideMethod(u);
      } else {
        console.warn(
          `[ui-overlay] Custom show method '${u.showOverride}' not found for '${u.name}'. Using default behavior.`
        );
        u.container.style.display = "block";
      }
    } else {
      u.container.style.display = "block";
    }
  },

  back(u: ui_overlay) {
    // Hide current overlay
    if (u.hideOverride) {
      // @ts-ignore - Dynamic method access via registered override
      const overrideMethod = UIOverlay[u.hideOverride];
      if (overrideMethod && typeof overrideMethod === "function") {
        overrideMethod(u);
      } else {
        console.warn(
          `[ui-overlay] Custom hide method '${u.hideOverride}' not found for '${u.name}'. Using default behavior.`
        );
        if (UIOverlay.hide) {
          UIOverlay.hide(u);
        }
      }
    } else if (UIOverlay.hide) {
      UIOverlay.hide(u);
    }

    // Show previous overlay
    if (u.previousOverlay) {
      if (u.previousOverlay.showOverride) {
        // @ts-ignore - Dynamic method access via registered override
        const overrideMethod = UIOverlay[u.previousOverlay.showOverride];
        if (overrideMethod && typeof overrideMethod === "function") {
          overrideMethod(u.previousOverlay);
        } else {
          console.warn(
            `[ui-overlay] Custom show method '${u.previousOverlay.showOverride}' not found for '${u.previousOverlay.name}'. Using default behavior.`
          );
          if (UIOverlay.show) {
            UIOverlay.show(u.previousOverlay);
          }
        }
      } else if (UIOverlay.show) {
        UIOverlay.show(u.previousOverlay);
      }
    }
  },

  applyBindings(u: ui_overlay) {
    u.bindings.forEach((binding: UIBinding) => {
      const elements = Array.from(document.querySelectorAll(binding.selector));
      if (!elements.length) return;
      elements.forEach((element: Element) =>
        binding.onActions.forEach((action: string) =>
          element.addEventListener(action, binding.method),
        ),
      );
    });
  },

  dispose(c: ComponentData) {
    // Remove event listeners
    const u = c as ui_overlay;
    u.bindings.forEach((binding) => {
      const elements = document.querySelectorAll(binding.selector);
      elements.forEach((element) => {
        binding.onActions.forEach((action) => {
          element.removeEventListener(action, binding.method);
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
  }
};
