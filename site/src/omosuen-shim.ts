/**
 * Runtime bridge for the `omosuen` peer import used by official plugins.
 * TypeScript resolves types from the `omosuen` devDependency; webpack aliases
 * `omosuen` here so the UMD script in index.html stays the runtime engine.
 */
const engine = window.Omosuen;

function bindMethod<K extends keyof typeof engine>(key: K): (typeof engine)[K] {
  const value = engine[key];
  if (typeof value === 'function') {
    return (value as (...args: unknown[]) => unknown).bind(
      engine,
    ) as (typeof engine)[K];
  }
  return value;
}

export const registerPluginComponent = bindMethod('registerPluginComponent');
export const newComponent = bindMethod('newComponent');
export const castTo = bindMethod('castTo');
export const getActiveScene = bindMethod('getActiveScene');
export const ComponentUnique = engine.ComponentUnique;
export const Vector2D = engine.Vector2D;
export const Vector3D = engine.Vector3D;
export const Vector4D = engine.Vector4D;
