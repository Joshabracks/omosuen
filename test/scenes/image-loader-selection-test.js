/**
 * Bare scene for test/image-loader-selection.html: a retain-mode atlas-manager
 * plus a viewport + camera (so atlas updates really go through the GPU upload
 * path). The page adds and drives the loader entities itself.
 */

const Omosuen = window.Omosuen;

export async function createScene() {
  const scene = await Omosuen.newComponent('nexus', { name: 'Image Loader Selection Scene' });

  const atlasManager = await Omosuen.newComponent('atlas-manager', {
    name: 'AtlasManager',
    config: { atlasSize: 2048, maxAtlases: 16, padding: 1, retainAtlas: true },
  });
  scene.addComponent(atlasManager);

  const viewport = await Omosuen.newComponent('viewport', {
    name: 'ILS Viewport',
    width: 480,
    height: 360,
    offsetX: 16,
    offsetY: 16,
    backgroundColor: new Omosuen.Vector4D(0.1, 0.1, 0.15, 1.0),
  });
  scene.addComponent(viewport);

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
    viewportRef: 'ILS Viewport',
    zoom: 1.0,
    axonometricAngle: 30,
  }));

  return scene;
}
