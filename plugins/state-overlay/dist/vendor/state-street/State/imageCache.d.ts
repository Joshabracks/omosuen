/**
 * Sets the maximum total size (in bytes) of cached image blobs. When exceeded,
 * least-recently-used blobs are revoked — except those still referenced by a
 * live <img> in the DOM, which override the budget.
 */
export declare function setImageMemoryBudget(bytes: number): void;
/** Cheap check: is this string a base64 data URI we should cache? */
export declare function isBase64DataUri(s: string): boolean;
/**
 * Render-time: returns a cached blob: URL for the given base64 data URI,
 * converting and caching it on a miss. Identical data URIs share one blob.
 */
export declare function resolveImageSrc(uri: string): string;
/** Sets how many queued images the shared warm loop decodes per frame (default 4). */
export declare function setWarmPerFrame(n: number): void;
/**
 * Queues base64 data URIs to be converted + pre-decoded during idle frames. Starts a
 * self-limiting drain loop (owned here, not by any particular State instance) if one
 * isn't already running -- it stops itself once the queue is empty.
 */
export declare function enqueueWarm(list: string[]): void;
/** Processes up to `maxPerFrame` queued images: convert, cache, pre-decode. */
export declare function processWarmQueue(maxPerFrame: number): void;
