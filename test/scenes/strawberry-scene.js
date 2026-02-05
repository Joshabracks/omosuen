/**
 * Strawberry Scene Module
 *
 * Theme: Sweet, vibrant, red/pink colors
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

  // Create UI Overlay with strawberry theme
  const overlay = await newComponent('ui-overlay', {
    name: 'StrawberryOverlay',
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
        max-width: 500px;
        min-width: 400px;
      ">
        <h1 style="
          margin: 0 0 10px 0;
          font-size: 48px;
          text-shadow: 2px 2px 8px rgba(0,0,0,0.3);
          font-weight: bold;
        ">🍓 Strawberry Scene</h1>

        <p style="
          margin: 0 0 30px 0;
          font-size: 20px;
          font-weight: bold;
          text-shadow: 1px 1px 3px rgba(0,0,0,0.2);
        ">
          Sweet strawberry fields forever!
        </p>

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

  // Add overlay to root
  $.addComponent(root, overlay);

  // Apply bindings to set up event listeners
  $.applyBindings(overlay);

  console.log('[Strawberry Scene] Scene created successfully');
  return root;
}
