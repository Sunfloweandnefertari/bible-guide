/**
 * 圣经智慧视角 · 网页聊天版 —— 服务器（零依赖，原生 Node）
 *
 * 职责：
 *   1. 静态托管 public/
 *   2. POST /api/chat   —— 聊天代理（密钥只在服务端，SSE 流式返回）
 *   3. GET  /api/verse  —— 查经接口（按卷章引用 或 关键词搜索，读 ../data/bible_cuv.json）
 *
 * 运行：node server.js  （.env 需与 server.js 同目录）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

/* ---------- 环境变量 ---------- */
function loadEnv() {
  try {
    const t = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of t.split('\n')) {
      const m = line.trim().match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
loadEnv();
const KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const PORT = Number(process.env.PORT) || 8787;
if (!KEY) { console.error('✗ 未找到 DEEPSEEK_API_KEY，请检查 web/.env'); process.exit(1); }

const SYSTEM = fs.readFileSync(path.join(__dirname, 'context', 'system-prompt.md'), 'utf8');

/* ---------- 圣经数据（懒加载） ---------- */
let bible = null;
function getBible() {
  if (!bible) bible = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bible_cuv.json'), 'utf8'));
  return bible;
}
const ALIASES = { 创: '创世记', 出: '出埃及记', 利: '利未记', 民: '民数记', 申: '申命记', 诗: '诗篇', 箴: '箴言',
  传: '传道书', 赛: '以赛亚书', 耶: '耶利米书', 太: '马太福音', 可: '马可福音', 路: '路加福音', 约: '约翰福音',
  徒: '使徒行传', 罗: '罗马书', 林前: '哥林多前书', 林后: '哥林多后书', 加: '加拉太书', 弗: '以弗所书', 腓: '腓立比书',
  西: '歌罗西书', 提前: '提摩太前书', 提后: '提摩太后书', 来: '希伯来书', 雅: '雅各书', 启: '启示录' };
function findBook(kw) {
  kw = String(kw).trim();
  if (ALIASES[kw]) kw = ALIASES[kw];
  for (const sn in bible.books) {
    const b = bible.books[sn];
    if (b.name === kw || b.short === kw) return b;
    if (b.name.includes(kw)) return b;
  }
  return null;
}

/* ---------- 简易限流（每 IP 每分钟 20 次） ---------- */
const hits = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (arr.length >= 20) return false;
  arr.push(now);
  hits.set(ip, arr);
  return true;
}

/* ---------- 静态文件 ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(__dirname, 'public', p);
  if (!fp.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(fp)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(fp).pipe(res);
}

/* ---------- 聊天代理（SSE 流式） ---------- */
async function chat(req, res) {
  const ip = req.socket.remoteAddress || 'local';
  if (!rateLimit(ip)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '请求太频繁，请稍后再试。' })); return; }

  let body = '';
  for await (const c of req) body += c;
  let msg;
  try { msg = JSON.parse(body); } catch { res.writeHead(400); res.end(JSON.stringify({ error: '请求格式错误' })); return; }

  const messages = [{ role: 'system', content: SYSTEM }, ...(Array.isArray(msg.messages) ? msg.messages.slice(-20) : [])];

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');

  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({ model: MODEL, messages, stream: true }),
    });
    if (!r.ok || !r.body) {
      const t = await r.text();
      res.write(`data: ${JSON.stringify({ error: '模型服务暂不可用（' + r.status + '）。请稍后再试。' })}\n\n`);
      res.end();
      return;
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (d) res.write(`data: ${JSON.stringify({ delta: d })}\n\n`);
        } catch {}
      }
    }
    res.write('data: [DONE]\n\n');
  } catch (e) {
    try { res.write(`data: ${JSON.stringify({ error: '网络连接异常，请稍后再试。' })}\n\n`); } catch {}
  }
  res.end();
}

/* ---------- 查经接口 ---------- */
function verseAPI(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
  if (!q.trim()) { res.end(JSON.stringify({ type: 'empty' })); return; }
  const data = getBible();
  const m = q.match(/^(.+?)\s*(\d+)(?::(\d+)(?:-(\d+))?)?$/);
  if (m) {
    const [, name, ch, vs, ve] = m;
    const book = findBook(name);
    if (book && book.chapters[ch]) {
      const chap = book.chapters[ch];
      const keys = Object.keys(chap).sort((a, b) => a - b).filter(k => !vs || (k >= vs && (!ve || k <= ve)));
      const verses = keys.map(k => `${ch}:${k} ${chap[k]}`);
      res.end(JSON.stringify({ type: 'reference', book: book.name, verses }));
      return;
    }
  }
  const hits = [];
  outer:
  for (const sn in data.books) {
    const bk = data.books[sn];
    for (const c in bk.chapters) {
      for (const v in bk.chapters[c]) {
        if (bk.chapters[c][v].includes(q)) {
          hits.push({ ref: `${bk.name} ${c}:${v}`, text: bk.chapters[c][v] });
          if (hits.length >= 8) break outer;
        }
      }
    }
  }
  res.end(JSON.stringify({ type: 'search', hits }));
}

/* ---------- 启动 ---------- */
const server = http.createServer((req, res) => {
  try {
    if (req.url.startsWith('/api/chat')) return chat(req, res);
    if (req.url.startsWith('/api/verse')) return verseAPI(req, res);
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(405); res.end();
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: '服务器内部错误' }));
  }
});
server.listen(PORT, () => {
  console.log('┌──────────────────────────────────────┐');
  console.log('│  圣经 · 智慧视角 网页聊天              │');
  console.log(`│  打开 http://localhost:${PORT} 开始使用       │`);
  console.log('│  模型：' + MODEL.padEnd(25) + '│');
  console.log('└──────────────────────────────────────┘');
});
