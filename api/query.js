// Chamadas não-streaming para título de chat, memórias e contexto de busca
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({ ...req.body, stream: false }),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro na query' });
  }
}
