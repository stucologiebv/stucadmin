const CACHE_NAME = 'stucadmin-v2';
const OFFLINE_URL = '/offline.html';

// Files to cache for offline use
const STATIC_ASSETS = [
  '/',
  '/dashboard.html',
  '/login.html',
  '/logo-stucadmin.svg',
  '/manifest.json'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker activated');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip API requests (always fetch fresh)
  if (event.request.url.includes('/api/')) return;
  
  // Skip external CDN requests - let browser handle them directly
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached version, but also update cache in background
        event.waitUntil(
          fetch(event.request).then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, response);
              });
            }
          }).catch(() => {})
        );
        return cachedResponse;
      }
      
      // Not in cache, fetch from network
      return fetch(event.request).then((response) => {
        // Cache successful responses
        if (response.ok && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      }).catch(() => {
        // Offline fallback for HTML pages
        if (event.request.headers.get('accept').includes('text/html')) {
          return caches.match(OFFLINE_URL);
        }
      });
    })
  );
});

// Background sync for offline form submissions (future use)
self.addEventListener('sync', (event) => {
  console.log('🔄 Background sync:', event.tag);
});

// Push notifications (future use)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/logo-stucadmin.svg',
      badge: '/logo-stucadmin.svg'
    });
  }
});
