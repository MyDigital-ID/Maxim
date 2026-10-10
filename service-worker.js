// ============================================================
// Maxim Casual Wear — Service Worker
// نسخة: v2.0.3
// ============================================================

const CACHE_VERSION = 'maxim-v2.0.3';
const STATIC_CACHE  = CACHE_VERSION + '-static';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

// ============================================================
// الملفات اللي تتخزن من الأول
// ============================================================
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './site-data-loader.js',
  './manifest.json',
  './site-data.json',
  './admin.html',
  './admin.js',
  './assets/images/icon-192.png',
  './assets/images/icon-512.png',
  './assets/images/apple-touch-icon.png',
  './assets/images/splash-lower.jpg',
  './assets/images/qr-code.png',
  './assets/images/logo-main.jpg'
];

// ============================================================
// تثبيت Service Worker
// كل ملف يتخزن لوحده: لو ملف فشل، الباقي يتخزن عادي
// ============================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing version:', CACHE_VERSION);

  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.all(
        STATIC_ASSETS.map((url) =>
          fetch(new Request(url, { cache: 'reload' }))
            .then((res) => {
              if (!res.ok) throw new Error('HTTP ' + res.status);
              return cache.put(cacheKey(new Request(url)), res);
            })
            .catch((err) => {
              console.warn('[SW] Could not cache:', url, err.message);
            })
        )
      )
    )
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
          if (cacheName.startsWith('maxim-') &&
              cacheName !== STATIC_CACHE &&
              cacheName !== RUNTIME_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ============================================================
// اعتراض الطلبات
// ============================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // تجاهل غير GET
  if (request.method !== 'GET') return;

  // تجاهل الطلبات الخارجية (Unsplash، Google Fonts، واتساب...)
  if (url.origin !== location.origin) return;

  // الصور: Cache First
  if (isImage(request)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // باقي الملفات (HTML / CSS / JS / JSON): Network First
  event.respondWith(networkFirst(request));
});

// ============================================================
// مفتاح التخزين
// ملفات JSON تتخزن بدون ?t=... عشان تتلاقي أوفلاين
// ============================================================
function cacheKey(request) {
  const url = new URL(request.url);
  if (url.pathname.toLowerCase().endsWith('.json')) {
    return url.origin + url.pathname;
  }
  return request;
}

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
// Network First (للبيانات و HTML و CSS و JS)
// ============================================================
async function networkFirst(request) {
  const key = cacheKey(request);

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(key, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(key);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const page = await caches.match(request, { ignoreSearch: true });
      if (page) return page;
      const offline = await caches.match('./index.html');
      if (offline) return offline;
    }

    return new Response('Offline', { status: 503 });
  }
}

// ============================================================
// أدوات التحقق
// ============================================================
function isImage(request) {
  const url = request.url.toLowerCase().split('?')[0];
  return /\.(png|jpg|jpeg|gif|webp|svg|ico)$/.test(url) ||
         request.destination === 'image';
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

console.log('🚀 [SW] Maxim Service Worker loaded —', CACHE_VERSION);
