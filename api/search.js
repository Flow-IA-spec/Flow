// Pesquisa profunda: DDG HTML para URLs + Jina AI para ler conteúdo real das páginas
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { query } = req.body;
  if (!query) return res.status(400).json({ results: [] });

  try {
    // ── 1. Busca URLs no DuckDuckGo HTML ─────────────────────────────────
    const rawResults = await getDDGResults(query);

    // ── 2. Lê o conteúdo real das top 3 páginas via Jina AI ──────────────
    //    r.jina.ai/{url} devolve o texto limpo de qualquer página, grátis
    const enriched = await enrichWithPageContent(rawResults.slice(0, 3));

    // Adiciona o restante dos resultados sem conteúdo (se houver)
    const rest = rawResults.slice(3).map(r => ({ ...r, content: null }));

    res.json({ results: [...enriched, ...rest] });
  } catch (err) {
    res.status(500).json({ results: [], error: 'Search failed' });
  }
}

// ── DDG HTML scraping ────────────────────────────────────────────────────
async function getDDGResults(query) {
  const results = [];

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      }
    });

    const html = await resp.text();
    const blocks = html.split('<div class="result ');

    for (let i = 1; i < blocks.length && results.length < 5; i++) {
      const block = blocks[i];

      // URL real (fica no parâmetro uddg do link de redirecionamento)
      let pageUrl = '';
      const hrefMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
      if (hrefMatch) {
        const uddgMatch = hrefMatch[1].match(/uddg=([^&"]+)/);
        pageUrl = uddgMatch ? decodeURIComponent(uddgMatch[1]) : hrefMatch[1];
      }

      const titleMatch  = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
      const title       = titleMatch  ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      const description  = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      if (title && description) results.push({ title, description, url: pageUrl });
    }
  } catch(e) {}

  // Fallback: Instant Answer API (Wikipedia / respostas diretas)
  if (results.length === 0) {
    try {
      const iaUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
      const iaResp = await fetch(iaUrl, { headers: { 'User-Agent': 'Flow-AI/1.0' } });
      const data = await iaResp.json();

      if (data.AbstractText)
        results.push({ title: data.Heading || query, description: data.AbstractText, url: data.AbstractURL || '' });

      for (const topic of (data.RelatedTopics || [])) {
        if (results.length >= 5) break;
        if (topic.Text && topic.FirstURL)
          results.push({ title: topic.Text.split(' - ')[0].slice(0, 80), description: topic.Text, url: topic.FirstURL });
        if (topic.Topics) {
          for (const sub of topic.Topics) {
            if (results.length >= 5) break;
            if (sub.Text && sub.FirstURL)
              results.push({ title: sub.Text.slice(0, 80), description: sub.Text, url: sub.FirstURL });
          }
        }
      }
      if (data.Answer && results.length === 0)
        results.push({ title: 'Resposta direta', description: data.Answer, url: '' });
    } catch(e) {}
  }

  return results;
}

// ── Leitura profunda das páginas via Jina AI ─────────────────────────────
async function enrichWithPageContent(results) {
  const promises = results.map(async (r) => {
    // Pula URLs inválidas ou internas do DuckDuckGo
    if (!r.url || r.url.includes('duckduckgo.com') || !r.url.startsWith('http')) {
      return { ...r, content: null };
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000); // 8s por página

      const resp = await fetch(`https://r.jina.ai/${r.url}`, {
        headers: {
          'Accept': 'text/plain',
          'X-Return-Format': 'text',
          'X-Timeout': '7',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) return { ...r, content: null };

      const text = await resp.text();
      // Limita a 4000 caracteres para não explodir o contexto da IA
      const content = text.replace(/\s+/g, ' ').trim().slice(0, 4000);
      return { ...r, content: content || null };
    } catch(e) {
      return { ...r, content: null };
    }
  });

  return Promise.all(promises);
}
