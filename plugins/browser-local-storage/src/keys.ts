// Key namespacing. Every stored entry is prefixed with `${namespace}:` so
// multiple storage components (and other apps sharing the origin) don't collide,
// and `keys`/`clear` can scope to just this component's namespace.

export function nsPrefix(namespace: string): string {
  return `${namespace}:`;
}

export function fullKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

export function stripPrefix(namespace: string, full: string): string {
  const p = `${namespace}:`;
  return full.startsWith(p) ? full.slice(p.length) : full;
}
