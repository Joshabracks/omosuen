/**
 * Strawberry Scene Module
 *
 * Theme: Sweet, vibrant, red/pink colors
 * Demonstrates flag-manager component with GLOBAL uniqueness
 * Exports an async function that creates and returns a scene nexus
 */

export default async function createStrawberryScene() {
  // Import Omosuen from the global scope (loaded by main HTML)
  const { newComponent, $, switchScene } = window.Omosuen;

  // Create root nexus for the scene
  const root = await newComponent('nexus', { name: 'StrawberrySceneRoot' });

  if (!root) {
    console.error('[Strawberry Scene] Failed to create root nexus');
    return null;
  }

  // Create flag-manager component (GLOBAL unique - only one per scene)
  const flagManager = await newComponent('flag-manager', { name: 'Game Flags' });

  if (!flagManager) {
    console.error('[Strawberry Scene] Failed to create flag-manager');
    return root;
  }

  // Initialize with some flags using $ Proxy
  $.addFlags(flagManager, [
    'strawberrySceneVisited',
    'tutorialComplete',
    'level1Complete',
    'secretFound'
  ]);

  // Create UI Overlay with strawberry theme and custom update method
  const overlay = await newComponent('ui-overlay', {
    name: 'StrawberryOverlay',
    update: function(deltaTime) {
      // Get flags display element
      const flagsDisplay = document.getElementById('flags-display');

      if (!flagsDisplay) {
        return; // Element not ready yet
      }

      // Get all flags from flag-manager using $ Proxy
      const allFlags = $.getFlags(flagManager);

      // Format the flags display
      if (allFlags.length === 0) {
        flagsDisplay.innerHTML = '<div style="opacity: 0.7;">No flags set yet</div>';
      } else {
        flagsDisplay.innerHTML = allFlags
          .map(flag => `<div>✓ ${flag}</div>`)
          .join('');
      }

      // Update flag count
      const flagCount = document.getElementById('flag-count');
      if (flagCount) {
        flagCount.textContent = allFlags.length;
      }
    },
    html: `
      <div id="strawberry-container" style="
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #FF1744 0%, #FF6B9D 100%);
        color: white;
        padding: 50px;
        border: 4px solid #C51162;
        border-radius: 25px;
        box-shadow: 0 20px 60px rgba(255, 23, 68, 0.4);
        font-family: 'Georgia', 'Times New Roman', serif;
        text-align: center;
        max-width: 600px;
        min-width: 400px;
      ">
        <h1 style="
          margin: 0 0 10px 0;
          font-size: 48px;
          text-shadow: 2px 2px 8px rgba(0,0,0,0.3);
          font-weight: bold;
        ">🍓 Strawberry Scene</h1>

        <p style="
          margin: 0 0 20px 0;
          font-size: 20px;
          font-weight: bold;
          text-shadow: 1px 1px 3px rgba(0,0,0,0.2);
        ">
          Sweet strawberry fields forever!
        </p>

        <div style="
          background: rgba(0,0,0,0.2);
          padding: 20px;
          border-radius: 10px;
          margin-bottom: 20px;
          font-size: 14px;
          text-align: left;
        ">
          <h3 style="margin: 0 0 10px 0; font-size: 18px; text-align: center;">
            🚩 Flag Manager (<span id="flag-count">0</span> flags)
          </h3>
          <div id="flags-display" style="line-height: 1.8; max-height: 200px; overflow-y: auto;">
            <!-- Dynamic content updated by flag-manager -->
          </div>
          <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.3); text-align: center; font-size: 12px; opacity: 0.8;">
            Flag manager is GLOBAL unique - only one per scene
          </div>
        </div>

        <p style="
          margin: 0 0 30px 0;
          font-size: 16px;
          opacity: 0.9;
          font-style: italic;
        ">
          Loaded from JavaScript module: strawberry-scene.js
        </p>

        <div style="display: flex; gap: 15px; justify-content: center;">
          <button id="btn-banana" style="
            background: #FFD700;
            color: #000;
            border: none;
            padding: 15px 30px;
            font-size: 16px;
            font-weight: bold;
            border-radius: 15px;
            cursor: pointer;
            box-shadow: 0 4px 6px rgba(0,0,0,0.2);
            transition: transform 0.2s, box-shadow 0.2s;
          " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 12px rgba(0,0,0,0.3)';"
             onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px rgba(0,0,0,0.2)';">
            🍌 Go to Banana
          </button>

          <button id="btn-avocado" style="
            background: #7CB342;
            color: white;
            border: none;
            padding: 15px 30px;
            font-size: 16px;
            font-weight: bold;
            border-radius: 15px;
            cursor: pointer;
            box-shadow: 0 4px 6px rgba(0,0,0,0.2);
            transition: transform 0.2s, box-shadow 0.2s;
          " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 12px rgba(0,0,0,0.3)';"
             onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px rgba(0,0,0,0.2)';">
            🥑 Go to Avocado
          </button>
        </div>

        <div style="margin-top: 20px; font-size: 12px; opacity: 0.7;">
          <p>Flags update every frame using ui-overlay update() method</p>
        </div>
      </div>
    `,
    cssOverrides: {
      display: 'block',
      pointerEvents: 'auto',
      zIndex: '1000'
    },
    bindings: [
      {
        selector: '#btn-banana',
        onActions: ['click'],
        method: async (e) => {
          console.log('[Strawberry Scene] Navigating to Banana scene');
          await switchScene('BananaScene');
        }
      },
      {
        selector: '#btn-avocado',
        onActions: ['click'],
        method: async (e) => {
          console.log('[Strawberry Scene] Navigating to Avocado scene');
          await switchScene('AvocadoScene');
        }
      }
    ]
  });

  if (!overlay) {
    console.error('[Strawberry Scene] Failed to create UI overlay');
    return root;
  }

  // Add both components to root
  $.addComponent(root, flagManager);
  $.addComponent(root, overlay);

  // Apply bindings to set up event listeners
  $.applyBindings(overlay);

  console.log('[Strawberry Scene] Scene created successfully with flag-manager');
  console.log('[Strawberry Scene] Initial flags:', $.getFlags(flagManager));

  return root;
}
