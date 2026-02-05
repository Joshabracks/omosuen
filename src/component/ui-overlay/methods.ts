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
      // @ts-ignore
      UIOverlay[u.hideOverride](u)
    } else {
      u.container.style.display = "none";
    }
  },

  show(u: ui_overlay) {
    if (u.showOverride) {
      // @ts-ignore
      UIOverlay[u.showOverride](u)
    } else {
      u.container.style.display = "block";
    }
  },

  back(u: ui_overlay) {
    if (u.hideOverride) {
      // @ts-ignore
      UIOverlay[u.hideOverride](u);
    }
    else if (UIOverlay.hide) {
      UIOverlay.hide(u);
    }
    if (u.previousOverlay?.showOverride) {
      // @ts-ignore
      UIOverlay[u.previousOverlay.showOverride](u.previousOverlay)
    }
    else if (u.previousOverlay && UIOverlay.show) {
      UIOverlay.show(u.previousOverlay);
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

    u.bindings = [];
    u.element = null;
    u._disposed = true;
  }
};
