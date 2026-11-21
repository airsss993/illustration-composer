// Статика репозитория: web/ - интерфейс, library/ и examples/ - данные. Запуск: node server.mjs [порт].
// POST /api/metaphor - разбор фразы моделью Gemini, если задан GEMINI_API_KEY. Без ключа - 503,
// интерфейс тогда разбирает фразу словарём.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png' };
const ALLOWED = ['web', 'library', 'examples'];

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
const OBJECTS = JSON.parse(readFileSync(join(ROOT, 'library/manifest.json'), 'utf8')).objects
  .filter((o) => o.size === 'L').map((o) => ({ id: o.id, names: o.names }));
const IDS = OBJECTS.map((o) => o.id);
const PROMPT = `Ты подбираешь объекты для иллюстрации к заголовку или метафоре.
Доступны только эти объекты (id: русские названия):
${OBJECTS.map((o) => `${o.id}: ${o.names.join(', ')}`).join('\n')}
Выбери от 1 до 3 объектов, которые вместе лучше всего передают смысл фразы. Первым ставь главный.
Объяснение - одно короткое предложение по-русски, почему эти объекты.`;
const SCHEMA = {
  type: 'OBJECT',
  properties: { ids: { type: 'ARRAY', items: { type: 'STRING', enum: IDS } }, reason: { type: 'STRING' } },
  required: ['ids', 'reason'],
};

// Публичное демо: ключ не должен тратиться без меры. Окно в минуту на IP и общий счётчик за сутки.
const PER_MIN = 10, PER_DAY = 500;
const hits = new Map();
let day = { date: '', n: 0 };
function limited(ip) {
  const now = Date.now(), today = new Date().toISOString().slice(0, 10);
  if (day.date !== today) day = { date: today, n: 0 };
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= PER_MIN || day.n >= PER_DAY) return true;
  hits.set(ip, [...recent, now]);
  day.n++;
  return false;
}

// curl, а не fetch: fetch в node не умеет SOCKS, а curl берёт прокси из ALL_PROXY.
// Ключ уходит в curl через stdin, чтобы не попасть в список процессов.
function gemini(text) {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: PROMPT }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 },
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  return new Promise((resolve, reject) => {
    const p = spawn('curl', ['-sS', '--max-time', '20', '-K', '-', '--data-binary', body]);
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code) return reject(new Error(`curl ${code}: ${err.trim()}`));
      try {
        const r = JSON.parse(out);
        if (r.error) return reject(new Error(`gemini ${r.error.code}: ${r.error.message}`));
        const parsed = JSON.parse(r.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
        const ids = [...new Set(parsed.ids ?? [])].filter((id) => IDS.includes(id)).slice(0, 3);
        resolve({ ids, reason: String(parsed.reason ?? '').slice(0, 300) });
      } catch (e) {
        reject(new Error(`ответ не разобран: ${e.message}`));
      }
    });
    p.stdin.end(`url = "${url}"\nheader = "x-goog-api-key: ${KEY}"\nheader = "content-type: application/json"\n`);
  });
}

async function metaphor(req, res) {
  const json = (code, data) => res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
  if (!KEY) return json(503, { error: 'нет ключа' });
  // За Caddy реальный адрес в X-Forwarded-For: входящий заголовок клиента Caddy заменяет своим.
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() ?? req.socket.remoteAddress;
  if (limited(ip)) return json(429, { error: 'слишком много запросов' });
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2000) return json(413, { error: 'слишком длинно' });
  }
  let q;
  try { q = String(JSON.parse(raw).q ?? '').trim().slice(0, 300); } catch { return json(400, { error: 'нужен JSON {q}' }); }
  if (!q) return json(400, { error: 'пустая фраза' });
  try {
    json(200, await gemini(q));
  } catch (e) {
    console.error(new Date().toISOString(), e.message);
    json(502, { error: 'модель не ответила' });
  }
}

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/api/metaphor' && req.method === 'POST') return metaphor(req, res);
  if (path === '/') { res.writeHead(302, { location: '/web/' }).end(); return; }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!ALLOWED.some((d) => file.startsWith(join(ROOT, d) + sep))) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': `${TYPES[extname(file)] ?? 'application/octet-stream'}; charset=utf-8` }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}${KEY ? `, Gemini ${MODEL}` : ', без Gemini'}`));
