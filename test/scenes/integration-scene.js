/**
 * Integration Test Scene
 *
 * Tests:
 * - Data-layer component with time tracking
 * - Flag-manager component with random flag toggling
 * - UI-overlay with dynamic updates
 * - Scene serialization/deserialization
 */

export default async function createIntegrationScene() {
  const { newComponent } = window.Omosuen;

  // Create root nexus
  const root = await newComponent('nexus', { name: 'IntegrationSceneRoot' });
  if (!root) {
    console.error('[Integration Scene] Failed to create root nexus');
    return null;
  }

  // =========================================================================
  // Data Layer - Track time of day
  // =========================================================================
  const dataLayer = await newComponent('data-layer', {
    name: 'TimeTracker',
  });

  if (!dataLayer) {
    console.error('[Integration Scene] Failed to create data-layer');
    return root;
  }

  // Initialize time of day
  function formatTime() {
    const now = new Date();
    return now.toLocaleTimeString('en-US', {
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  dataLayer.set('timeOfDay', formatTime());

  // =========================================================================
  // Flag Manager - Random flag toggling
  // =========================================================================
  const flagManager = await newComponent('flag-manager', {
    name: 'FruitFlags',
  });

  if (!flagManager) {
    console.error('[Integration Scene] Failed to create flag-manager');
    return root;
  }

  // Initialize flags (all start unset)
  let flagToggleAccumulator = 0;

  // =========================================================================
  // UI Overlay - Display time and flags
  // =========================================================================
  const overlay = await newComponent('ui-overlay', {
    name: 'IntegrationOverlay',
    update: function (deltaTime) {
      // Update time every frame
      dataLayer.set('timeOfDay', formatTime());

      // Update time display
      const timeDisplay = document.getElementById('time-display');
      if (timeDisplay) {
        const currentTime = dataLayer.get('timeOfDay');
        timeDisplay.textContent = currentTime;
      }

      // Toggle flags randomly every second
      flagToggleAccumulator += deltaTime;
      if (flagToggleAccumulator >= 1000) {
        flagToggleAccumulator -= 1000;

        // Each flag independently has 50% chance to toggle
        if (Math.random() < 0.5) {
          if (flagManager.hasFlag('banana')) {
            flagManager.removeFlag('banana');
          } else {
            flagManager.addFlag('banana');
          }
        }
        if (Math.random() < 0.5) {
          if (flagManager.hasFlag('strawberry')) {
            flagManager.removeFlag('strawberry');
          } else {
            flagManager.addFlag('strawberry');
          }
        }
        if (Math.random() < 0.5) {
          if (flagManager.hasFlag('avocado')) {
            flagManager.removeFlag('avocado');
          } else {
            flagManager.addFlag('avocado');
          }
        }
      }

      // Update emoji display based on flags
      const bananaEl = document.getElementById('banana-emoji');
      const strawberryEl = document.getElementById('strawberry-emoji');
      const avocadoEl = document.getElementById('avocado-emoji');

      if (bananaEl) {
        const hasFlag = flagManager.hasFlag('banana');
        bananaEl.style.filter = hasFlag ? 'none' : 'grayscale(100%) opacity(50%)';
      }

      if (strawberryEl) {
        const hasFlag = flagManager.hasFlag('strawberry');
        strawberryEl.style.filter = hasFlag ? 'none' : 'grayscale(100%) opacity(50%)';
      }

      if (avocadoEl) {
        const hasFlag = flagManager.hasFlag('avocado');
        avocadoEl.style.filter = hasFlag ? 'none' : 'grayscale(100%) opacity(50%)';
      }
    },
    html: `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      ">
        <div style="
          background: rgba(0, 0, 0, 0.3);
          padding: 60px;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          text-align: center;
          max-width: 500px;
        ">
          <h1 style="
            margin: 0 0 20px 0;
            font-size: 48px;
            text-shadow: 2px 2px 8px rgba(0, 0, 0, 0.5);
          ">Integration Test</h1>

          <div style="
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 30px;
          ">
            <div style="
              font-size: 18px;
              opacity: 0.8;
              margin-bottom: 10px;
            ">Current Time</div>
            <div id="time-display" style="
              font-size: 36px;
              font-weight: bold;
              letter-spacing: 2px;
              text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
            ">--:--:--</div>
          </div>

          <div style="
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 30px;
          ">
            <div style="
              font-size: 18px;
              opacity: 0.8;
              margin-bottom: 15px;
            ">Fruit Flags</div>
            <div style="
              display: flex;
              justify-content: space-around;
              font-size: 64px;
            ">
              <span id="banana-emoji" style="
                transition: filter 0.3s;
                filter: grayscale(100%) opacity(50%);
              ">🍌</span>
              <span id="strawberry-emoji" style="
                transition: filter 0.3s;
                filter: grayscale(100%) opacity(50%);
              ">🍓</span>
              <span id="avocado-emoji" style="
                transition: filter 0.3s;
                filter: grayscale(100%) opacity(50%);
              ">🥑</span>
            </div>
            <div style="
              font-size: 12px;
              opacity: 0.6;
              margin-top: 10px;
            ">(Flags toggle randomly every second)</div>
          </div>

          <button onclick="window.onNextSceneClick()" style="
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            border: none;
            padding: 20px 40px;
            font-size: 20px;
            font-weight: bold;
            border-radius: 50px;
            cursor: pointer;
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
            transition: transform 0.2s, box-shadow 0.2s;
          "
          onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 12px 30px rgba(0, 0, 0, 0.4)';"
          onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 8px 20px rgba(0, 0, 0, 0.3)';">
            Next Scene →
          </button>
        </div>
      </div>
    `,
    cssOverrides: {
      display: 'block',
      pointerEvents: 'auto',
      zIndex: '1000',
    },
  });

  if (!overlay) {
    console.error('[Integration Scene] Failed to create overlay');
    return root;
  }

  // Add components to root
  root.addComponent(dataLayer);
  root.addComponent(flagManager);
  root.addComponent(overlay);

  // Apply UI bindings
  overlay.applyBindings();

  return root;
}
