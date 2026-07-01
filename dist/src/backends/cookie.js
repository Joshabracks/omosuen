// Cookie backend. Tiny (~4KB per cookie) and sent on every request — not for bulk
// state, but included for completeness (small flags, opt-ins that a server might
// read). Keys are `encodeURIComponent(fullKey)`; values `encodeURIComponent(json)`.
// Attributes: path=/, max-age (from config), SameSite (from config).
// Practical per-cookie byte ceiling (name=value + attributes). Browsers cap ~4096.
const MAX_COOKIE_BYTES = 4093;
function parseCookies() {
    const out = {};
    if (typeof document === 'undefined')
        return out;
    const raw = document.cookie;
    if (!raw)
        return out;
    for (const part of raw.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0)
            continue;
        const name = decodeURIComponent(part.slice(0, idx).trim());
        const val = decodeURIComponent(part.slice(idx + 1).trim());
        out[name] = val;
    }
    return out;
}
export function cookieBackend(cfg) {
    // value === null deletes the cookie. Returns false if not written.
    const write = (fullKey, value) => {
        if (typeof document === 'undefined') {
            console.warn('[browser-local-storage] cookies unavailable');
            return false;
        }
        const name = encodeURIComponent(fullKey);
        if (value === null) {
            document.cookie = `${name}=; path=/; max-age=0; SameSite=${cfg.sameSite}`;
            return true;
        }
        const cookie = `${name}=${encodeURIComponent(value)}; path=/; ` +
            `max-age=${Math.floor(cfg.maxAgeDays * 86400)}; SameSite=${cfg.sameSite}`;
        if (cookie.length > MAX_COOKIE_BYTES) {
            console.warn(`[browser-local-storage] cookie '${fullKey}' exceeds ~4KB (${cookie.length}b) — not written`);
            return false;
        }
        document.cookie = cookie;
        return true;
    };
    return {
        async get(fullKey) {
            const raw = parseCookies()[fullKey];
            if (raw === undefined)
                return null;
            try {
                return JSON.parse(raw);
            }
            catch {
                console.warn(`[browser-local-storage] cookie '${fullKey}' is not valid JSON`);
                return null;
            }
        },
        async set(fullKey, value) {
            return write(fullKey, JSON.stringify(value));
        },
        async remove(fullKey) {
            write(fullKey, null);
        },
        async has(fullKey) {
            return parseCookies()[fullKey] !== undefined;
        },
        async keys(prefix) {
            return Object.keys(parseCookies())
                .filter((k) => k.startsWith(prefix))
                .map((k) => k.slice(prefix.length));
        },
        async clear(prefix) {
            for (const k of Object.keys(parseCookies())) {
                if (k.startsWith(prefix))
                    write(k, null);
            }
        },
    };
}
