// Key namespacing. Every stored entry is prefixed with `${namespace}:` so
// multiple storage components (and other apps sharing the origin) don't collide,
// and `keys`/`clear` can scope to just this component's namespace.
export function nsPrefix(namespace) {
    return `${namespace}:`;
}
export function fullKey(namespace, key) {
    return `${namespace}:${key}`;
}
export function stripPrefix(namespace, full) {
    const p = `${namespace}:`;
    return full.startsWith(p) ? full.slice(p.length) : full;
}
