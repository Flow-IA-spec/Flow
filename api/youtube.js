import { YoutubeTranscript } from 'youtube-transcript';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { url } = req.body || {};
  const videoId = url?.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
  if (!videoId) return res.status(400).json({ error: 'URL do YouTube inválida' });

  // Título via oEmbed (sempre funciona)
  let title = videoId;
  try {
    const oe = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (oe.ok) title = (await oe.json()).title || videoId;
  } catch {}

  // ESTRATÉGIA 1: youtube-transcript (mais confiável)
  for (const lang of ['pt', 'en', null]) {
    try {
      const opts = lang ? { lang } : {};
      const items = await YoutubeTranscript.fetchTranscript(videoId, opts);
      if (items?.length) {
        const transcript = items.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim();
        if (transcript.length > 80)
          return res.json({ title, transcript: transcript.slice(0, 9000), type: 'transcript' });
      }
    } catch {}
  }

  // ESTRATÉGIA 2: Invidious API
  const instances = ['https://inv.nadeko.net', 'https://invidious.privacydev.net', 'https://yt.cdaut.de'];
  for (const base of instances) {
    try {
      const r = await Promise.race([
        fetch(`${base}/api/v1/videos/${videoId}?fields=title,captions,description`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
      ]);
      if (!r?.ok) continue;
      const d = await r.json();
      if (d?.error) continue;
      if (d.title) title = d.title;

      const cap = (d.captions||[]).find(c => /^pt/i.test(c.languageCode))
               || (d.captions||[]).find(c => /^en/i.test(c.languageCode))
               || (d.captions||[])[0];

      if (cap?.url) {
        const capUrl = cap.url.startsWith('http') ? cap.url : `${base}${cap.url}`;
        const cr = await Promise.race([
          fetch(capUrl),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
        ]);
        if (cr?.ok) {
          const xml = await cr.text();
          const t = xml.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
          if (t.length > 80) return res.json({ title, transcript: t.slice(0, 9000), type: 'transcript' });
        }
      }
      if (d.description?.length > 50)
        return res.json({ title, transcript: d.description.slice(0, 5000), type: 'description' });
    } catch {}
  }

  // ESTRATÉGIA 3: Scraping do ytInitialPlayerResponse
  try {
    const pr = await Promise.race([
      fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: { 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124', 'Accept-Language':'pt-BR,pt;q=0.9', 'Cookie':'CONSENT=YES+cb; SOCS=CAE=' }
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
    ]);
    if (pr?.ok) {
      const html = await pr.text();
      const rawT = html.match(/"title":"((?:[^"\\]|\\.)*)"/)?.[1];
      if (rawT) title = rawT.replace(/\\n/g,' ').replace(/\\"/g,'"').replace(/\\\\/g,'\\');

      // Extrai ytInitialPlayerResponse por brace counting
      const marker = 'ytInitialPlayerResponse = ';
      const mIdx = html.indexOf(marker);
      if (mIdx !== -1) {
        let depth=0, i=mIdx+marker.length, s=i, pd=null;
        for(; i<Math.min(html.length,mIdx+900000); i++){
          if(html[i]==='{') depth++;
          else if(html[i]==='}'){depth--; if(depth===0){try{pd=JSON.parse(html.slice(s,i+1));}catch{} break;}}
        }
        if (pd) {
          const tracks = pd?.captions?.playerCaptionsTracklistRenderer?.captionTracks||[];
          const track = tracks.find(t=>/^pt/i.test(t.languageCode))||tracks.find(t=>/^en/i.test(t.languageCode))||tracks[0];
          if (track?.baseUrl) {
            const cr = await fetch(track.baseUrl+'&fmt=srv3');
            if (cr.ok) {
              const xml = await cr.text();
              const t = xml.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
              if (t.length > 80) return res.json({ title, transcript: t.slice(0,9000), type: 'transcript' });
            }
          }
          const desc = pd?.videoDetails?.shortDescription||'';
          if (desc.length > 50) return res.json({ title, transcript: desc.slice(0,5000), type: 'description' });
        }
      }
    }
  } catch {}

  res.status(404).json({ error: `Não foi possível obter legendas do vídeo "${title}". O vídeo pode não ter legendas automáticas ativadas.` });
}
