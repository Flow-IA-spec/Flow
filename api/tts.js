// Microsoft Antonio Neural via Edge TTS (WebSocket não-oficial mas estável)
import { WebSocket } from 'ws';

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS   = `wss://speech.platform.bing.com/consumer/speech/synthesize/realtimestreaming/edge/v1?TrustedClientToken=${TOKEN}&ConnectionId=`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body || {};
  if (!text?.trim()) return res.status(400).end();

  const connId = rand(32);
  const reqId  = rand(32);
  const chunks = [];

  return new Promise(resolve => {
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      if (ok && chunks.length) {
        const buf = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', buf.length);
        res.end(buf);
      } else {
        if (!res.headersSent) res.status(500).json({ error: 'TTS falhou' });
      }
      resolve();
    };

    const timeout = setTimeout(() => { ws.terminate(); finish(false); }, 12000);

    const ws = new WebSocket(WSS + connId, {
      headers: {
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
      }
    });

    ws.on('open', () => {
      const ts = new Date().toISOString();
      // Config
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify({ context: { synthesis: { audio: { outputFormat: 'audio-24khz-48kbitrate-mono-mp3', metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' } } } } }));
      // SSML
      const safe = text.slice(0, 900)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
      ws.send([
        `X-RequestId:${reqId}`,
        'Content-Type:application/ssml+xml',
        `X-Timestamp:${ts}`,
        'Path:ssml',
        '',
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='pt-BR'><voice name='pt-BR-AntonioNeural'><prosody rate='+0%' pitch='+0Hz'>${safe}</prosody></voice></speak>`,
      ].join('\r\n'));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        try {
          const hLen = data.readUInt16BE(0);
          const audio = data.slice(2 + hLen);
          if (audio.length > 0) chunks.push(audio);
        } catch {}
      } else {
        if (data.toString().includes('Path:turn.end')) {
          clearTimeout(timeout); ws.close(); finish(true);
        }
      }
    });

    ws.on('error', () => { clearTimeout(timeout); finish(false); });
    ws.on('close', () => { clearTimeout(timeout); finish(chunks.length > 0); });
  });
}

const rand = n => [...Array(n)].map(() => Math.floor(Math.random()*16).toString(16)).join('');
