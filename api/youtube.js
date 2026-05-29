// Resumo de YouTube via Invidious API (open-source, sem chave)
const INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.privacydev.net',
  'https://yt.cdaut.de',
  'https://invidious.slipfox.xyz',
  'https://invidious.io',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { url } = req.body || {};
  const videoId = url?.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
  if (!videoId) return res.status(400).json({ error: 'URL do YouTube inválida' });

  // Tenta cada instância do Invidious
  for (const base of INSTANCES) {
    try {
      const r = await fetchT(`${base}/api/v1/videos/${videoId}?fields=title,captions,description`, 6000);
      if (!r?.ok) continue;
      const data = await r.json();
      if (!data || data.error) continue;

      const title = data.title || videoId;

      // Procura legenda em PT ou EN
      const captions = data.captions || [];
      const langs = ['pt','pt-BR','Portuguese','en','English'];
      let cap = null;
      for (const l of langs) {
        cap = captions.find(c => c.languageCode?.startsWith(l.split('-')[0]) || c.label?.toLowerCase().includes(l.toLowerCase()));
        if (cap) break;
      }
      if (!cap && captions.length) cap = captions[0];

      if (cap) {
        try {
          const captUrl = cap.url?.startsWith('http') ? cap.url : `${base}${cap.url}`;
          const cr = await fetchT(captUrl, 5000);
          if (cr?.ok) {
            const txt = await cr.text();
            const transcript = txt
              .replace(/<[^>]+>/g,' ')
              .replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
              .replace(/\d{2}:\d{2}:\d{2}[\.,]\d{3}/g,'')
              .replace(/^WEBVTT.*/m,'')
              .replace(/\s+/g,' ').trim();
            if (transcript.length > 80) {
              return res.json({ title, transcript: transcript.slice(0, 9000), type: 'transcript' });
            }
          }
        } catch {}
      }

      // Fallback: usa descrição do vídeo
      const desc = data.description || '';
      if (desc.length > 50) {
        return res.json({ title, transcript: desc.slice(0, 5000), type: 'description' });
      }
    } catch {}
  }

  // Último recurso: página do YouTube com regex
  try {
    const pr = await fetchT(`https://www.youtube.com/watch?v=${videoId}`, 8000, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'Cookie': 'CONSENT=YES+cb; SOCS=CAE=',
    });
    if (pr?.ok) {
      const html = await pr.text();
      const title = html.match(/"title":"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\./g, m => m === '\\n' ? ' ' : m.slice(1)) || videoId;
      const desc = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\\\/g,'\\') || '';
      if (desc.length > 50) return res.json({ title, transcript: desc.slice(0, 5000), type: 'description' });
    }
  } catch {}

  res.status(404).json({ error: 'Não foi possível obter legendas ou descrição deste vídeo. Tente outro vídeo.' });
}

function fetchT(url, ms, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...extraHeaders } })
      .then(r => { clearTimeout(t); resolve(r); })
      .catch(e => { clearTimeout(t); reject(e); });
  });
}
