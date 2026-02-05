/**
 * Avocado Scene Module
 *
 * Theme: Fresh, healthy, green colors
 * Exports an async function that creates and returns a scene nexus
 */

export default async function createAvocadoScene() {
  // Import Omosuen from the global scope (loaded by main HTML)
  const { newComponent, $, switchScene } = window.Omosuen;

  // Create root nexus for the scene
  const root = await newComponent('nexus', { name: 'AvocadoSceneRoot' });

  if (!root) {
    console.error('[Avocado Scene] Failed to create root nexus');
    return null;
  }

  // Create UI Overlay with avocado theme
  const overlay = await newComponent('ui-overlay', {
    name: 'AvocadoOverlay',
    html: `
      <div id="avocado-container" style="
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #558B2F 0%, #9CCC65 100%);
        color: white;
        padding: 50px;
        border: 4px solid #33691E;
        border-radius: 20px 40px 20px 40px;
        box-shadow: 0 20px 60px rgba(85, 139, 47, 0.4);
        font-family: 'Helvetica Neue', 'Arial', sans-serif;
        text-align: center;
        max-width: 500px;
        min-width: 400px;
      ">
        <h1 style="
          margin: 0 0 10px 0;
          font-size: 48px;
          text-shadow: 2px 2px 6px rgba(0,0,0,0.3);
          font-weight: 300;
          letter-spacing: 2px;
        ">🥑 Avocado Scene</h1>

        <p style="
          margin: 0 0 30px 0;
          font-size: 20px;
          font-weight: 400;
          text-shadow: 1px 1px 2px rgba(0,0,0,0.2);
        ">
          Fresh and healthy avocado vibes!
        </p>

        <p style="
          margin: 0 0 30px 0;
          font-size: 16px;
          opacity: 0.9;
          font-style: italic;
        ">
          Loaded from JavaScript module: avocado-scene.js
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

          <button id="btn-strawberry" style="
            background: #FF1744;
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
            🍓 Go to Strawberry
          </button>
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
          console.log('[Avocado Scene] Navigating to Banana scene');
          await switchScene('BananaScene');
        }
      },
      {
        selector: '#btn-strawberry',
        onActions: ['click'],
        method: async (e) => {
          console.log('[Avocado Scene] Navigating to Strawberry scene');
          await switchScene('StrawberryScene');
        }
      }
    ]
  });

  if (!overlay) {
    console.error('[Avocado Scene] Failed to create UI overlay');
    return root;
  }

  // Add overlay to root
  $.addComponent(root, overlay);

  // Apply bindings to set up event listeners
  $.applyBindings(overlay);

  console.log('[Avocado Scene] Scene created successfully');
  return root;
}
