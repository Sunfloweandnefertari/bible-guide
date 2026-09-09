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

/* ---------- 多译本注册表 ---------- */
const VERSION_DEFS = [
  { id: 'cuv', name: '和合本（神版）', lang: 'zh', langName: '中文', short: '和合本' },
  { id: 'kjv', name: 'King James Version', lang: 'en', langName: '英文', short: 'KJV' },
  { id: 'wlc', name: 'Westminster Leningrad Codex', lang: 'he', langName: '希伯来文（原文·旧约）', short: '希伯来原文' },
  { id: 'tr', name: 'Textus Receptus', lang: 'grc', langName: '希腊文（原文·新约）', short: '希腊原文' },
];
const VERSION_IDS = VERSION_DEFS.map(v => v.id);
/** 从当前目录向上逐级查找 data/<sub>（兼容不同部署的根目录设置） */
function dataDirs(sub) {
  const out = [];
  let d = __dirname;
  for (let i = 0; i < 4; i++) {
    out.push(path.join(d, 'data', sub));
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return out;
}
const VDIRS = dataDirs('versions');
const vcache = new Map();
function loadVersion(id) {
  id = String(id || '').toLowerCase();
  if (vcache.has(id)) return vcache.get(id);
  let data = null;
  for (const d of VDIRS) {
    const f = path.join(d, id + '.json');
    if (fs.existsSync(f)) { try { data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {} break; }
  }
  /* 兜底：老部署只有 data/bible_cuv.json（未跑 build-versions.js） */
  if (!data && id === 'cuv') {
    for (const c of [...dataDirs(''), path.join(__dirname, 'bible_cuv.json')]) {
      const f = c.endsWith('.json') ? c : path.join(c, 'bible_cuv.json');
      if (fs.existsSync(f)) { try { data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {} break; }
    }
  }
  vcache.set(id, data);
  return data;
}
function listVersions() {
  return VERSION_DEFS.filter(v => loadVersion(v.id)).map(v => {
    const d = loadVersion(v.id);
    const ids = Object.keys(d.books).map(Number);
    return { id: v.id, name: v.name, lang: v.lang, langName: v.langName, short: v.short,
      books: ids.length, ot: ids.some(i => i <= 39), nt: ids.some(i => i > 39) };
  });
}

/* ---------- 规范书卷表（编号 1-66；各译本同构，按编号对齐） ---------- */
const BOOKS = [
  ['创世记', '创', 'Genesis'], ['出埃及记', '出', 'Exodus'], ['利未记', '利', 'Leviticus'],
  ['民数记', '民', 'Numbers'], ['申命记', '申', 'Deuteronomy'], ['约书亚记', '书', 'Joshua'],
  ['士师记', '士', 'Judges'], ['路得记', '得', 'Ruth'], ['撒母耳记上', '撒上', 'I Samuel'],
  ['撒母耳记下', '撒下', 'II Samuel'], ['列王纪上', '王上', 'I Kings'], ['列王纪下', '王下', 'II Kings'],
  ['历代志上', '代上', 'I Chronicles'], ['历代志下', '代下', 'II Chronicles'], ['以斯拉记', '拉', 'Ezra'],
  ['尼希米记', '尼', 'Nehemiah'], ['以斯帖记', '斯', 'Esther'], ['约伯记', '伯', 'Job'],
  ['诗篇', '诗', 'Psalms'], ['箴言', '箴', 'Proverbs'], ['传道书', '传', 'Ecclesiastes'],
  ['雅歌', '歌', 'Song of Solomon'], ['以赛亚书', '赛', 'Isaiah'], ['耶利米书', '耶', 'Jeremiah'],
  ['耶利米哀歌', '哀', 'Lamentations'], ['以西结书', '结', 'Ezekiel'], ['但以理书', '但', 'Daniel'],
  ['何西阿书', '何', 'Hosea'], ['约珥书', '珥', 'Joel'], ['阿摩司书', '摩', 'Amos'],
  ['俄巴底亚书', '俄', 'Obadiah'], ['约拿书', '拿', 'Jonah'], ['弥迦书', '弥', 'Micah'],
  ['那鸿书', '鸿', 'Nahum'], ['哈巴谷书', '哈', 'Habakkuk'], ['西番雅书', '番', 'Zephaniah'],
  ['哈该书', '该', 'Haggai'], ['撒迦利亚书', '亚', 'Zechariah'], ['玛拉基书', '玛', 'Malachi'],
  ['马太福音', '太', 'Matthew'], ['马可福音', '可', 'Mark'], ['路加福音', '路', 'Luke'],
  ['约翰福音', '约', 'John'], ['使徒行传', '徒', 'Acts'], ['罗马书', '罗', 'Romans'],
  ['哥林多前书', '林前', 'I Corinthians'], ['哥林多后书', '林后', 'II Corinthians'], ['加拉太书', '加', 'Galatians'],
  ['以弗所书', '弗', 'Ephesians'], ['腓立比书', '腓', 'Philippians'], ['歌罗西书', '西', 'Colossians'],
  ['帖撒罗尼迦前书', '帖前', 'I Thessalonians'], ['帖撒罗尼迦后书', '帖后', 'II Thessalonians'],
  ['提摩太前书', '提前', 'I Timothy'], ['提摩太后书', '提后', 'II Timothy'], ['提多书', '多', 'Titus'],
  ['腓利门书', '门', 'Philemon'], ['希伯来书', '来', 'Hebrews'], ['雅各书', '雅', 'James'],
  ['彼得前书', '彼前', 'I Peter'], ['彼得后书', '彼后', 'II Peter'], ['约翰一书', '约一', 'I John'],
  ['约翰二书', '约二', 'II John'], ['约翰三书', '约三', 'III John'], ['犹大书', '犹', 'Jude'],
  ['启示录', '启', 'Revelation of John'],
];
const NAME2IDX = new Map();
BOOKS.forEach(([cn, sh, en], i) => {
  const idx = i + 1;
  [cn, sh, en, en.replace(/\s+/g, ''), en.replace(/^I{1,3}\s/, m => m.trim() + ' ')].forEach(k => {
    if (k) NAME2IDX.set(String(k).toLowerCase(), idx);
  });
});
/* 常见别名（中文简称 + 英文缩写） */
const ALIAS = {
  创: '创世记', 出: '出埃及记', 利: '利未记', 民: '民数记', 申: '申命记', 书: '约书亚记', 士: '士师记',
  得: '路得记', 撒上: '撒母耳记上', 撒下: '撒母耳记下', 王上: '列王纪上', 王下: '列王纪下',
  代上: '历代志上', 代下: '历代志下', 拉: '以斯拉记', 尼: '尼希米记', 斯: '以斯帖记', 伯: '约伯记',
  诗: '诗篇', 箴: '箴言', 传: '传道书', 歌: '雅歌', 赛: '以赛亚书', 耶: '耶利米书', 哀: '耶利米哀歌',
  结: '以西结书', 但: '但以理书', 何: '何西阿书', 珥: '约珥书', 摩: '阿摩司书', 俄: '俄巴底亚书',
  拿: '约拿书', 弥: '弥迦书', 鸿: '那鸿书', 哈: '哈巴谷书', 番: '西番雅书', 该: '哈该书',
  亚: '撒迦利亚书', 玛: '玛拉基书', 太: '马太福音', 可: '马可福音', 路: '路加福音', 约: '约翰福音',
  徒: '使徒行传', 罗: '罗马书', 林前: '哥林多前书', 林后: '哥林多后书', 加: '加拉太书',
  弗: '以弗所书', 腓: '腓立比书', 西: '歌罗西书', 帖前: '帖撒罗尼迦前书', 帖后: '帖撒罗尼迦后书',
  提前: '提摩太前书', 提后: '提摩太后书', 多: '提多书', 门: '腓利门书', 来: '希伯来书',
  雅: '雅各书', 彼前: '彼得前书', 彼后: '彼得后书', 约一: '约翰一书', 约二: '约翰二书',
  约三: '约翰三书', 犹: '犹大书', 启: '启示录',
  gen: '创世记', ex: '出埃及记', exod: '出埃及记', lev: '利未记', num: '民数记', deut: '申命记',
  josh: '约书亚记', judg: '士师记', ruth: '路得记', ps: '诗篇', psalm: '诗篇', prov: '箴言',
  eccl: '传道书', isa: '以赛亚书', jer: '耶利米书', lam: '耶利米哀歌', ezek: '以西结书', dan: '但以理书',
  matt: '马太福音', mt: '马太福音', mk: '马可福音', lk: '路加福音', jn: '约翰福音', acts: '使徒行传',
  rom: '罗马书', gal: '加拉太书', eph: '以弗所书', phil: '腓立比书', col: '歌罗西书',
  heb: '希伯来书', jas: '雅各书', rev: '启示录', re: '启示录',
};
function resolveBook(kw) {
  let k = String(kw || '').trim().replace(/[．.。]/g, '');
  if (!k) return 0;
  if (ALIAS[k]) k = ALIAS[k];
  if (ALIAS[k.toLowerCase()]) k = ALIAS[k.toLowerCase()];
  const lower = k.toLowerCase();
  if (NAME2IDX.has(lower)) return NAME2IDX.get(lower);
  /* 中文包含匹配（如「撒母耳记」→ 撒母耳记上） */
  for (let i = 0; i < BOOKS.length; i++) {
    if (BOOKS[i][0].includes(k) || k.includes(BOOKS[i][0])) return i + 1;
  }
  /* 英文前缀匹配（≥3 字符，避免误判） */
  if (/^[a-z]{3,}$/.test(lower)) {
    for (let i = 0; i < BOOKS.length; i++) {
      if (BOOKS[i][2].toLowerCase().replace(/\s+/g, '').startsWith(lower)) return i + 1;
    }
  }
  return 0;
}
/** 解析引用式查询：「诗篇 23」「约 3:16」「John 3:16-18」→ {idx, chapter, vs, ve} */
function resolveRef(q) {
  const m = String(q).trim().match(/^(.+?)\s*(\d+)(?:\s*[:：]\s*(\d+)(?:\s*[-–—~]\s*(\d+))?)?$/);
  if (!m) return null;
  const idx = resolveBook(m[1]);
  if (!idx) return null;
  return { idx, chapter: Number(m[2]), vs: m[3] ? Number(m[3]) : null, ve: m[4] ? Number(m[4]) : Number(m[3]) || null };
}
/** 取某译本某节经文，缺失返回 null */
function verseOf(data, idx, ch, v) {
  const bk = data.books[idx];
  if (!bk) return null;
  const c = bk.chapters[ch];
  if (!c) return null;
  const t = c[v];
  return (t === undefined || t === null) ? null : t;
}

/**
 * 查经：统一返回 JSON。
 * 引用式 → { type:'verses', book, nameEn, chapter, verses:[{v, texts:{cuv,kjv,...}}] }
 * 关键词 → { type:'search', hits:[{ref, book, chapter, verse, texts}] }
 */
function searchBible(q, vids) {
  q = String(q || '').trim();
  if (!q) return { type: 'empty' };
  let use = (Array.isArray(vids) ? vids : String(vids || '').split(','))
    .map(s => String(s).trim().toLowerCase()).filter(Boolean);
  use = use.filter(id => loadVersion(id));
  if (!use.length) use = ['cuv'];
  const loaded = use.map(id => ({ id, def: VERSION_DEFS.find(v => v.id === id), data: loadVersion(id) }))
    .filter(x => x.data);
  if (!loaded.length) return { type: 'unavailable', hint: '经文数据未加载' };
  const versions = loaded.map(x => ({ id: x.id, name: x.def.name, langName: x.def.langName, short: x.def.short, lang: x.def.lang }));

  /* —— 引用式查询 —— */
  const ref = resolveRef(q);
  if (ref) {
    /* 选一个含该卷的译本作为主译本（原文译本只有旧约或只有新约） */
    const host = loaded.find(x => x.data.books[ref.idx]);
    if (host) {
      const chData = host.data.books[ref.idx].chapters[ref.chapter];
      if (chData) {
        const keys = Object.keys(chData).map(Number).sort((a, b) => a - b)
          .filter(k => !ref.vs || (k >= ref.vs && (!ref.ve || k <= ref.ve)));
        const verses = keys.map(v => {
          const texts = {};
          for (const x of loaded) {
            const t = verseOf(x.data, ref.idx, ref.chapter, v);
            if (t !== null) texts[x.id] = t;
          }
          return { v, texts };
        });
        return {
          type: 'verses',
          book: BOOKS[ref.idx - 1][0], nameEn: BOOKS[ref.idx - 1][2], short: BOOKS[ref.idx - 1][1],
          chapter: ref.chapter, versions, verses,
        };
      }
    }
  }

  /* —— 关键词搜索（在主译本中检索，其余译本按位置取文） —— */
  const primary = loaded[0];
  const kw = q;
  const all = [];
  const CAP = 400;
  let capped = false;
  outer:
  for (let idx = 1; idx <= 66; idx++) {
    const bk = primary.data.books[idx];
    if (!bk) continue;
    for (const c in bk.chapters) {
      const chap = bk.chapters[c];
      for (const v in chap) {
        if (chap[v].includes(kw)) {
          if (all.length >= CAP) { capped = true; break outer; }
          all.push({ idx, c: Number(c), v: Number(v), t: chap[v] });
        }
      }
    }
  }
  /* 相关性排序：关键词在经文中占比越高越靠前（短而聚焦的经文优先），
     同分再按正典顺序。这样「要饶恕人」会比长篇叙事里偶现该词的更靠前。 */
  const score = h => {
    const occ = h.t.split(kw).length - 1;
    return occ / Math.sqrt(h.t.length + 8);
  };
  all.sort((a, b) => score(b) - score(a) || (a.idx - b.idx) || (a.c - b.c) || (a.v - b.v));
  const MAX = 15;
  const hits = all.slice(0, MAX).map(h => {
    const texts = {};
    for (const x of loaded) {
      const t = verseOf(x.data, h.idx, h.c, h.v);
      if (t !== null) texts[x.id] = t;
    }
    return { ref: `${BOOKS[h.idx - 1][0]} ${h.c}:${h.v}`, book: BOOKS[h.idx - 1][0], chapter: h.c, verse: h.v, texts };
  });
  return { type: 'search', versions, total: capped ? CAP + '+' : all.length, hits };
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
    description: '检索圣经原文。支持按书卷章节引用（如「诗篇 23:1-6」）或按关键词搜索（如「饶恕」）。可选指定译本 version：cuv=和合本(默认)、kjv=英文KJV、wlc=希伯来文原文(仅旧约)、tr=希腊文原文(仅新约)；也支持逗号并列多译本（如 "cuv,kjv"）做平行对照。回答中引用经文时务必先用它检索原文，确保准确，绝不编造。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '书卷章节（如：诗篇 23:1-6）或关键词（如：饶恕）' },
        version: { type: 'string', description: '译本 id，默认 cuv（和合本）。可选 kjv/wlc/tr，或多个用逗号并列如 "cuv,kjv,wlc,tr" 做平行对照' },
      },
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
          try {
            const args = JSON.parse(tc.function.arguments || '{}');
            const r = searchBible(args.query, args.version || 'cuv');
            /* 防止整章 × 多译本撑爆上下文：引用式结果超过 60 节时截断 */
            if (r.type === 'verses' && r.verses.length > 60) {
              r.truncated = true;
              r.verses = r.verses.slice(0, 60);
              r.hint = '该章较长，已截断为前 60 节；如需特定段落请指定节号范围';
            }
            result = JSON.stringify(r);
          } catch { result = JSON.stringify({ type: 'error', hint: '参数解析失败' }); }
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
  const sp = new URL(req.url, 'http://x').searchParams;
  const q = sp.get('q') || '';
  const v = sp.get('v') || sp.get('version') || 'cuv';
  res.end(JSON.stringify(searchBible(q, v)));
}

/* ---------- 译本列表接口 ---------- */
function versionsAPI(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(listVersions()));
}

/* ---------- 配置接口（让页面自报状态） ---------- */
function configAPI(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ keyConfigured: !!KEY, needAccess: !!ACCESS_CODE }));
}

/* ---------- 书卷目录接口（只读，供前端侧栏浏览） ---------- */
function booksAPI(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  const sp = new URL(req.url, 'http://x').searchParams;
  const id = (sp.get('v') || sp.get('version') || 'cuv').toLowerCase();
  const g = loadVersion(id);
  if (!g) { res.end(JSON.stringify({ error: '未加载' })); return; }
  const arr = Object.keys(g.books).map(sn => {
    const b = g.books[sn];
    return { id: Number(sn), book: b.name, nameEn: b.nameEn || '', short: b.short || '', chapters: Object.keys(b.chapters).length };
  }).sort((a, b) => a.id - b.id);
  res.end(JSON.stringify(arr));
}

/* ---------- 启动 ---------- */
const server = http.createServer((req, res) => {
  try {
    if (req.url.startsWith('/api/chat')) return chat(req, res);
    if (req.url.startsWith('/api/verse')) return verseAPI(req, res);
    if (req.url.startsWith('/api/versions')) return versionsAPI(req, res);
    if (req.url.startsWith('/api/config')) return configAPI(req, res);
    if (req.url.startsWith('/api/books')) return booksAPI(req, res);
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
