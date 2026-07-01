// IndexedDB backend. Async, large quota (GBs), and stores values by structured
// clone — so plain objects/arrays/primitives AND binary (Blob/ArrayBuffer/typed
// arrays) round-trip without JSON. In-house Promise wrappers over IDBRequest; the
// DB connection is opened once (lazily) and reused. Every path degrades to a
// no-op/null if IndexedDB is unavailable (private mode, disabled).
function req(r) {
    return new Promise((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}
export function idbBackend(dbName, storeName) {
    let dbPromise = null;
    const openDb = () => {
        if (dbPromise)
            return dbPromise;
        dbPromise = new Promise((resolve) => {
            if (typeof indexedDB === 'undefined') {
                console.warn('[browser-local-storage] IndexedDB unavailable');
                resolve(null);
                return;
            }
            const open = indexedDB.open(dbName, 1);
            open.onupgradeneeded = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName);
                }
            };
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => {
                console.warn('[browser-local-storage] IndexedDB open failed', open.error);
                resolve(null);
            };
        });
        return dbPromise;
    };
    const store = async (mode) => {
        const db = await openDb();
        if (!db)
            return null;
        return db.transaction(storeName, mode).objectStore(storeName);
    };
    return {
        async get(fullKey) {
            const s = await store('readonly');
            if (!s)
                return null;
            const v = await req(s.get(fullKey));
            return v === undefined ? null : v;
        },
        async set(fullKey, value) {
            const s = await store('readwrite');
            if (!s)
                return false;
            try {
                await req(s.put(value, fullKey));
                return true;
            }
            catch (e) {
                console.warn(`[browser-local-storage] idb set '${fullKey}' failed`, e);
                return false;
            }
        },
        async remove(fullKey) {
            const s = await store('readwrite');
            if (s)
                await req(s.delete(fullKey));
        },
        async has(fullKey) {
            const s = await store('readonly');
            if (!s)
                return false;
            const k = await req(s.getKey(fullKey));
            return k !== undefined;
        },
        async keys(prefix) {
            const s = await store('readonly');
            if (!s)
                return [];
            const all = (await req(s.getAllKeys()));
            return all
                .map(String)
                .filter((k) => k.startsWith(prefix))
                .map((k) => k.slice(prefix.length));
        },
        async clear(prefix) {
            const s = await store('readwrite');
            if (!s)
                return;
            const all = (await req(s.getAllKeys()));
            for (const k of all) {
                if (String(k).startsWith(prefix))
                    await req(s.delete(k));
            }
        },
    };
}
