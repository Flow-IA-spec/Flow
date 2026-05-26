// Pesquisa com progresso SSE — DDG Lite + Instant Answer + leitura de páginas
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { query } = req.body;
  if (!query) return res.status(400).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Desativa buffering no Vercel

  const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} };

  try {
    send({ type: 'status', msg: '🔍 Buscando resultados…' });

    // Tenta as duas fontes em paralelo e pega a que tiver mais resultados
    const [liteResults, iaResults] = await Promise.all([
      getDDGLiteResults(query).catch(() => []),
      getDDGInstantAnswer(query).catch(() => []),
    ]);

    let rawResults = liteResults.length >= iaResults.length ? liteResults : iaResults;

    // Se Lite trouxe pelo menos 2, usa ele; senão mescla
    if (liteResults.length >= 2) {
      rawResults = liteResults;
    } else {
      // Mescla removendo duplicatas por URL
      const seen = new Set(liteResults.map(r => r.url));
      rawResults = [...liteResults, ...iaResults.filter(r => !seen.has(r.url))];
    }

    rawResults = rawResults.slice(0, 5);

    if (!rawResults.length) {
      send({ type: 'status', msg: '⚠️ Nenhum resultado encontrado' });
      send({ type: 'done', results: [] });
      return res.end();
    }

    send({ type: 'status', msg: `${rawResults.length} resultado(s) encontrado(s)` });

    // Lê páginas sequencialmente para mostrar progresso
    const toRead = rawResults
      .filter(r => r.url?.startsWith('http') && !r.url.includes('duckduckgo.com'))
      .slice(0, 3);

    for (let i = 0; i < toRead.length; i++) {
      send({ type: 'status', msg: `📖 Lendo página ${i + 1} de ${toRead.length}…` });
      toRead[i].content = await readPageContent(toRead[i].url);
      send({ type: 'status', msg: `${toRead[i].content ? '✓' : '✗'} Página ${i + 1} ${toRead[i].content ? 'lida' : 'indisponível'}` });
    }

    send({ type: 'done', results: rawResults });
  } catch (err) {
    send({ type: 'done', results: [] });
  }
  res.end();
}

// ── DDG Lite (HTML simples, menos bloqueado) ──────────────────
async function getDDGLiteResults(query) {
  const results = [];
  try {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const resp = await fetchTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
        'Referer': 'https://lite.duckduckgo.com/',
      }
    }, 7000);

    if (!resp?.ok) return results;
    const html = await resp.text();

    // DDG Lite usa tabela simples com links
    // Padrão: <a class="result-link" href="...">título</a> + <td class="result-snippet">...
    const linkRe = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;

    const links = [], snippets = [];
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      links.push({ url: decodeHTMLEntities(m[1]), title: m[2].replace(/<[^>]+>/g,'').trim() });
    }
    while ((m = snippetRe.exec(html)) !== null) {
      snippets.push(m[1].replace(/<[^>]+>/g,'').trim());
    }

    for (let i = 0; i < Math.min(links.length, 5); i++) {
      if (links[i].title && links[i].url) {
        results.push({
          title: links[i].title,
          description: snippets[i] || links[i].title,
          url: links[i].url,
        });
      }
    }
  } catch {}
  return results;
}

// ── DDG Instant Answer API ────────────────────────────────────
async function getDDGInstantAnswer(query) {
  const results = [];
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const resp = await fetchTimeout(url, {
      headers: { 'User-Agent': 'Flow-AI-Assistant/1.0' }
    }, 5000);

    if (!resp?.ok) return results;
    const d = await resp.json();

    if (d.AbstractText) results.push({ title: d.Heading || query, description: d.AbstractText, url: d.AbstractURL || '' });
    if (d.Answer)       results.push({ title: 'Resposta direta', description: d.Answer, url: '' });

    for (const t of (d.RelatedTopics || [])) {
      if (results.length >= 5) break;
      if (t.Text && t.FirstURL) {
        results.push({ title: t.Text.split(' - ')[0].slice(0, 80), description: t.Text, url: t.FirstURL });
      }
      if (t.Topics) {
        for (const s of t.Topics) {
          if (results.length >= 5) break;
          if (s.Text && s.FirstURL) results.push({ title: s.Text.slice(0, 80), description: s.Text, url: s.FirstURL });
        }
      }
    }
  } catch {}
  return results;
}

// ── Lê conteúdo HTML da página ───────────────────────────────
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
    if (!(resp.headers.get('content-type') || '').includes('text/html')) return null;

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
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ').trim().slice(0, 4500);

    return content || null;
  } catch { return null; }
}

function decodeHTMLEntities(str) {
  return str.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}

function fetchTimeout(url, opts = {}, ms = 5000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    fetch(url, opts).then(r => { clearTimeout(t); res(r); }).catch(e => { clearTimeout(t); rej(e); });
  });
}
