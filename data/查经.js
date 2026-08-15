#!/usr/bin/env node
/**
 * 和合本查经工具
 * 用法:
 *   node 查经.js 诗篇 23            -> 整章
 *   node 查经.js 诗篇 23:1-6        -> 段
 *   node 查经.js 箴言 3:5           -> 单节
 *   node 查经.js --搜索 爱         -> 关键词搜索（返回最多 20 条）
 *   node 查经.js --书卷            -> 列出 66 卷书及编号
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'bible_cuv.json'), 'utf8'));

function findBook(keyword) {
  keyword = String(keyword).trim();
  for (const sn in data.books) {
    const b = data.books[sn];
    if (b.name === keyword || b.short === keyword) return { sn, name: b.name };
    if (b.name.includes(keyword) || keyword.includes(b.name)) return { sn, name: b.name };
  }
  // 拼音/别名简易匹配
  const aliases = { 创: '创世记', 出: '出埃及记', 利: '利未记', 民: '民数记', 申: '申命记',
    诗: '诗篇', 箴: '箴言', 传: '传道书', 赛: '以赛亚书', 耶: '耶利米书', 太: '马太福音',
    可: '马可福音', 路: '路加福音', 约: '约翰福音', 徒: '使徒行传', 罗: '罗马书',
    林前: '哥林多前书', 林后: '哥林多后书', 加: '加拉太书', 弗: '以弗所书', 腓: '腓立比书',
    西: '歌罗西书', 提前: '提摩太前书', 提后: '提摩太后书', 来: '希伯来书', 雅: '雅各书', 启: '启示录' };
  if (aliases[keyword]) return findBook(aliases[keyword]);
  return null;
}

const [a, b, c] = process.argv.slice(2);

if (a === '--书卷') {
  for (const sn in data.books) console.log(sn.padStart(2), data.books[sn].name);
  process.exit(0);
}
if (a === '--搜索' || a === '-s') {
  const kw = b;
  const hits = [];
  for (const sn in data.books) {
    const bk = data.books[sn];
    for (const ch in bk.chapters) {
      for (const v in bk.chapters[ch]) {
        if (bk.chapters[ch][v].includes(kw)) {
          hits.push({ ref: `${bk.name} ${ch}:${v}`, text: bk.chapters[ch][v] });
          if (hits.length >= 20) { printHits(hits); process.exit(0); }
        }
      }
    }
  }
  printHits(hits);
  process.exit(0);
}

if (!a) { console.log('用法见文件头部注释'); process.exit(1); }
const book = findBook(a);
if (!book) { console.log('找不到书卷:', a, '(可运行 node 查经.js --书卷 查看列表)'); process.exit(1); }
const bk = data.books[book.sn];

let chap = b, range = null;
if (b && b.includes(':')) {
  const [ch, vr] = b.split(':');
  chap = ch;
  if (vr.includes('-')) { const [s, e] = vr.split('-'); range = [parseInt(s), parseInt(e)]; }
  else range = [parseInt(vr), parseInt(vr)];
}
if (!bk.chapters[chap]) { console.log(`《${bk.name}》没有第 ${chap} 章`); process.exit(1); }
const chData = bk.chapters[chap];
const verses = Object.keys(chData).sort((x, y) => x - y);
const out = verses.filter(v => !range || (v >= range[0] && v <= range[1]))
  .map(v => `${chap}:${v} ${chData[v]}`).join('\n');
console.log(`《${book.name}》第 ${chap} 章`);
console.log(out);

function printHits(hits) {
  if (!hits.length) { console.log('无匹配'); return; }
  hits.forEach(h => console.log(`${h.ref}  ${h.text}`));
}
