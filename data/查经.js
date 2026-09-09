#!/usr/bin/env node
/**
 * 多译本查经工具
 * ------------------------------------------------------------------
 * 用法:
 *   node 查经.js 诗篇 23            整章（默认和合本）
 *   node 查经.js 诗篇 23:1-6        段落
 *   node 查经.js 箴言 3:5           单节
 *   node 查经.js 诗篇 23:1 --kjv    指定译本
 *   node 查经.js 创世记 1:1 --对照   全部译本平行对照
 *   node 查经.js --搜索 饶恕        关键词搜索（默认和合本，最多 20 条）
 *   node 查经.js --搜索 grace --kjv 在指定译本中搜索
 *   node 查经.js --书卷             列出书卷
 *   node 查经.js --书卷 --wlc       列出该译本的书卷
 *   node 查经.js --译本             列出可用译本
 *
 * 译本：cuv=和合本  kjv=英文KJV  wlc=希伯来文原文(旧约)  tr=希腊文原文(新约)
 * 数据来自 data/versions/*.json（由 data/build-versions.js 生成）。
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname;
const VDIRS = [path.join(DATA_DIR, 'versions'), DATA_DIR];

const VERSIONS = {
  cuv: { name: '和合本', full: '和合本（神版）' },
  kjv: { name: 'KJV', full: 'King James Version' },
  wlc: { name: '希伯来原文', full: 'Westminster Leningrad Codex（旧约）' },
  tr: { name: '希腊原文', full: 'Textus Receptus（新约）' },
};

function loadVersion(id) {
  for (const d of VDIRS) {
    const f = path.join(d, id + '.json');
    if (fs.existsSync(f)) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {} }
  }
  if (id === 'cuv') {
    const f = path.join(DATA_DIR, 'bible_cuv.json');
    if (fs.existsSync(f)) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {} }
  }
  return null;
}

/* 书卷别名（与 server.js 的解析保持一致） */
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
};
function findBook(data, kw) {
  kw = String(kw).trim();
  if (ALIAS[kw]) kw = ALIAS[kw];
  for (const sn in data.books) {
    const b = data.books[sn];
    if (b.name === kw || b.short === kw) return { sn, name: b.name };
    if (b.name.includes(kw) || kw.includes(b.name)) return { sn, name: b.name };
  }
  return null;
}

/* ---------- 解析参数 ---------- */
const argv = process.argv.slice(2);
const flags = argv.filter(a => a.startsWith('--'));
const args = argv.filter(a => !a.startsWith('--'));
const flag = n => flags.includes('--' + n);
/* 选译本：--kjv / --wlc / --tr / --cuv；未指定默认 cuv */
let verId = 'cuv';
for (const id of Object.keys(VERSIONS)) if (flag(id)) verId = id;
const compare = flag('对照');
const verList = compare ? Object.keys(VERSIONS) : [verId];

if (flag('译本') || flag('versions')) {
  for (const id of Object.keys(VERSIONS)) {
    const d = loadVersion(id);
    console.log(`${id.padEnd(4)} ${VERSIONS[id].name.padEnd(12)} ${VERSIONS[id].full}${d ? '' : '（未安装）'}`);
  }
  process.exit(0);
}

const [a, b] = args;

if (a === '--书卷' || flag('书卷')) {
  const d = loadVersion(verId);
  if (!d) { console.log('该译本未安装'); process.exit(1); }
  for (const sn in d.books) console.log(String(sn).padStart(2), d.books[sn].name);
  process.exit(0);
}

if (flag('搜索') || a === '-s' || a === '--搜索') {
  const kw = (a === '-s' || a === '--搜索') ? b : a;
  if (!kw) { console.log('请给出搜索关键词'); process.exit(1); }
  const d = loadVersion(verId);
  if (!d) { console.log('该译本未安装'); process.exit(1); }
  const hits = [];
  outer:
  for (const sn in d.books) {
    const bk = d.books[sn];
    for (const ch in bk.chapters) {
      for (const v in bk.chapters[ch]) {
        if (bk.chapters[ch][v].includes(kw)) {
          hits.push(`${bk.name} ${ch}:${v}  ${bk.chapters[ch][v]}`);
          if (hits.length >= 20) break outer;
        }
      }
    }
  }
  if (!hits.length) { console.log('无匹配'); process.exit(0); }
  console.log(`在《${VERSIONS[verId].full}》中搜索「${kw}」，命中：`);
  hits.forEach(h => console.log(h));
  process.exit(0);
}

if (!a) { console.log('用法见文件头部注释'); process.exit(1); }

/* ---------- 引用式查询 ---------- */
const loaded = verList.map(id => ({ id, data: loadVersion(id) })).filter(x => x.data);
if (!loaded.length) { console.log('经文数据未加载'); process.exit(1); }

/* 选一个含该书卷的译本作为定位依据（原文译本只有旧约或只有新约） */
let anchor = null, bookInfo = null;
for (const x of loaded) {
  const bk = findBook(x.data, a);
  if (bk) { anchor = x; bookInfo = bk; break; }
}
if (!anchor) { console.log('找不到书卷:', a, '（可运行 node 查经.js --书卷 查看列表）'); process.exit(1); }

let chap = b, range = null;
if (b && b.includes(':')) {
  const [ch, vr] = b.split(':');
  chap = ch;
  if (vr.includes('-')) { const [s, e] = vr.split('-'); range = [parseInt(s), parseInt(e)]; }
  else range = [parseInt(vr), parseInt(vr)];
}
const chData = anchor.data.books[bookInfo.sn].chapters[chap];
if (!chData) { console.log(`《${bookInfo.name}》没有第 ${chap} 章`); process.exit(1); }
const verseNums = Object.keys(chData).map(Number).sort((x, y) => x - y)
  .filter(v => !range || (v >= range[0] && v <= range[1]));

console.log(`《${bookInfo.name}》第 ${chap} 章`);
for (const v of verseNums) {
  if (loaded.length === 1) {
    console.log(`${chap}:${v} ${chData[v]}`);
  } else {
    console.log(`\n${chap}:${v}`);
    for (const x of loaded) {
      const t = x.data.books[bookInfo.sn] && x.data.books[bookInfo.sn].chapters[chap]
        ? x.data.books[bookInfo.sn].chapters[chap][v] : null;
      if (t) console.log(`  [${VERSIONS[x.id].name}] ${t}`);
    }
  }
}
