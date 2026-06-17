type Entry = { url: string; size: number; used: number };

const cache = new Map<number, Entry>(); // key = cyrb53(dataUri)
let totalBytes = 0;
let useTick = 0;
let budget = 256 * 1024 * 1024; // 256 MB default; override via State options
const warmQueue: string[] = [];

/**
 * Sets the maximum total size (in bytes) of cached image blobs. When exceeded,
 * least-recently-used blobs are revoked — except those still referenced by a
 * live <img> in the DOM, which override the budget.
 */
export function setImageMemoryBudget(bytes: number): void {
  if (typeof bytes === "number" && bytes > 0) {
    budget = bytes;
    evict();
  }
}

/** Cheap check: is this string a base64 data URI we should cache? */
export function isBase64DataUri(s: string): boolean {
  return s.charCodeAt(0) === 100 /* 'd' */ && s.startsWith("data:") && s.includes(";base64,");
}

// cyrb53 — fast, well-distributed 53-bit string hash.
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function dataUriToBlob(uri: string): Blob {
  const comma = uri.indexOf(",");
  const semi = uri.indexOf(";");
  const mime = (semi > 5 ? uri.slice(5, semi) : "") || "application/octet-stream";
  const bin = atob(uri.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Render-time: returns a cached blob: URL for the given base64 data URI,
 * converting and caching it on a miss. Identical data URIs share one blob.
 */
export function resolveImageSrc(uri: string): string {
  const key = cyrb53(uri);
  const hit = cache.get(key);
  if (hit) {
    hit.used = ++useTick;
    return hit.url;
  }
  const blob = dataUriToBlob(uri);
  const url = URL.createObjectURL(blob);
  cache.set(key, { url, size: blob.size, used: ++useTick });
  totalBytes += blob.size;
  evict();
  return url;
}

function evict(): void {
  if (totalBytes <= budget) return;
  const inUse = new Set<string>();
  document.querySelectorAll("img").forEach((img) => {
    const s = img.currentSrc || img.getAttribute("src") || "";
    if (s.startsWith("blob:")) inUse.add(s);
  });
  const lru = [...cache.entries()].sort((a, b) => a[1].used - b[1].used);
  for (const [key, e] of lru) {
    if (totalBytes <= budget) break;
    if (inUse.has(e.url)) continue; // in-use blobs override the budget
    URL.revokeObjectURL(e.url);
    cache.delete(key);
    totalBytes -= e.size;
  }
}

/** Queues base64 data URIs to be converted + pre-decoded during idle frames. */
export function enqueueWarm(list: string[]): void {
  for (const uri of list) {
    if (typeof uri === "string" && isBase64DataUri(uri)) warmQueue.push(uri);
  }
}

/** Processes up to `maxPerFrame` queued images: convert, cache, pre-decode. */
export function processWarmQueue(maxPerFrame: number): void {
  let n = 0;
  while (warmQueue.length && n < maxPerFrame) {
    const uri = warmQueue.shift() as string;
    const url = resolveImageSrc(uri);
    const probe = new Image();
    probe.src = url;
    probe.decode?.().catch(() => {});
    n++;
  }
}
