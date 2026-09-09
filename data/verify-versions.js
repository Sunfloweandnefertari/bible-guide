#!/usr/bin/env node
/**
 * 多译本数据自检
 * ------------------------------------------------------------------
 * 校验 data/versions/ 下各译本是否完整、可解析、书卷编号对齐。
 * 用法：node data/verify-versions.js
 * 退出码：0 = 全部通过；1 = 有失败项（可用于 CI）。
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'versions');
const EXPECT = {
  cuv: { books: 66, lang: 'zh', label: '和合本' },
  kjv: { books: 66, lang: 'en', label: 'KJV' },
  wlc: { books: 39, lang: 'he', label: '希伯来原文（旧约）' },
  tr: { books: 27, lang: 'grc', label: '希腊文原文（新约）' },
};
/* 抽查：译本 → [引用, 期望包含的子串] */
const SPOT = {
  cuv: [['19', '23', '1', '耶和华是我的牧者'], ['43', '3', '16', '神爱世人']],
  kjv: [['19', '23', '1', 'shepherd'], ['43', '3', '16', 'God so loved the world']],
  wlc: [['1', '1', '1', 'בְּרֵאשִׁ֖ית'], ['19', '23', '1', 'יְהוָ֥ה']],
  tr: [['43', '3', '16', 'ηγαπησεν'], ['40', '1', '1', 'βιβλος']],
};

let fail = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) fail++; };

console.log('多译本数据自检\n');
for (const [id, exp] of Object.entries(EXPECT)) {
  console.log(`【${id}】${exp.label}`);
  const f = path.join(DIR, id + '.json');
  if (!fs.existsSync(f)) { ok(false, `文件存在（${f}）`); continue; }
  let d;
  try { d = JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { ok(false, `JSON 可解析：${e.message.slice(0, 50)}`); continue; }
  ok(true, `JSON 可解析（${(fs.statSync(f).size / 1024 / 1024).toFixed(1)} MB）`);
  ok(d.meta && d.meta.lang === exp.lang, `语言标记 = ${exp.lang}`);
  const ids = Object.keys(d.books).map(Number).sort((a, b) => a - b);
  ok(ids.length === exp.books, `书卷数 = ${ids.length}（期望 ${exp.books}）`);
  if (id !== 'tr') ok(ids[0] === 1, `编号从 1 开始`);       /* 希腊原文只有新约，从 40 起 */
  /* 旧约只有 1-39、新约只有 40-66 的译本要检查边界 */
  if (id === 'wlc') ok(ids[ids.length - 1] === 39, `末卷编号 = 39（旧约）`);
  if (id === 'tr') ok(ids[0] === 40, `首卷编号 = 40（新约）`);
  /* 中文卷名（用于前端一致展示） */
  const firstBook = d.books[ids[0]];
  ok(/[一-龥]/.test(firstBook.name), `卷名为中文（${firstBook.name}）`);
  /* 抽查经文 */
  for (const [b, c, v, sub] of (SPOT[id] || [])) {
    const t = d.books[b] && d.books[b].chapters[c] && d.books[b].chapters[c][v];
    ok(typeof t === 'string' && t.includes(sub), `抽查 ${d.books[b]?.name} ${c}:${v} 含「${sub}」`);
  }
  console.log('');
}

/* 跨译本对齐：同一引用在共同拥有的书卷里都能取到 */
console.log('【跨译本对齐】');
{
  const cuv = JSON.parse(fs.readFileSync(path.join(DIR, 'cuv.json'), 'utf8'));
  const kjv = JSON.parse(fs.readFileSync(path.join(DIR, 'kjv.json'), 'utf8'));
  const wlc = JSON.parse(fs.readFileSync(path.join(DIR, 'wlc.json'), 'utf8'));
  const tr = JSON.parse(fs.readFileSync(path.join(DIR, 'tr.json'), 'utf8'));
  ok(cuv.books['19'].name === kjv.books['19'].name, `和合本/KJV 卷名一致（${cuv.books['19'].name}）`);
  ok(cuv.books['1'].name === wlc.books['1'].name, `和合本/希伯来 创世记卷名一致`);
  ok(cuv.books['43'].name === tr.books['43'].name, `和合本/希腊 约翰福音卷名一致`);
  ok(!wlc.books['43'], `希伯来原文不含新约（约翰福音）`);
  ok(!tr.books['1'], `希腊原文不含旧约（创世记）`);
}

console.log(fail === 0 ? '\n✅ 全部通过' : `\n❌ ${fail} 项未通过`);
process.exit(fail === 0 ? 0 : 1);
