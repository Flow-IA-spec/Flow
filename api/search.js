// Pesquisa profunda com progresso em tempo real via SSE
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { query } = req.body;
  if (!query) return res.status(400).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} };

  try {
    send({ type: 'status', msg: '🔍 Buscando no DuckDuckGo…' });
    const rawResults = await getDDGResults(query);

    if (!rawResults.length) {
      send({ type: 'status', msg: 'Nenhum resultado encontrado' });
      send({ type: 'done', results: [] });
      return res.end();
    }

    send({ type: 'status', msg: `${rawResults.length} resultado(s) encontrado(s)` });

    // Lê as páginas sequencialmente para mostrar progresso real
    const toRead = rawResults.filter(r => r.url?.startsWith('http') && !r.url.includes('duckduckgo.com')).slice(0, 3);
    for (let i = 0; i < toRead.length; i++) {
      send({ type: 'status', msg: `📖 Lendo página ${i + 1} de ${toRead.length}…` });
      toRead[i].content = await readPageContent(toRead[i].url);
      const emoji = toRead[i].content ? '✓' : '✗';
      send({ type: 'status', msg: `${emoji} Página ${i + 1} ${toRead[i].content ? 'lida' : 'indisponível'}` });
    }

    send({ type: 'done', results: rawResults });
  } catch (err) {
    send({ type: 'done', results: [] });
  }
  res.end();
}

// ── DuckDuckGo HTML scraping ─────────────────────────────────
async function getDDGResults(query) {
  const results = [];
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`;
    const resp = await fetchTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      }
    }, 7000);

    if (resp?.ok) {
      const html = await resp.text();
      const blocks = html.split('<div class="result ');
      for (let i = 1; i < blocks.length && results.length < 5; i++) {
        const block = blocks[i];
        let url = '';
        const hrefMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
        if (hrefMatch) {
          const uddg = hrefMatch[1].match(/uddg=([^&"]+)/);
          url = uddg ? decodeURIComponent(uddg[1]) : hrefMatch[1];
        }
        const title = (block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/) || [])[1]?.replace(/<[^>]+>/g,'').trim();
        const desc  = (block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) || [])[1]?.replace(/<[^>]+>/g,'').trim();
        if (title && desc) results.push({ title, description: desc, url });
      }
    }
  } catch {}

  // Fallback Instant Answer
  if (!results.length) {
    try {
      const r = await fetchTimeout(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`, {headers:{'User-Agent':'Flow-AI/1.0'}}, 5000);
      if (r?.ok) {
        const d = await r.json();
        if (d.AbstractText) results.push({ title: d.Heading||query, description: d.AbstractText, url: d.AbstractURL||'' });
        for (const t of (d.RelatedTopics||[])) {
          if (results.length >= 5) break;
          if (t.Text && t.FirstURL) results.push({ title: t.Text.split(' - ')[0].slice(0,80), description: t.Text, url: t.FirstURL });
          if (t.Topics) for (const s of t.Topics) {
            if (results.length >= 5) break;
            if (s.Text && s.FirstURL) results.push({ title: s.Text.slice(0,80), description: s.Text, url: s.FirstURL });
          }
        }
        if (d.Answer && !results.length) results.push({ title: 'Resposta direta', description: d.Answer, url: '' });
      }
    } catch {}
  }
  return results;
}

// ── Lê o conteúdo HTML real da página ────────────────────────
async function readPageContent(url) {
  try {
    const resp = await fetchTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      },
      redirect: 'follow',
    }, 6000);

    if (!resp?.ok) return null;
    if (!(resp.headers.get('content-type')||'').includes('text/html')) return null;

    const html = await resp.text();
    const content = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
      .replace(/\s+/g,' ').trim().slice(0, 4500);

    return content || null;
  } catch { return null; }
}

// ── Fetch com timeout manual ──────────────────────────────────
function fetchTimeout(url, opts={}, ms=5000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    fetch(url, opts).then(r => { clearTimeout(t); res(r); }).catch(e => { clearTimeout(t); rej(e); });
  });
  }
               
