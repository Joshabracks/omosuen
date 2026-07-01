// Web Storage backend (both localStorage and sessionStorage — same API, chosen by
// the `session` flag). Synchronous under the hood; wrapped in Promises for the
// unified async surface. Values are JSON strings. Guards private-mode / disabled
// storage (accessing `window.localStorage` can throw) and QuotaExceededError.
function getStore(session) {
    try {
        if (typeof window === 'undefined')
            return null;
        return session ? window.sessionStorage : window.localStorage;
    }
    catch {
        return null; // private mode / storage disabled
    }
}
export function webStorageBackend(session) {
    const label = session ? 'sessionStorage' : 'localStorage';
    return {
        async get(fullKey) {
            const s = getStore(session);
            if (!s)
                return null;
            const raw = s.getItem(fullKey);
            if (raw == null)
                return null;
            try {
                return JSON.parse(raw);
            }
            catch {
                console.warn(`[browser-local-storage] ${label} '${fullKey}' is not valid JSON`);
                return null;
            }
        },
        async set(fullKey, value) {
            const s = getStore(session);
            if (!s) {
                console.warn(`[browser-local-storage] ${label} unavailable`);
                return false;
            }
            try {
                s.setItem(fullKey, JSON.stringify(value));
                return true;
            }
            catch (e) {
                console.warn(`[browser-local-storage] ${label} set '${fullKey}' failed`, e);
                return false;
            }
        },
        async remove(fullKey) {
            getStore(session)?.removeItem(fullKey);
        },
        async has(fullKey) {
            const s = getStore(session);
            return !!s && s.getItem(fullKey) !== null;
        },
        async keys(prefix) {
            const s = getStore(session);
            if (!s)
                return [];
            const out = [];
            for (let i = 0; i < s.length; i++) {
                const k = s.key(i);
                if (k && k.startsWith(prefix))
                    out.push(k.slice(prefix.length));
            }
            return out;
        },
        async clear(prefix) {
            const s = getStore(session);
            if (!s)
                return;
            const toRemove = [];
            for (let i = 0; i < s.length; i++) {
                const k = s.key(i);
                if (k && k.startsWith(prefix))
                    toRemove.push(k);
            }
            for (const k of toRemove)
                s.removeItem(k);
        },
    };
}
