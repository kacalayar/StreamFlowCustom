
const CACHE_NAME = 'streamflow-v2-cache';
const CACHE_VERSION = '1.0.0';
const FULL_CACHE_NAME = `${CACHE_NAME}-${CACHE_VERSION}`;

const STATIC_RESOURCES = [
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.30.0/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.30.0/fonts/tabler-icons.woff2',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.30.0/fonts/tabler-icons.woff',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.30.0/fonts/tabler-icons.ttf',
  
  '/css/styles.css',
  '/js/stream-modal.js',
  
  '/images/logo.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(FULL_CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching static resources');
        return cache.addAll(STATIC_RESOURCES);
      })
      .then(() => {
        console.log('Service Worker: All resources cached successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Service Worker: Failed to cache resources', error);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName.startsWith(CACHE_NAME) && cacheName !== FULL_CACHE_NAME) {
              console.log('Service Worker: Deleting old cache', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Activated');
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  if (isStaticResource(event.request.url)) {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            console.log('Service Worker: Serving from cache', event.request.url);
            return cachedResponse;
          }

          return fetch(event.request)
            .then((response) => {
              if (!response || response.status !== 200 || response.type !== 'basic' && response.type !== 'cors') {
                return response;
              }

              const responseToCache = response.clone();

              caches.open(FULL_CACHE_NAME)
                .then((cache) => {
                  cache.put(event.request, responseToCache);
                  console.log('Service Worker: Cached new resource', event.request.url);
                })
                .catch((cacheError) => {
                  console.warn('Service Worker: Cache put skipped', cacheError.message);
                });

              return response;
            })
            .catch((error) => {
              console.error('Service Worker: Fetch failed', error);
              throw error;
            });
        })
    );
  }
});

function isStaticResource(url) {
  const normalizedUrl = url.split('?')[0];
  const isListedResource = STATIC_RESOURCES.some(resource => normalizedUrl.includes(resource.split('?')[0]));
  const isCdnResource =
    normalizedUrl.includes('tabler-icons') ||
    normalizedUrl.includes('cdn.jsdelivr.net');
  const hasStaticExtension =
    normalizedUrl.endsWith('.css') ||
    normalizedUrl.endsWith('.js') ||
    normalizedUrl.endsWith('.woff2') ||
    normalizedUrl.endsWith('.woff') ||
    normalizedUrl.endsWith('.ttf') ||
    normalizedUrl.endsWith('.svg');

  return isListedResource || isCdnResource || hasStaticExtension;
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});