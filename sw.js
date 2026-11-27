/* 仅缓存不变的标识牌字体文件，避免跨国弱网重复拉取；不缓存页面、脚本或样式。 */
'use strict';

const FONT_CACHE_PREFIX = 'crt-sign-fonts-cache-';
const FONT_CACHE_NAME = FONT_CACHE_PREFIX + 'v1';
const FONT_PATH_PATTERN = /(?:^|\/)(?:fonts-subsets|fonts)\/.+\.(?:woff2|ttf|otf)$/i;

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name.startsWith(FONT_CACHE_PREFIX) && name !== FONT_CACHE_NAME)
        .map(name => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

async function fetchWithRetry(request, attempts) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(request);
      if (response.ok || (response.status >= 400 && response.status < 500)) return response;
      lastError = new Error('HTTP ' + response.status);
    } catch (error) {
      lastError = error;
    }
    if (i < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, 300 * Math.pow(3, i)));
    }
  }
  throw lastError;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); }
  catch { return; }
  if (url.origin !== self.location.origin) return;
  if (!FONT_PATH_PATTERN.test(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(FONT_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetchWithRetry(request, 3);
    if (response && response.ok && response.status === 200) {
      await cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_FONT_CACHE') {
    event.waitUntil(caches.delete(FONT_CACHE_NAME));
  }
});
