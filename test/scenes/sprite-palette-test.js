/**
 * Bare scene for test/sprite-palette.html: a retain-mode atlas-manager, a
 * viewport + camera, and a single white ambient light at brightness 1, so
 * sprite lighting is exactly 1 and on-screen colours equal the (remapped)
 * albedo byte for byte. The page adds and drives the sprite entities itself.
 */

const Omosuen = window.Omosuen;

export async function createScene() {
  const scene = await Omosuen.newComponent('nexus', { name: 'Sprite Palette Scene' });

  scene.addComponent(await Omosuen.newComponent('atlas-manager', {
    name: 'AtlasManager',
    config: { atlasSize: 2048, maxAtlases: 16, padding: 1, retainAtlas: true },
  }));

  scene.addComponent(await Omosuen.newComponent('light', {
    name: 'Neutral Ambient',
    lightType: 'ambient',
    color: new Omosuen.Vector3D(1, 1, 1),
    brightness: 1,
  }));

  scene.addComponent(await Omosuen.newComponent('viewport', {
    name: 'SP Viewport',
    width: 480,
    height: 360,
    offsetX: 16,
    offsetY: 16,
    backgroundColor: new Omosuen.Vector4D(0.1, 0.1, 0.15, 1.0),
  }));

  const cameraNexus = await Omosuen.newComponent('nexus', { name: 'Camera Nexus' });
  scene.addComponent(cameraNexus);
  cameraNexus.addComponent(await Omosuen.newComponent('transform', {
    name: 'Camera Transform',
    position: new Omosuen.Vector3D(0, 60, 0),
    rotation: new Omosuen.Vector3D(0, 0, 0),
    scale: new Omosuen.Vector3D(1, 1, 1),
  }));
  cameraNexus.addComponent(await Omosuen.newComponent('camera', {
    name: 'Main Camera',
    viewportRef: 'SP Viewport',
    zoom: 1.0,
    axonometricAngle: 30,
  }));

  return scene;
}
