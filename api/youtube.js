// Resume vídeo do YouTube extraindo legendas do ytInitialPlayerResponse
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { url } = req.body || {};
  const videoId = url?.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
  if (!videoId) return res.status(400).json({ error: 'URL do YouTube inválida' });

  try {
    // Busca a página do YouTube
    const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie': 'CONSENT=YES+cb.20230101-07-p0.pt+FX+901; SOCS=CAE=',
      },
    });

    if (!pageResp.ok) throw new Error('HTTP ' + pageResp.status);
    const html = await pageResp.text();

    // Extrai título
    let title = videoId;
    try {
      const tm = html.match(/"title":"((?:[^"\\]|\\.)*)"/);
      if (tm) title = tm[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\').slice(0, 120);
    } catch {}

    // Extrai ytInitialPlayerResponse
    let playerData = null;
    const patterns = [
      /ytInitialPlayerResponse\s*=\s*({.+?})\s*;(?:\s*(?:var|const|let)\s+\w|\s*<\/script>)/s,
      /ytInitialPlayerResponse\s*=\s*({.+?})\s*;/s,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) {
        try { playerData = JSON.parse(m[1]); break; } catch {}
      }
    }

    // Pega caption tracks do playerData
    const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    if (captionTracks.length > 0) {
      // Prioriza PT depois EN depois qualquer outra
      const langs = ['pt', 'pt-BR', 'pt-PT', 'en', 'en-US'];
      let track = null;
      for (const lang of langs) {
        track = captionTracks.find(t => t.languageCode === lang || t.languageCode?.startsWith(lang.split('-')[0]));
        if (track) break;
      }
      if (!track) track = captionTracks[0];

      try {
        const captUrl = track.baseUrl + '&fmt=srv3';
        const captResp = await fetch(captUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (captResp.ok) {
          const xml = await captResp.text();
          if (xml.includes('<text')) {
            const transcript = xml
              .replace(/<[^>]+>/g, ' ')
              .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
              .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, ' ')
              .replace(/\s+/g, ' ').trim();

            if (transcript.length > 80) {
              return res.json({ title, transcript: transcript.slice(0, 9000), type: 'transcript', lang: track.languageCode });
            }
          }
        }
      } catch {}
    }

    // Fallback: descrição do vídeo
    const desc = playerData?.videoDetails?.shortDescription;
    if (desc && desc.length > 20) {
      return res.json({ title, transcript: desc.slice(0, 5000), type: 'description' });
    }

    // Fallback: tentar timedtext legado
    for (const lang of ['pt', 'pt-BR', 'en']) {
      try {
        const r = await fetch(`https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}&fmt=srv3`);
        if (r.ok) {
          const xml = await r.text();
          if (xml.includes('<text')) {
            const t = xml.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
            if (t.length > 80) return res.json({ title, transcript: t.slice(0, 9000), type: 'transcript' });
          }
        }
      } catch {}
    }

    res.status(404).json({
      error: 'Vídeo sem legendas detectáveis. Tente um vídeo com legendas automáticas ativadas, ou que tenha descrição longa.'
    });

  } catch (e) {
    res.status(500).json({ error: 'Erro ao processar: ' + e.message });
  }
}
