// Pesquisa via DuckDuckGo HTML (resultados reais de web) + fallback Instant Answer
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { query } = req.body;
  if (!query) return res.status(400).json({ results: [] });

  try {
    // ── 1. DuckDuckGo HTML — resultados reais de web ──────────────────────
    const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`;
    const htmlResp = await fetch(htmlUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      }
    });

    const html = await htmlResp.text();
    const results = [];

    // Divide o HTML em blocos de resultado
    const blocks = html.split('<div class="result ');
    for (let i = 1; i < blocks.length && results.length < 5; i++) {
      const block = blocks[i];

      // URL real — fica no parâmetro uddg do link de redirecionamento
      let url = '';
      const hrefMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
      if (hrefMatch) {
        const uddgMatch = hrefMatch[1].match(/uddg=([^&"]+)/);
        url = uddgMatch ? decodeURIComponent(uddgMatch[1]) : hrefMatch[1];
      }

      // Título
      const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      // Snippet (resumo do resultado)
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      const description = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      if (title && description) results.push({ title, description, url });
    }

    // ── 2. Fallback: Instant Answer API (respostas diretas tipo Wikipedia) ──
    if (results.length === 0) {
      const iaUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
      const iaResp = await fetch(iaUrl, { headers: { 'User-Agent': 'Flow-AI-Assistant/1.0' } });
      const data = await iaResp.json();

      if (data.AbstractText) {
        results.push({ title: data.Heading || query, description: data.AbstractText, url: data.AbstractURL || '' });
      }
      for (const topic of (data.RelatedTopics || [])) {
        if (results.length >= 5) break;
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 60),
            description: topic.Text,
            url: topic.FirstURL
          });
        }
        if (topic.Topics) {
          for (const sub of topic.Topics) {
            if (results.length >= 5) break;
            if (sub.Text && sub.FirstURL)
              results.push({ title: sub.Text.slice(0, 60), description: sub.Text, url: sub.FirstURL });
          }
        }
      }
      if (data.Answer && results.length === 0) {
        results.push({ title: 'Resposta direta', description: data.Answer, url: '' });
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ results: [], error: 'Search failed' });
  }
}
