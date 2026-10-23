/**
 * Tolaria web service worker: caches the shell, entries API, and recently
 * opened notes for offline read access. Hand-written; no Workbox dependency.
 *
 * Registered only in the web build (apps/web), never in the Tauri desktop app.
 */

const CACHE_VERSION = 'tolaria-web-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const API_CACHE = `${CACHE_VERSION}-api`;
const NOTES_CACHE = `${CACHE_VERSION}-notes`;

// Shell assets to cache on install
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// Cache note content for up to 50 recently opened notes
const MAX_CACHED_NOTES = 50;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
  // Skip waiting to activate immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Clean up old caches
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            return name.startsWith('tolaria-web-') && 
                   name !== SHELL_CACHE && 
                   name !== API_CACHE && 
                   name !== NOTES_CACHE;
          })
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

/**
 * Returns true if the request is for the entries list API endpoint.
 */
function isEntriesRequest(url) {
  return url.pathname === '/api/vault/entries' || url.pathname.endsWith('/v1/entries');
}

/**
 * Returns true if the request is for a note file API endpoint.
 */
function isNoteFileRequest(url) {
  return url.pathname.startsWith('/api/vault/files/') || 
         (url.pathname.includes('/v1/files/') && url.pathname !== '/v1/files/');
}

/**
 * Returns true if the request is for an API endpoint that should be cached.
 */
function isCacheableApiRequest(url) {
  return isEntriesRequest(url) || isNoteFileRequest(url);
}

/**
 * Enforces the note cache size limit by removing the least recently used entries.
 */
async function enforceCacheLimit(cache, limit) {
  const requests = await cache.keys();
  if (requests.length <= limit) return;
  
  // Remove oldest entries (FIFO)
  const toDelete = requests.slice(0, requests.length - limit);
  await Promise.all(toDelete.map((request) => cache.delete(request)));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Network-first for API requests when online
  if (isCacheableApiRequest(url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful API responses
          if (response.ok) {
            const cacheName = isEntriesRequest(url) ? API_CACHE : NOTES_CACHE;
            const responseToCache = response.clone();
            
            caches.open(cacheName).then((cache) => {
              cache.put(event.request, responseToCache);
              
              // Enforce note cache limit
              if (cacheName === NOTES_CACHE) {
                enforceCacheLimit(cache, MAX_CACHED_NOTES);
              }
            });
          }
          return response;
        })
        .catch(() => {
          // Network failed, try cache
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // No cache, return a network error response
            return new Response('Offline', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/plain' }
            });
          });
        })
    );
    return;
  }
  
  // Cache-first for shell assets
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        // Not in cache, fetch from network and cache for next time
        return fetch(event.request).then((response) => {
          if (response.ok && event.request.method === 'GET') {
            const responseToCache = response.clone();
            caches.open(SHELL_CACHE).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        });
      })
    );
    return;
  }
  
  // Let other requests (external APIs, etc.) pass through
  event.respondWith(fetch(event.request));
});
