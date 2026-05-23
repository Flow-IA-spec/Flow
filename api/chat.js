export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, // ← key segura aqui
    },
    body: JSON.stringify(req.body),
  });

  const data = await response.json();
  res.status(response.status).json(data);
}
