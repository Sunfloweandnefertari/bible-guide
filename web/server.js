/**
 * 圣经智慧视角 · 网页聊天版 —— 服务器 v2（零依赖，原生 Node）
 *
 * v2 新增：
 *   1. 函数调用：助手自动检索圣经原文（search_verse），引用不再凭记忆
 *   2. 危机检测：检测自杀/自伤/家暴等关键词，强制插入求助热线
 *   3. 访问码：设置 ACCESS_CODE 后，前端需输入访问码才能对话（防白嫖）
 *   4. 限流可配置：RATE_PER_MIN（默认每 IP 每分钟 20 次）
 *   5. 未配置 API Key 也不崩溃：页面友好提示，方便 Render 首次部署
 *
 * 环境变量（.env 或平台环境变量）：
 *   DEEPSEEK_API_KEY  必填，否则聊天不可用（服务不崩，页面提示）
 *   DEEPSEEK_MODEL    默认 deepseek-chat
 *   PORT              默认 8787
 *   ACCESS_CODE       可选，设置后需访问码
 *   RATE_PER_MIN      可选，默认 20
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
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const RATE_PER_MIN = Number(process.env.RATE_PER_MIN) || 20;

let SYSTEM = '';
try { SYSTEM = fs.readFileSync(path.join(__dirname, 'context', 'system-prompt.md'), 'utf8'); } catch {}

/* ---------- 圣经数据（懒加载，多路径兼容） ---------- */
function resolveDataFile() {
  const candidates = [
    path.join(__dirname, '..', 'data', 'bible_cuv.json'),
    path.join(__dirname, 'data', 'bible_cuv.json'),
    path.join(__dirname, 'bible_cuv.json'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}
let bible = null;
function getBible() {
  if (bible) return bible;
  const f = resolveDataFile();
  if (f) { try { bible = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {} }
  return bible;
}
const ALIASES = { 创: '创世记', 出: '出埃及记', 利: '利未记', 民: '民数记', 申: '申命记', 诗: '诗篇', 箴: '箴言',
  传: '传道书', 赛: '以赛亚书', 耶: '耶利米书', 太: '马太福音', 可: '马可福音', 路: '路加福音', 约: '约翰福音',
  徒: '使徒行传', 罗: '罗马书', 林前: '哥林多前书', 林后: '哥林多后书', 加: '加拉太书', 弗: '以弗所书', 腓: '腓立比书',
  西: '歌罗西书', 提前: '提摩太前书', 提后: '提摩太后书', 来: '希伯来书', 雅: '雅各书', 启: '启示录' };
function findBook(data, kw) {
  kw = String(kw).trim();
  if (ALIASES[kw]) kw = ALIASES[kw];
  for (const sn in data.books) {
    const b = data.books[sn];
    if (b.name === kw || b.short === kw) return b;
    if (b.name.includes(kw)) return b;
  }
  return null;
}
/** 查经：返回统一 JSON */
function searchBible(q) {
  q = String(q || '').trim();
  if (!q) return { type: 'empty' };
  const data = getBible();
  if (!data) return { type: 'unavailable', hint: '经文数据未加载' };
  const m = q.match(/^(.+?)\s*(\d+)(?::(\d+)(?:-(\d+))?)?$/);
  if (m) {
    const [, name, ch, vs, ve] = m;
    const book = findBook(data, name);
    if (book && book.chapters[ch]) {
      const chap = book.chapters[ch];
      const keys = Object.keys(chap).sort((a, b) => a - b).filter(k => !vs || (k >= vs && (!ve || k <= ve)));
      const verses = keys.map(k => `${ch}:${k} ${chap[k]}`);
      return { type: 'reference', book: book.name, verses };
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
  return { type: 'search', hits };
}

/* ---------- 危机检测 ---------- */
const CRISIS_WORDS = ['自杀', '想死', '不想活', '不想活了', '活不下去', '活着没意思', '活着好累', '不如死了',
  '死了算了', '撑不下去', '撑不下去了', '了结自己', '结束生命', '结束自己', '轻生', '自残', '割腕', '跳楼',
  '跳下去', '一了百了', '活够了', '没意思活', '家暴', '被家暴', '打我', '虐待', '身上有伤'];
const CRISIS_NOTE = '⚠️ 我感觉你现在可能身处很艰难的处境。请先停下来，你的安全比什么都重要：\n\n· 全国心理援助热线：400-161-9995（24 小时）\n· 也可以告诉身边信任的人，或前往就近医院急诊\n· 如果正处在危急中，请直接拨打 110\n\n我是 AI，不是医生或心理咨询师，但请不要独自扛着。';
function checkCrisis(text) {
  return CRISIS_WORDS.some(w => String(text || '').includes(w));
}

/* ---------- 限流（每 IP） ---------- */
const hits = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (arr.length >= RATE_PER_MIN) return false;
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
  const publicDir = path.join(__dirname, 'public');
  const fp = path.join(publicDir, p);
  if (!fp.startsWith(publicDir) || !fs.existsSync(fp)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(fp).pipe(res);
}

/* ---------- DeepSeek 调用 ---------- */
const SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'search_verse',
    description: '检索圣经（和合本）原文。支持按书卷章节引用（如「诗篇 23:1-6」）或按关键词搜索（如「饶恕」）。在回答中需要引用经文时，务必先用它检索原文，确保准确，绝不编造。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '书卷章节（如：诗篇 23:1-6）或关键词（如：饶恕）' } },
      required: ['query'],
    },
  },
};
async function callDeepSeek(messages, opts = {}) {
  const body = {
    model: MODEL,
    messages,
    stream: !!opts.stream,
  };
  if (opts.tools) body.tools = opts.tools;
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify(body),
  });
  return r;
}

/* ---------- 聊天 ---------- */
async function chat(req, res) {
  const ip = req.socket.remoteAddress || 'local';
  if (!KEY) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '服务尚未配置 DeepSeek API Key。请在部署平台设置环境变量 DEEPSEEK_API_KEY 后重新部署。' }));
    return;
  }
  if (!rateLimit(ip)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '请求太频繁，请稍后再试。' })); return; }
  if (ACCESS_CODE) {
    const code = String(req.headers['x-access-code'] || '');
    if (code !== ACCESS_CODE) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ needAccess: true, error: '请输入访问码' })); return; }
  }
  let body = '';
  for await (const c of req) body += c;
  let msg;
  try { msg = JSON.parse(body); } catch { res.writeHead(400); res.end(JSON.stringify({ error: '请求格式错误' })); return; }

  const userMsgs = Array.isArray(msg.messages) ? msg.messages.slice(-20) : [];
  const crisis = userMsgs.some(m => m.role === 'user' && checkCrisis(m.content));
  const messages = [{ role: 'system', content: SYSTEM }, ...userMsgs];

  /* Phase 1：非流式，先判断是否需要调用工具 */
  let finalMessages = messages;
  try {
    const r1 = await callDeepSeek(messages, { tools: [SEARCH_TOOL] });
    if (r1.ok) {
      const j = await r1.json();
      const m1 = j.choices && j.choices[0] && j.choices[0].message;
      if (m1 && m1.tool_calls && m1.tool_calls.length) {
        const calls = m1.tool_calls.map(tc => ({
          id: tc.id, type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments || '' },
        }));
        finalMessages = [...messages, { role: 'assistant', content: m1.content || '', tool_calls: calls }];
        for (const tc of calls) {
          let result;
          try { result = JSON.stringify(searchBible(JSON.parse(tc.function.arguments || '{}').query)); }
          catch { result = JSON.stringify({ type: 'error', hint: '参数解析失败' }); }
          finalMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
      } else if (m1 && m1.content) {
        /* 没用工具：直接把完整回答发出去 */
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
        if (crisis) res.write(`data: ${JSON.stringify({ crisis: CRISIS_NOTE })}\n\n`);
        res.write(`data: ${JSON.stringify({ delta: m1.content })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }
  } catch {}

  /* Phase 2：流式返回最终回答 */
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  if (crisis) res.write(`data: ${JSON.stringify({ crisis: CRISIS_NOTE })}\n\n`);
  try {
    const r2 = await callDeepSeek(finalMessages, { stream: true });
    if (!r2.ok || !r2.body) {
      const t = await r2.text();
      res.write(`data: ${JSON.stringify({ error: '模型服务暂不可用（' + r2.status + '）。请稍后再试。' })}\n\n`);
      res.end();
      return;
    }
    const reader = r2.body.getReader();
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
  res.end(JSON.stringify(searchBible(q)));
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
  console.log('┌───────────────────────────────────────────┐');
  console.log('│  圣经 · 智慧视角 网页聊天 v2               │');
  console.log(`│  http://localhost:${PORT}                    │`);
  console.log(`│  模型：${MODEL.padEnd(31)}│`);
  console.log(`│  API Key：${KEY ? '已配置'.padEnd(29) : '未配置（聊天不可用，但服务在跑）'.padEnd(1)}│`);
  console.log(`│  访问码：${ACCESS_CODE ? '已启用'.padEnd(31) : '未启用（局域网公开）'.padEnd(14)}│`);
  console.log('└───────────────────────────────────────────┘');
});
