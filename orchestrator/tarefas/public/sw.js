/* COMPASSO — service worker: a casca do app abre na hora e abre sem rede. Nunca guarda dado de tarefa: /api passa direto.
   __V__ é trocado pelo servidor: versão nova = cache novo, o antigo é apagado. */
const CACHE = 'compasso-__V__';
const CASCA = ['/', '/app.css?v=__V__', '/nucleo.js?v=__V__', '/i18n.js?v=__V__', '/app.js?v=__V__', '/icon.svg'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/') || u.pathname === '/mcp' || u.pathname.startsWith('/oauth/') || u.pathname.startsWith('/.well-known/') || u.pathname === '/health') return;
  // Página: rede primeiro (traz a versão nova), casca guardada se não houver rede. Arquivos versionados: nunca mudam.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
