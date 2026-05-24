const CACHE = 'flow-images-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// Clique na notificação → abre o app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      for(const c of list){ if('focus' in c) return c.focus(); }
      if(clients.openWindow) return clients.openWindow('/');
    })
  );
});

// Cache de imagens geradas para recarregar sem buscar de novo
self.addEventListener('fetch', event => {
  if(event.request.url.includes('image.pollinations.ai')){
    event.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if(cached) return cached;
          return fetch(event.request).then(response => {
            if(response.ok) cache.put(event.request, response.clone());
            return response;
          });
        })
      )
    );
  }
});
