#!/usr/bin/env node
'use strict';
// loc-audit: 汉化包静态审校（只读）
// 用法: node loc-audit.js <MOD目录> [--ref <参考英文解包目录>] [--official <官方loc>] [--limit N]
const fs = require('fs');
const path = require('path');
const usage = '用法: node loc-audit.js <MOD目录> [--ref <参考英文解包目录>] [--official <官方loc>] [--limit N]';
function fail(message) { console.error(message); process.exit(2); }

const args = process.argv.slice(2);
if (args.includes('--help')) { console.log(usage); process.exit(0); }
let modDir = null, refDir = null, officialFile = null, limit = 10;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (['--ref', '--official', '--limit'].includes(a) && (!args[i + 1] || args[i + 1].startsWith('--'))) fail('参数缺值: ' + a);
  if (a === '--ref') refDir = args[++i];
  else if (a === '--official') officialFile = args[++i];
  else if (a === '--limit') { limit = Number(args[++i]); if (!Number.isInteger(limit) || limit < 1) fail('--limit 必须为正整数'); }
  else if (!a.startsWith('--') && !modDir) modDir = a;
  else { console.error('未知参数: ' + a); process.exit(2); }
}
if (!modDir) {
  console.error(usage);
  process.exit(2);
}
for (const dir of [modDir, refDir].filter(Boolean)) if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail('目录不存在: ' + dir);
if (officialFile && (!fs.existsSync(officialFile) || !fs.statSync(officialFile).isFile())) fail('官方 loc 文件不存在: ' + officialFile);

const ERR = [], WARN = [], INFO = [];
function add(level, cat, where, msg) {
  const rec = { cat, where, msg };
  if (level === 'ERROR') ERR.push(rec);
  else if (level === 'WARN') WARN.push(rec);
  else INFO.push(rec);
}

function collect(dir) {
  const out = [];
  const start = fs.existsSync(path.join(dir, 'text')) ? path.join(dir, 'text') : dir;
  (function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.loc\.tsv$/i.test(name)) out.push(p);
    }
  })(start);
  return out.sort();
}

function loadLoc(file) {
  const buf = fs.readFileSync(file);
  const bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const raw = buf.toString('utf8').replace(/^\uFEFF/, '');
  const trailingNewline = raw.endsWith('\n');
  const lines = raw.split(/\r?\n/);
  const header = lines.slice(0, 2);
  const rows = [];
  let badCols = 0;
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length !== 3) badCols++;
    rows.push({ key: parts[0], text: parts[1] || '', tip: parts[2] || '', line: i + 1, cols: parts.length });
  }
  return { file, bom, trailingNewline, header, rows, badCols };
}

function packPath(file) {
  let rel = path.relative(modDir, file).split(path.sep).join('/');
  return rel.replace(/__STAR__/g, '*');
}
function normName(p) {
  return String(p).replace(/__STAR__/g, '*').replace(/\*/g, '_')
    .replace(/\.loc\.tsv$/i, '').replace(/\.tsv$/i, '').toLowerCase();
}
function count(occ, sub) {
  if (!sub) return 0;
  return occ.split(sub).length - 1;
}
function ratioLcs(a, b) {
  if (!a || !b) return 0;
  const n = a.length, m = b.length;
  if (n * m > 4000000) return 0;
  const dp = new Uint16Array(m + 1);
  let best = 0, prev = 0;
  for (let i = 1; i <= n; i++) {
    prev = 0;
    for (let j = 1; j <= m; j++) {
      const tmp = dp[j];
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {
        dp[j] = prev + 1;
        if (dp[j] > best) best = dp[j];
      } else dp[j] = 0;
      prev = tmp;
    }
  }
  return best / Math.max(n, m);
}

// ---------- 官方库 ----------
let official = null;
if (officialFile) {
  const buf = fs.readFileSync(officialFile);
  official = new Map();
  const lines = buf.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const idx = line.indexOf('\t');
    if (idx < 0) continue;
    const rest = line.slice(idx + 1);
    const j = rest.indexOf('\t');
    official.set(line.slice(0, idx), j < 0 ? rest : rest.slice(0, j));
  }
}

// ---------- 参考包 ----------
let refIndex = null;
if (refDir) {
  const start = fs.existsSync(path.join(refDir, 'text')) ? refDir : refDir;
  refIndex = new Map();
  (function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.tsv$/i.test(name)) {
        const rel = path.relative(refDir, p).split(path.sep).join('/');
        refIndex.set(normName(rel), p);
      }
    }
  })(start);
}

// ---------- 主流程 ----------
const files = collect(modDir);
if (!files.length) fail('没有找到 .loc.tsv 文件，未执行审校');
const loaded = files.map(loadLoc);
const allKeyMap = new Map();
let totalRows = 0;

const rawWord = new Set(['MOD', 'DLC', 'WH', 'WH2', 'WH3', 'AI', 'HP', 'UI', 'AC', 'AP', 'MP', 'XP', 'BRT', 'LUA', 'MCT', 'ID', 'TW', 'AOE']);

for (const f of loaded) {
  const rel = packPath(f.file);
  totalRows += f.rows.length;
  console.log('文件: ' + rel + '  (' + f.rows.length + ' 条)');

  if (f.bom) add('ERROR', '结构', rel, '文件带 UTF-8 BOM');
  if (!f.trailingNewline) add('WARN', '结构', rel, '文件末尾没有换行');
  if (f.header[0] !== 'key\ttext\ttooltip') add('ERROR', '结构', rel, '首行不是 key\ttext\ttooltip：' + JSON.stringify(f.header[0]));
  if (!/^#Loc;\d+;[^\t]+/.test(f.header[1] || '')) add('ERROR', '结构', rel, '第 2 行缺少有效 #Loc 元数据');
  if (f.badCols) add('ERROR', '结构', rel, f.badCols + ' 行列数不是 3');

  const keys = new Set();
  for (const r of f.rows) {
    if (keys.has(r.key)) add('ERROR', '结构', rel, '重复 key: ' + r.key);
    keys.add(r.key);
    const prev = allKeyMap.get(r.key);
    if (prev && prev.text !== r.text) add('ERROR', '多文件同键', rel, '同键不同值: ' + r.key);
    else if (!prev) allKeyMap.set(r.key, { file: rel, text: r.text });

    const t = r.text;
    const stripped = t.replace(/\[\[[^\]]*\]\]/g, '').replace(/\{\{[^}]*\}\}/g, '');

    const stars = t.match(/\*[^*\n]{1,20}\*/g);
    if (stars) add('WARN', '星号残留', rel, r.key + ' :: ' + stars.join(' '));

    if (count(t, '[[b]]') !== count(t, '[[/b]]')) add('ERROR', '标记配对', rel, r.key + ' :: [[b]] 不成对');
    if (count(t, '[[col:') !== count(t, '[[/col]]')) add('ERROR', '标记配对', rel, r.key + ' :: [[col:]] 不成对');
    if (count(t, '[[img:') !== count(t, '[[/img]]')) add('ERROR', '标记配对', rel, r.key + ' :: [[img:]] 不成对');

    const words = stripped.match(/[A-Za-z]{4,}/g);
    if (words) {
      const bad = [...new Set(words)].filter(w => !rawWord.has(w.toUpperCase()));
      if (bad.length) add('WARN', '英文残留', rel, r.key + ' :: ' + bad.join(','));
    }
    if (/[\u4e00-\u9fff]\s+[\u4e00-\u9fff]/.test(stripped)) add('WARN', '中文空格', rel, r.key);
    if (/[\u4e00-\u9fff][,;:!?]|[,;:!?][\u4e00-\u9fff]/.test(stripped)) add('WARN', '半角标点', rel, r.key);
  }
}

// 参考包覆盖
if (refIndex) {
  for (const f of loaded) {
    const rel = packPath(f.file);
    const refFile = refIndex.get(normName(rel));
    if (!refFile) { add('INFO', '键覆盖', rel, '参考目录里没有同路径 loc'); continue; }
    const ref = loadLoc(refFile);
    const refKeys = new Set(ref.rows.map(r => r.key));
    const myKeys = new Set(f.rows.map(r => r.key));
    const missing = [...refKeys].filter(k => !myKeys.has(k));
    const extra = [...myKeys].filter(k => !refKeys.has(k));
    if (missing.length) add('ERROR', '键覆盖', rel, '缺 ' + missing.length + ' 个 key: ' + missing.slice(0, 5).join(', '));
    if (extra.length) add('INFO', '键覆盖', rel, '多 ' + extra.length + ' 个 key: ' + extra.slice(0, 5).join(', '));

    const refMap = new Map(ref.rows.map(r => [r.key, r.text]));
    for (const r of f.rows) {
      const en = refMap.get(r.key);
      if (en === undefined) continue;
      const a = count(en, '\\\\n\\\\n'), b = count(r.text, '\\\\n\\\\n');
      if (a !== b) add('WARN', '段落数', rel, r.key + ' :: 原文 ' + a + ' / 译文 ' + b);

      if (official && official.has(r.key)) {
        const off = official.get(r.key);
        if (off && off.trim() && off.trim() !== r.text.trim()) {
          const ratio = ratioLcs(r.text, off);
          if (ratio >= 0.6) add('INFO', '官方同名', rel, r.key + ' :: 相似度 ' + ratio.toFixed(2) + '，建议核对官方译文');
        }
      }

      const enNums = (en.match(/\d+(?:[.,]\d+)?/g) || []).sort().join(',');
      const cnNums = (r.text.match(/\d+(?:[.,]\d+)?/g) || []).sort().join(',');
      if (enNums && !r.text.includes('%+n') && enNums !== cnNums) {
        add('WARN', '数字', rel, r.key + ' :: 原文 [' + enNums + '] 译文 [' + cnNums + ']');
      }
    }
  }
}

function dump(level, arr) {
  if (!arr.length) return;
  console.log('');
  console.log('[' + level + '] ' + arr.length + ' 条');
  arr.slice(0, limit).forEach(x => console.log('  [' + x.cat + '] ' + x.where + ' :: ' + x.msg));
  if (arr.length > limit) console.log('  ……另有 ' + (arr.length - limit) + ' 条，用 --limit 调高');
}

console.log('');
console.log('记录合计: ' + totalRows);
dump('ERROR', ERR);
dump('WARN', WARN);
dump('INFO', INFO);
console.log('');
console.log('汇总: ERROR ' + ERR.length + ' / WARN ' + WARN.length + ' / INFO ' + INFO.length);
process.exit(ERR.length ? 1 : 0);
