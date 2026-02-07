/**
 * Avocado Scene Module
 *
 * Theme: Fresh, healthy, green colors
 * Demonstrates data-layer component usage with all supported types
 * Exports an async function that creates and returns a scene nexus
 */

export default async function createAvocadoScene() {
  // Import Omosuen from the global scope (loaded by main HTML)
  const { newComponent, $, switchScene, Vector2D, Vector3D, Vector4D } =
    window.Omosuen;

  // Create root nexus for the scene
  const root = await newComponent('nexus', { name: 'AvocadoSceneRoot' });

  if (!root) {
    console.error('[Avocado Scene] Failed to create root nexus');
    return null;
  }

  // Create data-layer component to store scene statistics
  const dataLayer = await newComponent('data-layer', {
    name: 'AvocadoSceneData',
  });

  if (!dataLayer) {
    console.error('[Avocado Scene] Failed to create data-layer');
    return root;
  }

  // Initialize data-layer with all supported types using Proxy access
  dataLayer.proxy.sceneName = 'Avocado Paradise'; // string
  dataLayer.proxy.visitCount = 0; // number
  dataLayer.proxy.isHealthy = true; // boolean
  dataLayer.proxy.position2D = new Vector2D(100, 200); // Vector2D
  dataLayer.proxy.color = new Vector3D(85, 139, 47); // Vector3D (RGB)
  dataLayer.proxy.colorWithAlpha = new Vector4D(156, 204, 101, 0.9); // Vector4D (RGBA)

  // Increment visit count
  dataLayer.proxy.visitCount++;

  // Create UI Overlay with avocado theme, dynamic content, and custom update method
  const overlay = await newComponent('ui-overlay', {
    name: 'AvocadoOverlay',
    update: function (deltaTime) {
      // Get stats display elements
      const statsDisplay = document.getElementById('stats-display');
      const sceneTitleElement = document.getElementById('scene-title');
      const healthStatusElement = document.getElementById('health-status');

      if (!statsDisplay || !sceneTitleElement || !healthStatusElement) {
        return; // Elements not ready yet
      }

      // Read from data-layer using Proxy access
      const sceneName = dataLayer.proxy.sceneName;
      const visitCount = dataLayer.proxy.visitCount;
      const isHealthy = dataLayer.proxy.isHealthy;
      const position2D = dataLayer.proxy.position2D;
      const color = dataLayer.proxy.color;
      const colorWithAlpha = dataLayer.proxy.colorWithAlpha;

      // Update scene title
      sceneTitleElement.textContent = sceneName;
      healthStatusElement.textContent = isHealthy ? 'healthy' : 'unhealthy';

      // Format the stats display
      statsDisplay.innerHTML = `
        <div><strong>Scene Name (string):</strong> ${sceneName}</div>
        <div><strong>Visit Count (number):</strong> ${visitCount}</div>
        <div><strong>Is Healthy (boolean):</strong> ${isHealthy ? '✅ Yes' : '❌ No'}</div>
        <div><strong>Position 2D (Vector2D):</strong> (${position2D.x.toFixed(0)}, ${position2D.y.toFixed(0)})</div>
        <div><strong>Color RGB (Vector3D):</strong> rgb(${color.r}, ${color.g}, ${color.b})</div>
        <div><strong>Color RGBA (Vector4D):</strong> rgba(${colorWithAlpha.r}, ${colorWithAlpha.g}, ${colorWithAlpha.b}, ${colorWithAlpha.a})</div>
      `;

      // Demonstrate Vector mutation via Proxy - animate position
      dataLayer.proxy.position2D.x += Math.sin(Date.now() / 1000) * 0.5;
      dataLayer.proxy.position2D.y += Math.cos(Date.now() / 1000) * 0.5;

      // Also demonstrate method-based access via $ Proxy
      const allStats = $.getAll(dataLayer, [
        'sceneName',
        'visitCount',
        'isHealthy',
      ]);

      // Log to console every 60 frames (~1 second at 60fps)
      if (
        Math.floor(Date.now() / 1000) % 2 === 0 &&
        Math.floor(Date.now() / 16.67) % 60 === 0
      ) {
        console.log('[Avocado Scene] Data-layer stats:', allStats);
      }
    },
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
        max-width: 600px;
        min-width: 400px;
      ">
        <h1 style="
          margin: 0 0 10px 0;
          font-size: 48px;
          text-shadow: 2px 2px 6px rgba(0,0,0,0.3);
          font-weight: 300;
          letter-spacing: 2px;
        ">🥑 <span id="scene-title">Avocado Scene</span></h1>

        <p style="
          margin: 0 0 20px 0;
          font-size: 20px;
          font-weight: 400;
          text-shadow: 1px 1px 2px rgba(0,0,0,0.2);
        ">
          Fresh and <span id="health-status">healthy</span> avocado vibes!
        </p>

        <div style="
          background: rgba(0,0,0,0.2);
          padding: 20px;
          border-radius: 10px;
          margin-bottom: 20px;
          font-size: 14px;
          text-align: left;
        ">
          <h3 style="margin: 0 0 10px 0; font-size: 18px;">📊 Data Layer Stats:</h3>
          <div id="stats-display" style="line-height: 1.8;">
            <!-- Dynamic content updated by data-layer -->
          </div>
        </div>

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

        <div style="margin-top: 20px; font-size: 12px; opacity: 0.7;">
          <p>Data updates every frame using ui-overlay update() method</p>
        </div>
      </div>
    `,
    cssOverrides: {
      display: 'block',
      pointerEvents: 'auto',
      zIndex: '1000',
    },
    bindings: [
      {
        selector: '#btn-banana',
        onActions: ['click'],
        method: async (e) => {
          console.log('[Avocado Scene] Navigating to Banana scene');
          await switchScene('BananaScene');
        },
      },
      {
        selector: '#btn-strawberry',
        onActions: ['click'],
        method: async (e) => {
          console.log('[Avocado Scene] Navigating to Strawberry scene');
          await switchScene('StrawberryScene');
        },
      },
    ],
  });

  if (!overlay) {
    console.error('[Avocado Scene] Failed to create UI overlay');
    return root;
  }

  // Add both components to root
  $.addComponent(root, dataLayer);
  $.addComponent(root, overlay);

  // Apply bindings to set up event listeners
  $.applyBindings(overlay);

  console.log('[Avocado Scene] Scene created successfully with data-layer');
  console.log('[Avocado Scene] Data-layer contents:', {
    sceneName: dataLayer.proxy.sceneName,
    visitCount: dataLayer.proxy.visitCount,
    isHealthy: dataLayer.proxy.isHealthy,
    position2D: dataLayer.proxy.position2D,
    color: dataLayer.proxy.color,
    colorWithAlpha: dataLayer.proxy.colorWithAlpha,
  });

  return root;
}
