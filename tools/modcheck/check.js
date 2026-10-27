#!/usr/bin/env node
/**
 * modcheck —— 战锤3 MOD 源文件静态自检（打包前跑一遍）
 *
 * 定位：check-tsv.ps1 管的是「浅层格式」，本工具管「深层语义」——
 *       与数据真源对拍（表头/版本/枚举）、跨表引用闭合、汉化覆盖完整性。
 *       不依赖 RPFM / 不联网 / 不改任何文件，秒级。
 *
 * 用法:
 *   node check.js <mod文件夹> [选项]
 *
 * 选项:
 *   --ref <目录>      参考 mod 的解包目录（extract.js 的产物）：
 *                     ① 作为引用定义域补充 ② loc key 覆盖对齐（汉化包必填）
 *   --vanilla <目录>  原版数据真源 db 目录（默认 --vanilla / WH3_EXPORT_DIR）
 *   --no-refs         跳过引用闭合检查（最快，只做格式+对拍）
 *   --strict-en       把「疑似未翻译英文」从提示升级为警告
 *   --quiet           只打印问题，不打印通过项
 *   --json            以 JSON 输出（给脚本/Agent 用）
 *
 * 检查项:
 *   A 文件层    UTF-8 无 BOM、换行符、空行/尾部空行、Lua 语法（有 luac5.1 时）
 *   B DB 表     元数据行格式与表名/路径一致、列数一致、表头与版本对拍原版、
 *               主键重复、覆盖原版行统计、数字主键 I32 上限
 *   C 本地化    表头/元数据行、列数、换行转义(\\n 而非 \n)、空译文、key 重复、
 *               疑似未翻译英文、与参考 mod 同路径 loc 的 key 覆盖对齐（漏翻检测）
 *   D 引用闭合  mod 里每个非数字值能否在【原版 + 参考 mod + 本 mod】任一表首列找到定义；
 *              D2 精确列引用  获取表的 resource_factor 必须命中连接表主键（防 DB 崩溃）；
 *               豁免「在原版同表同列里出现过的枚举值」
 *
 * 退出码: 0 = 无错误（警告/提示不阻塞打包）；1 = 有错误
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_VANILLA = process.env.WH3_DB_DIR || (process.env.WH3_EXPORT_DIR ? path.join(process.env.WH3_EXPORT_DIR, 'db') : null);
const DEFAULT_LOC = null;
const LUAC = process.env.WH3_LUAC || null;
const { spawnSync } = require('child_process');
const I32_MAX = 2147483647;
// Current schema_wh3.ron v0: ingredient + recipe are both is_key=true.
// Vanilla happens to use every ingredient once here, so row uniqueness alone
// cannot identify this composite key.
const SCHEMA_KEYS = {
  cooking_recipe_required_ingredients_tables: ['ingredient', 'recipe'],
  // RPFM schema_wh3 v0: building_level + required are both is_key=true;
  // vanilla only ever has one required per level, so row uniqueness alone
  // cannot identify the composite key.
  building_level_required_buildings_tables: ['building_level', 'required'],
};



// 磁盘文件名里的占位符：打包时由 pack.js 还原成 `*`
// （源 mod 的 pack 内路径可能含 Windows 非法字符，如 text/db/*Morgiana_land_units__.loc）
const STAR_TOKEN = '__STAR__';

// ───────────────────────────────────────── 参数

function parseArgs(argv) {
  const o = { mod: null, ref: null, vanilla: DEFAULT_VANILLA, loc: DEFAULT_LOC, refs: true, strictEn: false, quiet: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--ref', '--vanilla', '--loc'].includes(a) && (!argv[i+1] || argv[i+1].startsWith('--'))) { console.error('Missing value: ' + a); process.exit(2); }
    if (a.startsWith('--') && !['--ref','--vanilla','--loc','--no-refs','--strict-en','--quiet','--json'].includes(a)) { console.error('Unknown option: ' + a); process.exit(2); }
    if (a === '--ref') o.ref = argv[++i];
    else if (a === '--vanilla') o.vanilla = argv[++i];
    else if (a === '--loc') o.loc = argv[++i];
    else if (a === '--no-refs') o.refs = false;
    else if (a === '--strict-en') o.strictEn = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--json') o.json = true;
    else if (!a.startsWith('--')) o.mod = a;
  }
  return o;
}

// ───────────────────────────────────────── 问题收集

const issues = [];
function add(level, code, file, msg, line) {
  issues.push({ level, code, file, msg, line: line || null });
}
const err = (c, f, m, l) => add('error', c, f, m, l);
const warn = (c, f, m, l) => add('warn', c, f, m, l);
const info = (c, f, m, l) => add('info', c, f, m, l);

// ───────────────────────────────────────── 基础工具

function readTsv(p) {
  const buf = fs.readFileSync(p);
  const bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const txt = buf.toString('utf8').replace(/^\uFEFF/, '');
  const crlf = (txt.match(/\r\n/g) || []).length;
  const lf = (txt.match(/(?<!\r)\n/g) || []).length;
  let lines = txt.split(/\r?\n/);
  let trailingBlank = false;
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length && lines[lines.length - 1].trim() === '') trailingBlank = true;
  return {
    bom, crlf, lf, trailingBlank, txt,
    header: (lines[0] || '').split('\t'),
    meta: lines[1] || '',
    rows: lines.slice(2).map((l) => l.split('\t')),
    rawLines: lines,
  };
}

const hasCJK = (s) => /[\u3400-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/.test(s);
const isBool = (s) => s === 'true' || s === 'false';
const isNum = (s) => s !== '' && /^-?\d+(\.\d+)?$/.test(s);
/** 抛掉值里的占位符/富文本标签，露出人话部分 */
const stripMarks = (s) => s.replace(/%[+\-]?n|%[sd]|\{\{[^}]*\}\}|\[\[[^\]]*\]\]|<[^>]*>/g, ' ');

function walkFiles(root, pred, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const name of fs.readdirSync(root)) {
    const p = path.join(root, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkFiles(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

const rel = (base, p) => path.relative(base, p).replace(/\\/g, '/');

// ───────────────────────────────────────── A 文件层

function checkFiles(root, files) {
  let okCount = 0;
  for (const f of files) {
    const r = rel(root, f);
    const isTsv = /\.tsv$/i.test(f);
    const isLua = /\.lua$/i.test(f);
    const buf = fs.readFileSync(f);
    if (buf.length === 0) { err('EMPTY', r, '空文件'); continue; }
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      err('BOM', r, isLua ? 'Lua 带 BOM → luac5.1 会报 near \'ï»¿\'，必须去掉' : '存在 UTF-8 BOM，原版与现有 MOD 全部无 BOM');
    }
    if (isTsv) {
      const txt = buf.toString('utf8');
      const crlf = (txt.match(/\r\n/g) || []).length;
      if (crlf > 0) {
        const lf = (txt.match(/(?<!\r)\n/g) || []).length;
        warn('CRLF', r, `含 ${crlf} 处 CRLF 换行（LF ${lf} 处）—— 原版与多数 MOD 用 LF；CRLF 游戏能读，仅规范/一致性提示`);
      }
      okCount++;
    }
    if (isLua) {
      if (LUAC) {
        const r = spawnSync(LUAC, ['-p', f], { encoding:'utf8', windowsHide:true });
        if (r.error) err('LUA_TOOL', rel(root, f), 'Lua checker failed: ' + r.error.message);
        else if (r.status !== 0) err('LUA_SYNTAX', rel(root, f), (r.stderr || r.stdout || 'Lua syntax error').trim());
      }
      okCount++;
    }
  }
  return okCount;
}

// ───────────────────────────────────────── B DB 表

function checkDbTables(root, tables, vanillaDir) {
  const stats = { checked: 0, headerMatch: 0, headerOld: 0, overrides: 0 };
  for (const t of tables) {
    const r = t.rel;
    const vanPath = path.join(vanillaDir, t.table, 'data__.tsv');
    const van = fs.existsSync(vanPath) ? readTsv(vanPath) : null;

    // 元数据行（注意：元数据行会用制表符补齐到表头列数，路径只到第一个制表符为止）
    const m = /^#([^;]+);(\d+);([^\t]*)/.exec(t.meta);
    if (!m) {
      err('META', r, `第 2 行不是 '#表名;版本;路径'：${t.meta.slice(0, 60)}`, 2);
    } else {
      if (m[1] !== t.table) err('META_TABLE', r, `元数据表名 "${m[1]}" ≠ 目录名 "${t.table}"`, 2);
      const wantPath = `db/${t.table}/${t.name}`;
      if (m[3] !== wantPath) err('META_PATH', r, `元数据路径 "${m[3]}" ≠ "${wantPath}"`, 2);
      t.version = parseInt(m[2], 10);
    }

    // 列数一致
    const ncol = t.header.length;
    const bad = [];
    for (let i = 0; i < t.rows.length; i++) {
      if (t.rows[i].length !== ncol) bad.push({ line: i + 3, got: t.rows[i].length });
    }
    if (bad.length) {
      const p = bad[0];
      err('COLS', r, `${bad.length} 行列数与表头不一致（首个在第 ${p.line} 行：${p.got} 列 vs ${ncol} 列）`, p.line);
    }

    // 表头 / 版本 对拍原版
    if (van) {
      const vh = van.header;
      if (t.header.join('\t') === vh.join('\t')) {
        stats.headerMatch++;
        if (t.version !== undefined && t.version !== vanVersion(van)) {
          warn('VER', r, `表版本 ${t.version} ≠ 原版 ${vanVersion(van)}（表头一致，通常无害）`, 2);
        }
      } else if (ncol < vh.length && vh.slice(0, ncol).join('\t') === t.header.join('\t')) {
        stats.headerOld++;
        warn('OLD_SCHEMA', r,
          `旧版 schema：表头少 ${vh.length - ncol} 列（缺 ${vh.slice(ncol).join(', ')}）—— ` +
          `本表新增/修改的行会丢这些列；新表一律照原版 data__.tsv 的表头与版本号`, 1);
      } else {
        err('HEADER', r,
          `表头与原版不一致（mod ${ncol} 列 / 原版 ${vh.length} 列）。原版前几列：${vh.slice(0, 4).join(' | ')}`, 1);
      }
    } else {
      info('NO_VANILLA', r, '原版无此表（自建表？确认表名拼写与用途）', 1);
    }

    // 首列是不是「唯一键」：拿原版同表判定（有些表首列是枚举，如 effect_bonus_value_* 的
    // bonus_value_id 全是 "enable"，此时重复与"覆盖原版行"都是正常的，不能当问题报）
    let firstColIsKey = true;
    if (van && van.rows.length > 0) {
      const vs = new Set();
      for (const row of van.rows) if (row[0] !== '') vs.add(row[0]);
      firstColIsKey = vs.size / van.rows.length > 0.9;
    }

    const schemaKeys = SCHEMA_KEYS[t.table];
    if (schemaKeys) firstColIsKey = false;

    // Verified composite keys take priority over the first-column heuristic.
    const seen = new Map();
    if (schemaKeys) {
      const indices = schemaKeys.map(name => t.header.indexOf(name));
      if (indices.some(index => index < 0)) err('KEY_SCHEMA', r, '复合主键列缺失，请核对当前 schema：' + schemaKeys.join(' + '));
      else for (let i = 0; i < t.rows.length; i++) {
        const k = JSON.stringify(indices.map(index => t.rows[i][index]));
        if (seen.has(k)) err('DUP_KEY', r, `复合主键重复（${schemaKeys.join(' + ')}）：${k}（首见第 ${seen.get(k)} 行）`, i + 3);
        else seen.set(k, i + 3);
      }
    } else if (firstColIsKey) {
      for (let i = 0; i < t.rows.length; i++) {
        const k = t.rows[i][0];
        if (k === '') continue;
        if (seen.has(k)) err('DUP_KEY', r, `首列主键重复："${k}"（首见第 ${seen.get(k)} 行）—— 唯一键表里重复会让后一行覆盖前一行`, i + 3);
        else seen.set(k, i + 3);
      }
    }

    // 覆盖原版行 / I32 上限
    if (van && firstColIsKey) {
      const vanKeys = new Set();
      for (const row of van.rows) if (row[0] !== '') vanKeys.add(row[0]);
      const overlap = [];
      for (const row of t.rows) if (row[0] !== '' && vanKeys.has(row[0])) overlap.push(row[0]);
      if (overlap.length) {
        stats.overrides += overlap.length;
        const isFull = /^data__$/.test(t.name);
        info('OVERRIDE', r,
          `${isFull ? '整表替换' : '增量覆盖'}：${overlap.length} 行与原版同主键` +
          `（${overlap.slice(0, 3).join(', ')}${overlap.length > 3 ? ' …' : ''}）—— 确认是有意覆盖`, 1);
      }
    }
    for (const row of t.rows) {
      if (isNum(row[0]) && Number(row[0]) > I32_MAX) {
        warn('I32', r, `首列 ${row[0]} > 2,147,483,647：若该列是 I32 会溢出（I64 列无此限制，查 schema 确认）`);
        break;
      }
    }
    stats.checked++;
  }
  return stats;
}
const vanVersion = (t) => parseInt((/^#[^;]+;(\d+);/.exec(t.meta) || [0, 0])[1], 10);

// ───────────────────────────────────────── C 本地化

function checkLoc(root, locFiles, refDir, strictEn) {
  const stats = { checked: 0, records: 0, refAligned: 0 };
  for (const f of locFiles) {
    const r = rel(root, f);
    const t = readTsv(f);
    const nm = path.basename(f).replace(/\.loc\.tsv$/i, '');

    if (t.header.join('|') !== 'key|text|tooltip') {
      err('LOC_HEADER', r, `首行应为 key\\ttext\\ttooltip，实际：${t.header.join('\\t').slice(0, 60)}`, 1);
    }
    if (!/^#Loc;1;/.test(t.meta)) err('LOC_META', r, `第 2 行应为 '#Loc;1;<pack内路径>'，实际：${t.meta.slice(0, 60)}`, 2);

    const keys = new Set();
    const noTrans = [];
    const badEsc = [];
    for (let i = 0; i < t.rows.length; i++) {
      const row = t.rows[i];
      const line = i + 3;
      const k = row[0], text = row[1] === undefined ? '' : row[1];
      if (k !== '' && keys.has(k)) warn('LOC_DUPKEY', r, `key 重复：${k}`, line);
      keys.add(k);

      // 换行转义：真源用双反斜杠，单反斜杠是错的
      const single = text.match(/(?<!\\)\\n/g);
      if (single) badEsc.push(`${k}（${single.length} 处单反斜杠）`);
      if (!text) { noTrans.push(k); continue; }
      const plain = stripMarks(text);
      if (!hasCJK(plain) && /[A-Za-z]{4,}/.test(plain)) noTrans.push(`${k} = ${plain.slice(0, 60)}`);
    }
    if (badEsc.length) {
      err('LOC_ESC', r, `${badEsc.length} 条用了单反斜杠 \\n（真源是双反斜杠 \\\\n，实测原版 CN 库 11,689 处全是双反斜杠）：${badEsc.slice(0, 3).join('; ')}`);
    }
    if (noTrans.length) {
      add(strictEn ? 'warn' : 'info', 'LOC_UNTRANSLATED', r,
        `${noTrans.length} 条 text 列空或疑似未翻译：${noTrans.slice(0, 5).join(' | ')}`);
    }
    stats.checked++;
    stats.records += t.rows.length;

    // 与参考 mod 同路径 loc 的 key 覆盖对齐（汉化漏翻检测）
    if (refDir) {
      // pack 内路径可能含 Windows 非法字符（实测源 mod 的 loc 叫 text/db/*Morgiana_*.loc）。
      // 本仓库约定磁盘文件名用 __STAR__ 占位；而 RPFM 解包到磁盘时 * 会被替换成 _，
      // 故三种写法都当候选，取第一个存在的。
      const relPath = rel(root, f);
      const cands = [relPath];
      if (relPath.includes(STAR_TOKEN)) {
        cands.push(relPath.split(STAR_TOKEN).join('*'));
        cands.push(relPath.split(STAR_TOKEN).join('_'));
      }
      let refPath = null;
      for (const c of cands) {
        const p = path.join(refDir, c);
        if (fs.existsSync(p)) { refPath = p; break; }
      }
      if (refPath) {
        const rt = readTsv(refPath);
        const refKeys = rt.rows.map((x) => x[0]).filter((k) => k !== '');
        const missing = refKeys.filter((k) => !keys.has(k));
        const extra = [...keys].filter((k) => k !== '' && !refKeys.includes(k));
        stats.refAligned++;
        if (missing.length) {
          warn('LOC_MISSING', r,
            `参考 mod 有 ${missing.length} 个 key 本文件未覆盖（漏翻会导致这些条目回落到原文/空）：${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}`);
        }
        if (extra.length) {
          info('LOC_EXTRA', r, `本文件多出 ${extra.length} 个参考 mod 没有的 key：${extra.slice(0, 3).join(', ')}`);
        }
        if (!missing.length) {
          if (relPath.includes(STAR_TOKEN)) {
            const packPath = relPath.split(STAR_TOKEN).join('*').replace(/\.tsv$/i, '');
            info('LOC_COVER', r, `key 全覆盖参考 mod（${refKeys.length} 条）；pack 内路径 = ${packPath}（与源逐字同名 → 整文件覆盖）`);
          } else {
            info('LOC_COVER', r, `key 全覆盖参考 mod（${refKeys.length} 条）`);
          }
        }
        void nm;
      } else {
        info('LOC_NOREF', r, '参考 mod 里没有同路径 loc，无法做覆盖对齐');
      }
    }
  }
  return stats;
}

// ───────────────────────────────────────── D 引用闭合

function collectWanted(tables) {
  const wanted = new Set();
  for (const t of tables) {
    for (const row of t.rows) {
      for (const v of row) {
        if (v === '' || isBool(v) || isNum(v) || v.startsWith('#')) continue;
        wanted.add(v);
      }
    }
  }
  return wanted;
}

/** 流式扫描一个 db 目录：只记录 wanted 里出现过的首列值 → 返回命中的值集合 */
function scanPrimaryKeys(dbDir, wanted) {
  const hit = new Set();
  if (!fs.existsSync(dbDir)) return hit;
  for (const table of fs.readdirSync(dbDir)) {
    const td = path.join(dbDir, table);
    if (!fs.statSync(td).isDirectory()) continue;
    for (const f of fs.readdirSync(td)) {
      if (!f.toLowerCase().endsWith('.tsv')) continue;
      const txt = fs.readFileSync(path.join(td, f), 'utf8');
      const lines = txt.split('\n');
      for (let i = 2; i < lines.length; i++) {
        const l = lines[i];
        if (!l) continue;
        const e = l.indexOf('\t');
        const v = e < 0 ? l : l.slice(0, e);
        if (v !== '' && wanted.has(v)) hit.add(v);
      }
    }
  }
  return hit;
}

/** 原版同表同列的取值集合（枚举豁免用），带缓存 */
function makeColumnCache(vanillaDir) {
  const cache = new Map();
  return (table, col) => {
    const key = table + '\t' + col;
    if (cache.has(key)) return cache.get(key);
    let s = null;
    const p = path.join(vanillaDir, table, 'data__.tsv');
    if (fs.existsSync(p)) {
      const t = readTsv(p);
      const i = t.header.indexOf(col);
      if (i >= 0) {
        s = new Set();
        for (const row of t.rows) if (row[i] !== undefined && row[i] !== '') s.add(row[i]);
      }
    }
    cache.set(key, s);
    return s;
  };
}

/** 只读文件头几 KB 拿表头（判断某表有没有某列时避免读全表） */
function readHead(p) {
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(8192);
  const n = fs.readSync(fd, buf, 0, 8192, 0);
  fs.closeSync(fd);
  return buf.slice(0, n).toString('utf8').split(/\r?\n/)[0].split('\t');
}

/** 原版【任意表】的同名列取值集合（跨表同列豁免）—— 一次遍历所有表，按需收集 */
function crossColumnExempt(vanillaDir, cols) {
  const out = new Map();
  for (const c of cols) out.set(c, new Set());
  if (!cols.size || !fs.existsSync(vanillaDir)) return out;
  for (const table of fs.readdirSync(vanillaDir)) {
    const p = path.join(vanillaDir, table, 'data__.tsv');
    if (!fs.existsSync(p)) continue;
    const head = readHead(p);
    const idxs = [];
    for (const c of cols) { const i = head.indexOf(c); if (i >= 0) idxs.push([c, i]); }
    if (!idxs.length) continue;
    const t = readTsv(p);
    for (const [c, i] of idxs) { const s = out.get(c); for (const row of t.rows) if (row[i]) s.add(row[i]); }
  }
  return out;
}

/** mod 里所有资源文件名（去扩展名）—— 图标/兵模/png 一类引用列靠它豁免 */
function collectResourceNames(root) {
  const s = new Set();
  const SKIP = new Set(['_work', '_xls_work', '_test', '_dev', '打包版', '发布版', '.git', 'node_modules']);
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) { if (!SKIP.has(n)) walk(p); }
      else s.add(n.replace(/\.[^.]+$/, ''));
    }
  };
  try { walk(root); } catch (e) { /* ignore */ }
  return s;
}

/** 只把「形如标识符」的值当引用候选：数字、布尔、中文、路径、表达式一律不是表键 */
const identLike = (v) => /^[A-Za-z][A-Za-z0-9_.\-]*$/.test(v);

function checkRefs(tables, vanillaDir, refDir, modRoot) {
  const wanted = collectWanted(tables);
  const defined = scanPrimaryKeys(vanillaDir, wanted);            // 原版定义域
  if (refDir) for (const v of scanPrimaryKeys(path.join(refDir, 'db'), wanted)) defined.add(v);
  const own = new Set();                                          // 本 mod 自建 key
  for (const t of tables) for (const row of t.rows) if (row[0] !== '') own.add(row[0]);
  const resources = collectResourceNames(modRoot);
  const colCache = makeColumnCache(vanillaDir);

  const cand = new Map();   // "表 / 列" → { values:Set, firstLine }
  let cells = 0;
  for (const t of tables) {
    for (let ci = 1; ci < t.header.length; ci++) {                // 首列是主键，不算引用
      const col = t.header[ci];
      const vanCol = colCache(t.table, col);
      for (let ri = 0; ri < t.rows.length; ri++) {
        const v = t.rows[ri][ci];
        if (v === undefined || v === '' || isBool(v) || !identLike(v)) continue;
        cells++;
        if (own.has(v) || defined.has(v)) continue;               // 本 mod 或原版/参考 mod 有定义
        if (vanCol && vanCol.has(v)) continue;                    // 枚举：原版同表同列就是这个值
        if (resources.has(v)) continue;                           // 指向 mod 自带的资源文件（图标/兵模名）
        const k = `${t.table} / ${col}`;
        if (!cand.has(k)) cand.set(k, { values: new Set(), firstLine: ri + 3 });
        cand.get(k).values.add(v);
      }
    }
  }

  // 跨表同列豁免：值在原版别的表的同名列里出现过 → 视为枚举/合法
  const cross = crossColumnExempt(vanillaDir, new Set([...cand.keys()].map((k) => k.split(' / ')[1])));
  const dangling = new Map();
  for (const [k, { values, firstLine }] of cand) {
    const ex = cross.get(k.split(' / ')[1]);
    const rest = [...values].filter((v) => !(ex && ex.has(v)));
    if (rest.length) dangling.set(k, { values: new Set(rest), firstLine });
  }
  return { dangling, wanted: wanted.size, defined: defined.size, cells, resources: resources.size };
}

// ───────────────────────────────────────── 主流程

// ─── 精确列引用（error 级）
// 背景（2026-10-03 su_njsslt 实机崩溃）：战后获取表 campaign_group_post_battle_* 的
// resource_factor 列必须指向 pooled_resource_factor_junctions_tables 的主键（unique_id），
// 而不是 pooled_resource_factors_tables 的 key。两者形状相近极易混用；若误写的 key 恰好
// 也在因子表里定义过，上面宽松的「任一表首列」检查会放行，游戏则在 DB 构建时报
// first_invalid_database_record 并封杀整个 pack。下表列出必须指向特定表主键的列。
const EXACT_COL_REFS = [
  { table: 'campaign_group_post_battle_casualty_resources_tables', col: 'resource_factor', target: 'pooled_resource_factor_junctions_tables',
    hint: '该列必须指向 pooled_resource_factor_junctions_tables 的 unique_id，最常见错法是误写成 pooled_resource_factors_tables 的 key' },
  { table: 'campaign_group_post_battle_looted_pooled_resources_tables', col: 'resource_factor', target: 'pooled_resource_factor_junctions_tables',
    hint: '该列必须指向 pooled_resource_factor_junctions_tables 的 unique_id，最常见错法是误写成 pooled_resource_factors_tables 的 key' },
  // ── 效果桥接表（2026-10-22 su_szjq 实机崩溃）：effect 列必须指向 effects_tables.effect
  // basic/agent/public_order/scripted 的列序都是 effect → ...，而 unit_sets 是 bonus_value_id → effect → unit_set，
  // 两者形状相近；写反后宽松的「任一表首列」检查会因 bonus_value_id 恰好是另一张表的首列而放行，
  // 游戏则在 DB 构建时报 first_invalid_database_record 并封杀整个 pack。
  { table: 'effect_bonus_value_basic_junction_tables', col: 'effect', target: 'effects_tables',
    hint: '本表列序是 effect → bonus_value_id，必须把效果名写在第 1 列；effect_bonus_value_ids_unit_sets_tables 才是 bonus_value_id → effect → unit_set，极易整行写反' },
  { table: 'effect_bonus_value_agent_junction_tables', col: 'effect', target: 'effects_tables',
    hint: '本表列序是 effect → bonus_value_id → agent' },
  { table: 'effect_bonus_value_ids_unit_sets_tables', col: 'effect', target: 'effects_tables',
    hint: '本表列序是 bonus_value_id → effect → unit_set，效果名必须在第 2 列' },
  { table: 'effect_bonus_value_public_order_provider_junctions_tables', col: 'effect', target: 'effects_tables',
    hint: '本表列序是 bonus_value_id → effect → public_order_provider' },
  { table: 'effect_bonus_value_scripted_junctions_tables', col: 'effect', target: 'effects_tables',
    hint: '本表列序是 bonus_value_id → effect → scripted_record' },
  { table: 'building_effects_junction_tables', col: 'effect', target: 'effects_tables',
    hint: '建筑效果必须指向 effects_tables.effect' },
  { table: 'effect_bundles_to_effects_junctions_tables', col: 'effect_key', target: 'effects_tables',
    hint: '效果包挂载的 effect_key 必须指向 effects_tables.effect' },
  // ── 其它引用列：指向各自定义表的主键
  { table: 'effect_bonus_value_ids_unit_sets_tables', col: 'unit_set', target: 'unit_sets_tables',
    hint: 'unit_set 必须指向 unit_sets_tables 的主键（如 all_units）' },
  { table: 'effect_bonus_value_agent_junction_tables', col: 'agent', target: 'agents_tables',
    hint: 'agent 必须指向 agents_tables 的主键' },
  { table: 'effect_bonus_value_public_order_provider_junctions_tables', col: 'public_order_provider', target: 'public_order_providers_tables',
    hint: 'public_order_provider 必须指向 public_order_providers_tables 的主键' },
  { table: 'effect_bonus_value_scripted_junctions_tables', col: 'scripted_record', target: 'scripted_bonus_value_ids_tables',
    hint: 'scripted_record 必须指向 scripted_bonus_value_ids_tables 的主键' },
];

/** 读某张表在某个 db 目录下的全部首列值（定义域） */
function readPrimaryKeySet(dbDir, tableName) {
  const s = new Set();
  const td = path.join(dbDir, tableName);
  if (!fs.existsSync(td) || !fs.statSync(td).isDirectory()) return s;
  for (const f of fs.readdirSync(td)) {
    if (!f.toLowerCase().endsWith('.tsv')) continue;
    const t = readTsv(path.join(td, f));
    for (const row of t.rows) if (row[0]) s.add(row[0]);
  }
  return s;
}

function checkExactRefs(tables, vanillaDir, refDir, modRoot) {
  let cells = 0;
  for (const rule of EXACT_COL_REFS) {
    const domain = readPrimaryKeySet(vanillaDir, rule.target);
    if (refDir) for (const v of readPrimaryKeySet(path.join(refDir, 'db'), rule.target)) domain.add(v);
    for (const t of tables) if (t.table === rule.target) for (const row of t.rows) if (row[0]) domain.add(row[0]);
    if (!domain.size) continue;                       // 定义域为空 → 无从判定，跳过
    for (const t of tables) {
      if (t.table !== rule.table) continue;
      const ci = t.header.indexOf(rule.col);
      if (ci < 0) continue;
      for (let ri = 0; ri < t.rows.length; ri++) {
        const v = t.rows[ri][ci];
        if (v === undefined || v === '') continue;
        cells++;
        if (domain.has(v)) continue;
        err('BAD_REF', rel(modRoot, t.path),
          `第 ${ci + 1} 列 "${rule.col}" 的值 "${v}" 不在 ${rule.target} 的主键里 —— ${rule.hint}。` +
          `游戏会在 DB 构建时报 first_invalid_database_record 并封杀整个 pack`,
          ri + 3);
      }
    }
  }
  return cells;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.mod) {
    console.error('用法: node check.js <mod文件夹> [--ref <参考mod解包目录>] [--no-refs] [--strict-en] [--json]');
    process.exit(2);
  }
  const root = path.resolve(o.mod);
  if (o.ref && (!fs.existsSync(o.ref) || !fs.statSync(o.ref).isDirectory())) { console.error('Reference directory not found: ' + o.ref); process.exit(2); }
  if (o.vanilla && (!fs.existsSync(o.vanilla) || !fs.statSync(o.vanilla).isDirectory())) { console.error('Vanilla DB directory not found: ' + o.vanilla); process.exit(2); }
  if (!fs.existsSync(root)) { console.error(`目录不存在: ${root}`); process.exit(2); }

  // 收集 mod 内容
  const dbRoot = path.join(root, 'db');
  const tables = [];
  if (fs.existsSync(dbRoot)) {
    for (const table of fs.readdirSync(dbRoot)) {
      const td = path.join(dbRoot, table);
      if (!fs.statSync(td).isDirectory()) continue;
      for (const f of fs.readdirSync(td)) {
        if (!f.toLowerCase().endsWith('.tsv')) continue;
        const p = path.join(td, f);
        const t = readTsv(p);
        tables.push({ ...t, table, name: f.replace(/\.tsv$/i, ''), rel: rel(root, p), path: p });
      }
    }
  }
  if (tables.length && !o.vanilla) { console.error('DB checks require --vanilla <DB-dir>, WH3_DB_DIR or WH3_EXPORT_DIR'); process.exit(2); }
  const locFiles = walkFiles(path.join(root, 'text'), (p) => /\.loc\.tsv$/i.test(p));
  const otherFiles = walkFiles(root, (p) => /\.(lua|txt|xml)$/i.test(p) && !rel(root, p).split('/').includes('_work'));

  if (otherFiles.some(f => /\.lua$/i.test(f)) && !LUAC) warn('LUA_SKIPPED', root, 'Lua syntax not checked: set WH3_LUAC to luac5.1 executable');
  // A
  const fileStats = checkFiles(root, [...tables.map((t) => t.path), ...locFiles, ...otherFiles]);
  // B
  const dbStats = tables.length ? checkDbTables(root, tables, o.vanilla) : { checked: 0, headerMatch: 0, headerOld: 0, overrides: 0 };
  // C
  const locStats = locFiles.length ? checkLoc(root, locFiles, o.ref, o.strictEn) : { checked: 0, records: 0, refAligned: 0 };
  // D
  let refStats = null;
  let exactRefCells = 0;
  if (o.refs && tables.length) {
    refStats = checkRefs(tables, o.vanilla, o.ref, root);
    exactRefCells = checkExactRefs(tables, o.vanilla, o.ref, root);   // 精确列引用（error 级）
  }

  // 汇总
  const byLevel = { error: 0, warn: 0, info: 0 };
  for (const i of issues) byLevel[i.level]++;
  if (refStats) {
    for (const [k, { values, firstLine }] of refStats.dangling) {
      warn('DANGLING', k,
        `${values.size} 个值在【原版 + 参考 mod + 本 mod】任一表首列都找不到定义，也不在原版同列/同名资源里：` +
        `${[...values].slice(0, 5).join(', ')}${values.size > 5 ? ' …' : ''}`, firstLine);
      byLevel.warn++;
    }
  }

  if (o.json) {
    console.log(JSON.stringify({
      mod: root, ref: o.ref,
      scanned: { files: fileStats, tables: dbStats.checked, locs: locStats.checked, locRecords: locStats.records, otherFiles: otherFiles.length },
      refs: refStats ? { wanted: refStats.wanted, defined: refStats.defined, cells: refStats.cells, exactCells: exactRefCells } : null,
      counts: byLevel, issues,
    }, null, 2));
    process.exit(byLevel.error ? 1 : 0);
  }

  // ── 人类可读输出
  const L = (s) => console.log(s);
  const icon = { error: '✗', warn: '!', info: '·' };
  L('');
  L('════════════════════════════════════════════════');
  L(`  modcheck  |  ${path.basename(root)}`);
  L('════════════════════════════════════════════════');
  L(`  目录      : ${root}`);
  L(`  参考 mod  : ${o.ref || '（未指定，跳过引用定义域补充与 loc 覆盖对齐）'}`);
  L(`  原版真源  : ${o.vanilla}`);
  L('');
  L('【扫描】');
  L(`  DB 表     : ${dbStats.checked} 张（表头与原版一致 ${dbStats.headerMatch} / 旧 schema ${dbStats.headerOld}）`);
  L(`  本地化    : ${locStats.checked} 个文件 / ${locStats.records} 条记录`);
  L(`  其他文件  : ${otherFiles.length} 个（lua/txt/xml）`);
  if (refStats) L(`  引用检查  : 待查值 ${refStats.wanted} 个 → 命中定义 ${refStats.defined} 个，逐格检查 ${refStats.cells} 处（mod 自带资源名 ${refStats.resources} 个）`);
  if (exactRefCells) L(`  精确引用  : 逐格检查 ${exactRefCells} 处（列级精确引用 → 目标表主键）`);

  const groups = [
    ['文件层（编码/换行/空文件）', ['EMPTY', 'BOM', 'CRLF']],
    ['DB 表（元数据/列数/表头/版本/I32）', ['META', 'META_TABLE', 'META_PATH', 'COLS', 'HEADER', 'OLD_SCHEMA', 'VER', 'DUP_KEY', 'I32', 'NO_VANILLA', 'OVERRIDE']],
    ['本地化（格式/转义/译文/覆盖对齐）', ['LOC_HEADER', 'LOC_META', 'LOC_ESC', 'LOC_DUPKEY', 'LOC_UNTRANSLATED', 'LOC_MISSING', 'LOC_EXTRA', 'LOC_COVER', 'LOC_NOREF']],
    ['跨表引用闭合', ['DANGLING', 'BAD_REF']],
  ];
  for (const [title, codes] of groups) {
    const list = issues.filter((i) => codes.includes(i.code));
    if (!list.length) { if (!o.quiet) { L(''); L(`【${title}】`); L('  ✓ 通过'); } continue; }
    L('');
    L(`【${title}】`);
    for (const i of list) {
      const loc = i.line ? `${i.file}:${i.line}` : i.file;
      L(`  ${icon[i.level]} [${i.code}] ${loc}`);
      L(`      ${i.msg}`);
    }
  }

  L('');
  L('════════════════════════════════════════════════');
  L(`  错误 ${byLevel.error} ｜ 警告 ${byLevel.warn} ｜ 提示 ${byLevel.info}`);
  if (byLevel.error) {
    L('  ❌ 有错误：修完再打包（错误项会导致静默不加载 / 整表失效）');
  } else if (byLevel.warn) {
    L('  ⚠️  无错误，但有警告：逐条确认后再打包');
  } else {
    L('  ✅ 通过');
  }
  L('════════════════════════════════════════════════');
  L('');
  L('下一步：打包 → 回环验证');
  L(`  node "tools/rpfm-pack/pack.js" "${root}" "${path.join(root, '打包版')}\\<名字>.pack"`);
  L('');
  process.exit(byLevel.error ? 1 : 0);
}

main();
