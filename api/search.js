// Pesquisa via DuckDuckGo — 100% gratuito, sem API key necessária
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { query } = req.body;
  if (!query) return res.status(400).json({ results: [] });

  try {
    // DuckDuckGo Instant Answer API — gratuito e sem autenticação
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Flow-AI-Assistant/1.0' }
    });
    const data = await response.json();

    const results = [];

    // Abstract (resposta direta, ex: Wikipedia)
    if (data.AbstractText) {
      results.push({
        title: data.Heading || query,
        description: data.AbstractText,
        url: data.AbstractURL || ''
      });
    }

    // Related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics) {
        if (results.length >= 5) break;
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 60),
            description: topic.Text,
            url: topic.FirstURL
          });
        }
        // Sub-topics
        if (topic.Topics) {
          for (const sub of topic.Topics) {
            if (results.length >= 5) break;
            if (sub.Text && sub.FirstURL) {
              results.push({
                title: sub.Text.slice(0, 60),
                description: sub.Text,
                url: sub.FirstURL
              });
            }
          }
        }
      }
    }

    // Answer (ex: calculadora, conversões)
    if (data.Answer && results.length === 0) {
      results.push({
        title: 'Resposta direta',
        description: data.Answer,
        url: ''
      });
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ results: [], error: 'Search failed' });
  }
}
