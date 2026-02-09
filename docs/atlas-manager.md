# AtlasManager Component System

The AtlasManager system provides efficient texture atlas packing and management for 2D sprite rendering. It consists of three components that work together to load, pack, and manage texture atlases.

## Components

### 1. TextureMap
Stores frame metadata for a single source image, including both original frame definitions and packed frame locations after atlas processing.

**Type**: Regular component (multiple instances allowed)
**Fields**:
- `textureMapKey: string` - Unique key for this texture map
- `filePath: string` - Source image path
- `imageType: FrameMap | GridConfig | undefined` - Frame extraction configuration
- `originalFrames: OriginalFrame[]` - Original frame definitions (for packing and serialization)
- `packedFrames: PackedFrame[]` - Packed frames with atlas positions (populated after processing)

### 2. ImageRegistry
Global singleton cache for loaded images with async loading support.

**Type**: Global singleton (unique: GLOBAL)
**Fields**:
- `cache: Map<string, HTMLImageElement>` - Loaded images
- `loading: Map<string, Promise<HTMLImageElement>>` - In-flight loads

### 3. AtlasManager
Core texture atlas packing and management component using guillotine bin packing algorithm.

**Type**: Global singleton (unique: GLOBAL)
**Configuration**:
- `atlasSize: 1024 | 2048 | 4096 | 8192` (default: 4096)
- `maxAtlases: 1-16` (default: 16)
- `padding: 0-4` (default: 1px for texture bleeding prevention)

**Fields**:
- `textureMapIds: Set<string>` - Pending texture maps
- `atlases: ImageData[]` - Compiled atlas textures (0-15)
- `compiled: boolean` - Ready flag for render loop

## Image Type Configurations

### FrameMap
Explicit array of frame rectangles using Vector4D (x, y, width, height):

```typescript
const frameMap: FrameMap = [
  new Vector4D(0, 0, 32, 32),    // Frame 0: top-left corner, 32x32
  new Vector4D(32, 0, 32, 32),   // Frame 1: next to it, 32x32
  new Vector4D(64, 0, 64, 64),   // Frame 2: larger frame, 64x64
];
```

### GridConfig
Uniform grid extraction configuration:

```typescript
const gridConfig: GridConfig = {
  cellSize: new Vector2D(32, 32),    // Each cell is 32x32 pixels
  gridSize: new Vector2D(8, 8),      // 8 columns x 8 rows
  cellCount: 60,                      // Optional: only first 60 cells are valid
};
```

### Undefined
If no imageType is provided, the entire image is treated as a single frame.

## Usage Example

```typescript
import { newComponent } from './component';
import { Vector2D, Vector4D } from './math';

// 1. Create scene
const scene = await newComponent('nexus', { name: 'GameScene' });

// 2. Create and add ImageRegistry (global singleton)
const imageRegistry = await newComponent('image-registry', {
  name: 'ImageRegistry',
});
scene.addComponent(imageRegistry);

// 3. Create and add AtlasManager (global singleton)
const atlasManager = await newComponent('atlas-manager', {
  name: 'AtlasManager',
  config: {
    atlasSize: 4096,      // 4096x4096 atlases
    maxAtlases: 16,       // Up to 16 atlases
    padding: 1,           // 1px padding between frames
  },
});
scene.addComponent(atlasManager);

// 4. Create TextureMap for a sprite sheet with grid layout
const playerTexture = await newComponent('texture-map', {
  textureMapKey: 'player-sprite',
  name: 'PlayerSprite',
  filePath: './assets/player.png',
  imageType: {
    cellSize: new Vector2D(32, 32),
    gridSize: new Vector2D(8, 4),  // 8x4 grid of 32x32 sprites
  },
});
scene.addComponent(playerTexture);

// 5. Create TextureMap for explicit frame definitions
const explosionTexture = await newComponent('texture-map', {
  textureMapKey: 'explosion-fx',
  name: 'ExplosionFX',
  filePath: './assets/explosion.png',
  imageType: [
    new Vector4D(0, 0, 64, 64),
    new Vector4D(64, 0, 64, 64),
    new Vector4D(128, 0, 64, 64),
  ],
});
scene.addComponent(explosionTexture);

// 6. Create TextureMap for single image (no imageType)
const backgroundTexture = await newComponent('texture-map', {
  textureMapKey: 'background',
  name: 'Background',
  filePath: './assets/background.png',
  // No imageType = entire image is one frame
});
scene.addComponent(backgroundTexture);

// 7. Queue texture maps for processing
atlasManager.addTextureMap(playerTexture);
atlasManager.addTextureMap(explosionTexture);
atlasManager.addTextureMap(backgroundTexture);

// 8. Process all pending texture maps (async)
await atlasManager.processTextureMaps();

// 9. Check compilation status
console.log('Atlas compiled:', atlasManager.compiled); // true
console.log('Atlas count:', atlasManager.getAtlasCount());

// 10. Access packed frames for rendering
const playerFrame0 = playerTexture.getPackedFrame(0);
console.log('Player frame 0:', {
  atlasIndex: playerFrame0.atlasIndex,        // Which atlas (0-15)
  position: playerFrame0.atlasPosition,       // Position in atlas
  size: playerFrame0.size,                    // Frame size
});

// 11. Get atlas texture for WebGL upload
const atlas0 = atlasManager.getAtlas(0);
if (atlas0) {
  // Upload to WebGL texture
  // gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas0);
}
```

## Pre-loading Images

For better performance, pre-load images before processing:

```typescript
// Pre-load images manually
await imageRegistry.loadImage('./assets/player.png');
await imageRegistry.loadImage('./assets/explosion.png');
await imageRegistry.loadImage('./assets/background.png');

// Now processing will be instant (images already cached)
await atlasManager.processTextureMaps();
```

## Dynamic Texture Addition

Add new textures at runtime (will cause recompilation):

```typescript
// During runtime, add a new texture
const newTexture = await newComponent('texture-map', {
  textureMapKey: 'enemy-sprite',
  name: 'EnemySprite',
  filePath: './assets/enemy.png',
  imageType: {
    cellSize: new Vector2D(48, 48),
    gridSize: new Vector2D(6, 4),
  },
});
scene.addComponent(newTexture);

// Queue for processing
atlasManager.addTextureMap(newTexture);

// Check if recompilation needed
if (!atlasManager.compiled) {
  console.log('Atlases need recompilation');
  await atlasManager.processTextureMaps();
}
```

## Serialization/Deserialization

When serializing scenes:
- TextureMap serializes: `textureMapKey`, `filePath`, `imageType`, `originalFrames`
- AtlasManager is NOT serialized (transient runtime state)
- ImageRegistry is NOT serialized (transient cache)

When deserializing:
1. TextureMap components are restored with `originalFrames` intact
2. Manually create and add ImageRegistry and AtlasManager to scene
3. Add all texture maps to AtlasManager
4. Call `processTextureMaps()` to rebuild atlases

```typescript
// After scene deserialization
const imageRegistry = await newComponent('image-registry', {
  name: 'ImageRegistry',
});
scene.addComponent(imageRegistry);

const atlasManager = await newComponent('atlas-manager', {
  name: 'AtlasManager',
});
scene.addComponent(atlasManager);

// Get all texture maps from deserialized scene
const textureMaps = scene.getComponentsByType('texture-map', true);
for (const tm of textureMaps) {
  atlasManager.addTextureMap(tm);
}

// Rebuild atlases
await atlasManager.processTextureMaps();
```

## Bin Packing Algorithm

The AtlasManager uses a **Guillotine bin packing algorithm** with even splitting:

1. **Bucketing**: Frames are sorted into 3 buckets:
   - `w`: Width > height (sorted by width DESC, then height DESC)
   - `h`: Height > width (sorted by height DESC, then width DESC)
   - `s`: Width === height (sorted by size DESC)

2. **Allocation**: Rotates through buckets (h → w → s) to pack frames
   - Each frame gets best-fit space (smallest space that fits)
   - Exact size matches are prioritized

3. **Slicing**: When allocating a frame to a space:
   - Wide frames prefer vertical slice (left/right)
   - Tall frames prefer horizontal slice (top/bottom)
   - Spaces are recursively subdivided to minimize wasted space

4. **Padding**: 1px padding is added between frames to prevent texture bleeding

## Error Handling

The system throws errors in these cases:
- Frame cannot fit in any available atlas space
- All configured atlases are full
- AtlasManager not attached to a scene when processing
- ImageRegistry not found in scene

```typescript
try {
  await atlasManager.processTextureMaps();
} catch (error) {
  console.error('Failed to process texture maps:', error);
  // Handle error (e.g., increase maxAtlases or atlasSize)
}
```

## Performance Considerations

1. **Pre-load images**: Use `imageRegistry.loadImage()` before calling `processTextureMaps()`
2. **Batch processing**: Add multiple texture maps before calling `processTextureMaps()`
3. **Avoid dynamic additions**: Add all textures during scene initialization when possible
4. **Monitor compiled flag**: Check `atlasManager.compiled` in render loop before drawing

## Configuration Guidelines

### Atlas Size
- **1024x1024**: Mobile devices, small games
- **2048x2048**: Standard for most games
- **4096x4096**: Default, handles most scenarios (minimum modern hardware support)
- **8192x8192**: High-resolution sprites, desktop only

### Max Atlases
- **1-4**: Simple games with few sprites
- **8-12**: Medium complexity games
- **16**: Maximum (WebGL2 fragment shader lower limit)

### Padding
- **0px**: No texture bleeding prevention (not recommended)
- **1px**: Default, minimal overhead
- **2-4px**: Extra safety for high-quality scaling

## Integration with Rendering

```typescript
// In your render loop
function renderFrame() {
  // Check if atlases need recompilation
  if (!atlasManager.compiled) {
    // Skip rendering or show loading screen
    return;
  }

  // Get atlas for rendering
  const atlas0 = atlasManager.getAtlas(0);

  // Upload to WebGL if needed
  if (atlas0 && !textureUploaded) {
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      atlas0
    );
    textureUploaded = true;
  }

  // Render sprites using packed frame data
  const frame = playerTexture.getPackedFrame(currentFrame);
  if (frame) {
    drawSprite(
      frame.atlasIndex,
      frame.atlasPosition,
      frame.size,
      screenPosition
    );
  }
}
```
