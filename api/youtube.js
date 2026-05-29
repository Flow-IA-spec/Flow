// Resume vídeo do YouTube via legendas ou metadados
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { url } = req.body || {};
  const videoId = url?.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
  if (!videoId) return res.status(400).json({ error: 'URL do YouTube inválida' });

  // Tenta legendas em PT e EN
  for (const lang of ['pt', 'pt-BR', 'en']) {
    try {
      const r = await fetch(`https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (r.ok) {
        const xml = await r.text();
        if (xml.includes('<text')) {
          const transcript = xml
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"')
            .replace(/\s+/g,' ').trim();
          if (transcript.length > 100) {
            const title = await getVideoTitle(videoId);
            return res.json({ title, transcript: transcript.slice(0, 8000), type: 'transcript' });
          }
        }
      }
    } catch {}
  }

  // Fallback: metadados da página
  try {
    const pr = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124', 'Accept-Language': 'pt-BR,pt;q=0.9' }
    });
    const html = await pr.text();
    const rawTitle = html.match(/"title":"((?:[^"\\]|\\.)*)"/)?.[1] || videoId;
    const title = rawTitle.replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\\\/g,'\\');
    const rawDesc = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1] || '';
    const description = rawDesc.replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\\\/g,'\\');
    if (description) return res.json({ title, transcript: description.slice(0, 4000), type: 'description' });
  } catch {}

  res.status(404).json({ error: 'Vídeo sem legendas disponíveis. Tente um vídeo com legendas automáticas.' });
}

async function getVideoTitle(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await r.text();
    const m = html.match(/"title":"((?:[^"\\]|\\.)*)"/)?.[1] || videoId;
    return m.replace(/\\n/g,' ').replace(/\\"/g,'"');
  } catch { return videoId; }
}
