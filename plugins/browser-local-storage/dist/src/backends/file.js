// File System Access backend — explicit, gesture-gated export/import to a real disk
// file (not part of the keyed get/set surface). Chromium-family only; Firefox/Safari
// lack it, so every entry point feature-detects and degrades gracefully. The
// showSaveFilePicker / showOpenFilePicker types aren't guaranteed in the TS DOM lib,
// so they're accessed through `any`.
export function fileSystemAccessSupported() {
    return (typeof window !== 'undefined' &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        typeof window.showSaveFilePicker === 'function');
}
/**
 * Writes `payload` (JSON-serialized) to a user-chosen file. Must be called from a
 * user gesture (click/keydown). Returns false if unsupported or cancelled.
 */
export async function exportToFile(payload, suggestedName = 'save.json') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window;
    if (typeof w?.showSaveFilePicker !== 'function') {
        console.warn('[browser-local-storage] File System Access not supported');
        return false;
    }
    try {
        const handle = await w.showSaveFilePicker({
            suggestedName,
            types: [
                { description: 'JSON', accept: { 'application/json': ['.json'] } },
            ],
        });
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(payload));
        await writable.close();
        return true;
    }
    catch (e) {
        // AbortError = user cancelled the picker; not worth surfacing loudly.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (e?.name !== 'AbortError') {
            console.warn('[browser-local-storage] exportToFile failed', e);
        }
        return false;
    }
}
/**
 * Prompts the user to pick a JSON file and returns its parsed contents (or null if
 * unsupported/cancelled/invalid). Must be called from a user gesture.
 */
export async function importFromFile() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window;
    if (typeof w?.showOpenFilePicker !== 'function') {
        console.warn('[browser-local-storage] File System Access not supported');
        return null;
    }
    try {
        const [handle] = await w.showOpenFilePicker({
            types: [
                { description: 'JSON', accept: { 'application/json': ['.json'] } },
            ],
            multiple: false,
        });
        const file = await handle.getFile();
        const text = await file.text();
        return JSON.parse(text);
    }
    catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (e?.name !== 'AbortError') {
            console.warn('[browser-local-storage] importFromFile failed', e);
        }
        return null;
    }
}
