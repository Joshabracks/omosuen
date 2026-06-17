export const RAW = Symbol("sst.raw");
const proxyCache = new WeakMap();
function isPlainContainer(value) {
    if (value === null || typeof value !== "object")
        return false;
    if (Array.isArray(value))
        return true;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
function wrap(target, rootKey, onMutate) {
    const existing = proxyCache.get(target);
    if (existing)
        return existing;
    const proxy = new Proxy(target, {
        get(obj, key) {
            if (key === RAW)
                return obj;
            const value = obj[key];
            if (isPlainContainer(value)) {
                return wrap(value, rootKey, onMutate);
            }
            return value;
        },
        set(obj, key, value) {
            const prev = obj[key];
            const raw = value && value[RAW];
            obj[key] = raw !== undefined ? raw : value;
            if (prev !== obj[key])
                onMutate(rootKey);
            return true;
        },
        deleteProperty(obj, key) {
            if (key in obj) {
                delete obj[key];
                onMutate(rootKey);
            }
            return true;
        },
    });
    proxyCache.set(target, proxy);
    return proxy;
}
export function reactive(target, onMutate) {
    const existing = proxyCache.get(target);
    if (existing)
        return existing;
    const proxy = new Proxy(target, {
        get(obj, key) {
            if (key === RAW)
                return obj;
            const value = obj[key];
            if (typeof key === "string" && isPlainContainer(value)) {
                return wrap(value, key, onMutate);
            }
            return value;
        },
        set(obj, key, value) {
            const prev = obj[key];
            const raw = value && value[RAW];
            obj[key] = raw !== undefined ? raw : value;
            if (typeof key === "string" && prev !== obj[key])
                onMutate(key);
            return true;
        },
        deleteProperty(obj, key) {
            if (key in obj) {
                delete obj[key];
                if (typeof key === "string")
                    onMutate(key);
            }
            return true;
        },
    });
    proxyCache.set(target, proxy);
    return proxy;
}
