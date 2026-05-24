const CACHE = 'flow-images-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// ——— Background Fetch concluído (imagem pronta mesmo com browser fechado) ———
self.addEventListener('backgroundfetchsuccess', event => {
  const prompt = event.registration.id;
  event.waitUntil((async () => {
    try {
      // Guarda a imagem no cache do SW
      const cache = await caches.open(CACHE);
      const records = await event.registration.matchAll();
      await Promise.all(records.map(async record => {
        const response = await record.responseReady;
        await cache.put(record.request, response.clone());
      }));
    } catch(e) {}

    // Notificação mesmo com browser fechado
    await self.registration.showNotification('Flow — Imagem pronta! 🎨', {
      body: (prompt.length > 70 ? prompt.slice(0, 70) + '…' : prompt),
      tag: 'flow-img',
      renotify: true,
      data: { prompt }
    });

    event.updateUI({ title: 'Imagem pronta!' });

    // Avisa abas abertas para atualizar a UI
    const allClients = await clients.matchAll({ type: 'window' });
    for (const client of allClients) {
      client.postMessage({ type: 'IMAGE_READY', prompt });
    }
  })());
});

self.addEventListener('backgroundfetchfail', event => {
  event.waitUntil((async () => {
    event.updateUI({ title: 'Falhou — abra o app para tentar novamente' });
    const allClients = await clients.matchAll({ type: 'window' });
    for (const client of allClients) {
      client.postMessage({ type: 'IMAGE_FAILED', prompt: event.registration.id });
    }
  })());
});

// Clique na notificação → abre o app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// Permite servir imagens cacheadas offline
self.addEventListener('fetch', event => {
  if (event.request.url.includes('image.pollinations.ai')) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});
