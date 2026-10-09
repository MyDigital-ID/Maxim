// ============================================================
// Maxim Casual Wear - Service Worker
// نسخة: v2.0.0
// ============================================================

const CACHE_VERSION = 'maxim-v2.0.0';
const STATIC_CACHE = CACHE_VERSION + '-static';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

// ملفات ثابتة - نخزنها من الأول
  './assets/images/icon-192.png',
  './assets/images/icon-512.png',
  './assets/images/apple-touch-icon.png',
  './assets/images/splash-lower.jpg',
  './assets/images/qr-code.png',
  './assets/images/logo-main.jpg'
];
// ============================================================
// تثبيت Service Worker
// ============================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing version:', CACHE_VERSION);

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
      })
      .catch((err) => {
        console.warn('[SW] Failed to cache some assets:', err);
      })
  );

  self.skipWaiting();
});

// ============================================================
// تنشيط Service Worker
// ============================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version:', CACHE_VERSION);

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName.startsWith('maxim-') && cacheName !== STATIC_CACHE && cacheName !== RUNTIME_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// ============================================================
// اعتراض الطلبات
// ============================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== location.origin) return;
  if (url.hostname.includes('github.com') || url.hostname.includes('githubusercontent.com')) return;
  if (request.method !== 'GET') return;

  if (isImage(request)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isData(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isDocument(request) || isStyleScript(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

// ============================================================
// Cache First (للصور)
// ============================================================
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return new Response('', { status: 404 });
  }
}

// ============================================================
// Network First (للبيانات والـ HTML)
// ============================================================
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const offline = await caches.match('./index.html');
      if (offline) return offline;
    }

    return new Response('Offline', { status: 503 });
  }
}

// ============================================================
// أدوات
// ============================================================
function isImage(request) {
  const url = request.url.toLowerCase();
  return url.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i) ||
         request.destination === 'image';
}

function isData(request) {
  return request.url.toLowerCase().endsWith('.json');
}

function isDocument(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

function isStyleScript(request) {
  const url = request.url.toLowerCase();
  return url.endsWith('.css') || url.endsWith('.js') ||
         request.destination === 'style' ||
         request.destination === 'script';
}

// ============================================================
// رسائل من الصفحة
// ============================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      })
    );
  }
});

console.log('🚀 [SW] Service Worker loaded — version', CACHE_VERSION);
