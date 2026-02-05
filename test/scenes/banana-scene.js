/**
 * Banana Scene Module
 *
 * Theme: Tropical, playful, yellow/gold colors
 * Exports an async function that creates and returns a scene nexus
 */

export default async function createBananaScene() {
  // Import Omosuen from the global scope (loaded by main HTML)
  const { newComponent, $, switchScene } = window.Omosuen;

  // Create root nexus for the scene
  const root = await newComponent('nexus', { name: 'BananaSceneRoot' });

  if (!root) {
    console.error('[Banana Scene] Failed to create root nexus');
    return null;
  }

  // Create UI Overlay with banana theme
  const overlay = await newComponent('ui-overlay', {
    name: 'BananaOverlay',
    html: `
      <div id="banana-container" style="
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
        color: #000;
        padding: 50px;
        border: 4px solid #FF8C00;
        border-radius: 30px;
        box-shadow: 0 20px 60px rgba(255, 215, 0, 0.4);
        font-family: 'Comic Sans MS', 'Arial', sans-serif;
        text-align: center;
        max-width: 500px;
        min-width: 400px;
      ">
        <h1 style="
          margin: 0 0 10px 0;
          font-size: 48px;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
        ">🍌 Banana Scene</h1>

        <p style="
          margin: 0 0 30px 0;
          font-size: 20px;
          font-weight: bold;
          color: #333;
        ">
          Welcome to the tropical banana paradise!
        </p>

        <p style="
          margin: 0 0 30px 0;
          font-size: 16px;
          color: #555;
          font-style: italic;
        ">
          Loaded from JavaScript module: banana-scene.js
        </p>

        <div style="display: flex; gap: 15px; justify-content: center;">
          <button id="btn-strawberry" style="
            background: #FF69B4;
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
      </div>
    `,
    cssOverrides: {
      display: 'block',
      pointerEvents: 'auto',
      zIndex: '1000'
    },
    bindings: [
      {
        selector: '#btn-strawberry',
        onActions: ['click'],
        method: async (e) => {
          console.log('[Banana Scene] Navigating to Strawberry scene');
          await switchScene('StrawberryScene');
        }
      },
      {
        selector: '#btn-avocado',
        onActions: ['click'],
        method: async (e) => {
          console.log('[Banana Scene] Navigating to Avocado scene');
          await switchScene('AvocadoScene');
        }
      }
    ]
  });

  if (!overlay) {
    console.error('[Banana Scene] Failed to create UI overlay');
    return root;
  }

  // Add overlay to root
  $.addComponent(root, overlay);

  // Apply bindings to set up event listeners
  $.applyBindings(overlay);

  console.log('[Banana Scene] Scene created successfully');
  return root;
}
