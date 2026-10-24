/**
 * Starts the cached entries read as the page boots, so the snapshot is ready by the time the
 * shell asks for the note list (TOL-206). Web-only, like the cache itself.
 */

import { type CachedEntries, readCache } from "./entriesCache.ts";

let prefetched: Promise<CachedEntries | null> | null = null;

/** Begins reading the snapshot now; the next `takeCache` gets this read. */
export function prefetchCache(): void {
	prefetched ??= readCache();
}

/** The read `prefetchCache` started, or a fresh one. Each prefetch serves one read. */
export function takeCache(): Promise<CachedEntries | null> {
	const read = prefetched ?? readCache();
	prefetched = null;
	return read;
}
