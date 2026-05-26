export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_API_KEY não configurada no Vercel' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const emit = (text) => {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`);
  };

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...req.body, stream: true }),
    });

    // Se Groq retornar erro, emite como mensagem visível ao usuário
    if (!groqRes.ok) {
      let errMsg = `Erro ${groqRes.status}`;
      try {
        const errJson = await groqRes.json();
        errMsg = errJson?.error?.message || errMsg;
        // Mensagem amigável para erro de modelo não disponível
        if (errJson?.error?.code === 'model_not_active' || groqRes.status === 404) {
          errMsg = `Modelo de visão não disponível na sua conta Groq. Tente enviar apenas texto.`;
        }
      } catch {}
      emit(`⚠️ ${errMsg}`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Pipe o stream do Groq direto para o cliente
    const reader = groqRes.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    emit(`⚠️ Erro de conexão: ${err.message}`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}
