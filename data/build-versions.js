#!/usr/bin/env node
/**
 * 多译本构建脚本
 * ------------------------------------------------------------------
 * 把各来源的圣经 JSON 归一化为统一结构，输出到 data/versions/。
 * 统一结构（与 data/bible_cuv.json 保持一致，便于后端同构读取）：
 *   { meta: { id, name, lang, langName, books, verses, source },
 *     books: { "1": { name, nameEn, short, chapters: { "1": { "1": "经文" } } } } }
 *
 * 用法：
 *   node data/build-versions.js [源目录]
 *   源目录需含 kjv.json / wlc.json / tr.json（可从 scrollmapper/bible_databases
 *   的 formats/json/ 下载）；和合本直接读 data/bible_cuv.json。
 *
 * 书卷按**英文书名**映射到规范编号 1-66，不依赖来源的排列顺序
 * （WLC 用的是希伯来经典排序，与和合本不同）。
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = process.argv[2] || __dirname;
const OUT_DIR = path.join(__dirname, 'versions');
const DATA_DIR = __dirname;

/* ---------- 规范书卷表：编号 → [中文名, 英文名, 中文简称] ---------- */
const CANON = [
  ['创世记', 'Genesis', '创'], ['出埃及记', 'Exodus', '出'], ['利未记', 'Leviticus', '利'],
  ['民数记', 'Numbers', '民'], ['申命记', 'Deuteronomy', '申'], ['约书亚记', 'Joshua', '书'],
  ['士师记', 'Judges', '士'], ['路得记', 'Ruth', '得'], ['撒母耳记上', 'I Samuel', '撒上'],
  ['撒母耳记下', 'II Samuel', '撒下'], ['列王纪上', 'I Kings', '王上'], ['列王纪下', 'II Kings', '王下'],
  ['历代志上', 'I Chronicles', '代上'], ['历代志下', 'II Chronicles', '代下'], ['以斯拉记', 'Ezra', '拉'],
  ['尼希米记', 'Nehemiah', '尼'], ['以斯帖记', 'Esther', '斯'], ['约伯记', 'Job', '伯'],
  ['诗篇', 'Psalms', '诗'], ['箴言', 'Proverbs', '箴'], ['传道书', 'Ecclesiastes', '传'],
  ['雅歌', 'Song of Solomon', '歌'], ['以赛亚书', 'Isaiah', '赛'], ['耶利米书', 'Jeremiah', '耶'],
  ['耶利米哀歌', 'Lamentations', '哀'], ['以西结书', 'Ezekiel', '结'], ['但以理书', 'Daniel', '但'],
  ['何西阿书', 'Hosea', '何'], ['约珥书', 'Joel', '珥'], ['阿摩司书', 'Amos', '摩'],
  ['俄巴底亚书', 'Obadiah', '俄'], ['约拿书', 'Jonah', '拿'], ['弥迦书', 'Micah', '弥'],
  ['那鸿书', 'Nahum', '鸿'], ['哈巴谷书', 'Habakkuk', '哈'], ['西番雅书', 'Zephaniah', '番'],
  ['哈该书', 'Haggai', '该'], ['撒迦利亚书', 'Zechariah', '亚'], ['玛拉基书', 'Malachi', '玛'],
  ['马太福音', 'Matthew', '太'], ['马可福音', 'Mark', '可'], ['路加福音', 'Luke', '路'],
  ['约翰福音', 'John', '约'], ['使徒行传', 'Acts', '徒'], ['罗马书', 'Romans', '罗'],
  ['哥林多前书', 'I Corinthians', '林前'], ['哥林多后书', 'II Corinthians', '林后'], ['加拉太书', 'Galatians', '加'],
  ['以弗所书', 'Ephesians', '弗'], ['腓立比书', 'Philippians', '腓'], ['歌罗西书', 'Colossians', '西'],
  ['帖撒罗尼迦前书', 'I Thessalonians', '帖前'], ['帖撒罗尼迦后书', 'II Thessalonians', '帖后'],
  ['提摩太前书', 'I Timothy', '提前'], ['提摩太后书', 'II Timothy', '提后'], ['提多书', 'Titus', '多'],
  ['腓利门书', 'Philemon', '门'], ['希伯来书', 'Hebrews', '来'], ['雅各书', 'James', '雅'],
  ['彼得前书', 'I Peter', '彼前'], ['彼得后书', 'II Peter', '彼后'], ['约翰一书', 'I John', '约一'],
  ['约翰二书', 'II John', '约二'], ['约翰三书', 'III John', '约三'], ['犹大书', 'Jude', '犹'],
  ['启示录', 'Revelation of John', '启'],
];
const EN2IDX = new Map(CANON.map(([, en], i) => [en.toLowerCase(), i + 1]));
/* 别名兜底：来源可能用 "Revelation"、"Song of Songs"、"Psalm" 等写法 */
const EN_ALIAS = {
  'revelation': 'Revelation of John', 'song of songs': 'Song of Solomon', 'psalm': 'Psalms',
  'canticles': 'Song of Solomon', '1 samuel': 'I Samuel', '2 samuel': 'II Samuel',
  '1 kings': 'I Kings', '2 kings': 'II Kings', '1 chronicles': 'I Chronicles', '2 chronicles': 'II Chronicles',
  '1 corinthians': 'I Corinthians', '2 corinthians': 'II Corinthians',
  '1 thessalonians': 'I Thessalonians', '2 thessalonians': 'II Thessalonians',
  '1 timothy': 'I Timothy', '2 timothy': 'II Timothy', '1 peter': 'I Peter', '2 peter': 'II Peter',
  '1 john': 'I John', '2 john': 'II John', '3 john': 'III John',
};
function canonOf(enName) {
  const k = String(enName || '').trim().toLowerCase();
  if (EN2IDX.has(k)) return EN2IDX.get(k);
  if (EN_ALIAS[k] && EN2IDX.has(EN_ALIAS[k].toLowerCase())) return EN2IDX.get(EN_ALIAS[k].toLowerCase());
  return 0;
}

/* ---------- 归一化 ---------- */
function normalize(meta, srcBooks) {
  const books = {};
  let totalVerses = 0;
  for (const b of srcBooks) {
    const idx = canonOf(b.name);
    if (!idx) { console.warn('  ⚠ 未识别书卷：', b.name); continue; }
    const [cn, , short] = CANON[idx - 1];
    const chapters = {};
    for (const c of (b.chapters || [])) {
      const chNum = String(c.chapter);
      const verses = {};
      for (const v of (c.verses || [])) {
        const t = (v.text || '').trim();
        if (!t) continue;                 // 跳过空节（原文版本的旧约/新约空缺）
        verses[String(v.verse)] = t;
        totalVerses++;
      }
      if (Object.keys(verses).length) chapters[chNum] = verses;
    }
    if (Object.keys(chapters).length) {
      books[idx] = { name: cn, nameEn: b.name, short, chapters };
    }
  }
  return { meta: { ...meta, books: Object.keys(books).length, verses: totalVerses }, books };
}

function writeVersion(id, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, id + '.json');
  fs.writeFileSync(out, JSON.stringify(data));
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`✓ ${id}.json  ${data.meta.books} 卷 / ${data.meta.verses} 节 / ${kb} KB`);
}

/* ---------- 1. 和合本（直接读现有文件，已是规范结构） ---------- */
console.log('构建和合本…');
{
  const cuv = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bible_cuv.json'), 'utf8'));
  const books = {};
  let verses = 0;
  for (const sn in cuv.books) {
    const b = cuv.books[sn];
    const idx = Number(sn);
    books[idx] = {
      name: b.name, nameEn: (CANON[idx - 1] || [])[1] || '', short: b.short || '',
      chapters: b.chapters,
    };
    for (const c in b.chapters) verses += Object.keys(b.chapters[c]).length;
  }
  writeVersion('cuv', {
    meta: { id: 'cuv', name: '和合本（神版）', lang: 'zh', langName: '中文', books: Object.keys(books).length, verses, source: 'ElijahLabs/bible' },
    books,
  });
}

/* ---------- 2. 英文 KJV / 希伯来 WLC / 希腊文 TR ---------- */
const SOURCES = [
  ['kjv', 'kjv.json', { name: 'King James Version', lang: 'en', langName: '英文', source: 'scrollmapper/bible_databases' }],
  ['wlc', 'wlc.json', { name: 'Westminster Leningrad Codex', lang: 'he', langName: '希伯来文（原文·旧约）', source: 'scrollmapper/bible_databases' }],
  ['tr', 'tr.json', { name: 'Textus Receptus', lang: 'grc', langName: '希腊文（原文·新约）', source: 'scrollmapper/bible_databases' }],
];
for (const [id, file, meta] of SOURCES) {
  const p = path.join(SRC_DIR, file);
  if (!fs.existsSync(p)) { console.warn(`✗ 跳过 ${id}：找不到 ${p}`); continue; }
  console.log(`构建 ${id}…`);
  const src = JSON.parse(fs.readFileSync(p, 'utf8'));
  writeVersion(id, normalize({ id, ...meta, books: 0, verses: 0 }, src.books));
}
console.log('完成。输出目录：', OUT_DIR);
