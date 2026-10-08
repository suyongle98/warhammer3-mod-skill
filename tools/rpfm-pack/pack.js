#!/usr/bin/env node
/**
 * rpfm-pack —— 把一个 WH3 mod 源文件夹打包成 .pack
 *
 * 用法:
 *   node pack.js <mod文件夹> [输出.pack]
 *   例: node pack.js <user-path>
 *       node pack.js "<user-path>" <user-path>
 *
 * 它会自动:
 *   1. 确保 rpfm_server 在 127.0.0.1:45127 上跑（没跑就自己拉起来）
 *   2. 扫描源文件夹:
 *        db/<表名>/*.tsv        -> DB 表   （建表 + 导入 TSV）
 *        text 各级目录里的 *.loc.tsv   -> 本地化   （建 Loc + 导入 TSV）
 *        其余顶层目录           -> 原样加入 （ui/ script/ variants/ …）
 *   3. 存成 <mod文件夹>/打包版/<名字>.pack
 *
 * 不进 pack 的东西: 打包版/、_work/、参考mod/、_test/、.git/、node_modules/、以及根目录下的散文件
 * （README.md、*.pack、*.js、*.xlsx 之类）。
 *
 * 设计依据（2026-09-11 实测，RPFM v5.0.6 rpfm_server）:
 *   - MCP 会话是隔离的，整条流水线必须在同一个 session 里跑完
 *   - new_packed_file 的 new_file 参数要传【JSON 字符串】，不是对象
 *   - import_tsv 要求文件在 pack 里已存在 -> 必须先 new_packed_file
 *   - add_packed_files 只接受【目录】（递归添加），传单文件会报读不到；
 *     pack 内路径 = <destination Folder> / <源目录名> / <相对路径>，
 *     Folder("") 代表 pack 根
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const PORT = 45127;
const RPFM_SERVER = process.env.RPFM_SERVER || '';
const GAME = 'warhammer_3';

// 不进 pack 的目录（按目录名匹配）
const EXCLUDE_DIRS = new Set([
  '打包版', '发布版', '_work', '_xls_work', '_test', '_tests', '_dev',
  '参考mod', '参考', 'ref', 'reference',
  '.git', '.svn', '.idea', '.vscode',
  'node_modules', '__pycache__', 'dist', 'build',
]);

const log = (...a) => console.log(...a);
const die = (msg) => { console.error('\n[错误] ' + msg); process.exit(1); };

// ─────────────────────────────────────────── 文件名占位符
// 有些源 mod 的 pack 内路径含 Windows 非法文件名字符（实测 Morgiana_le_Fay_spell_rework
// 的 loc 就叫 `text/db/*Morgiana_land_units__.loc`，星号开头）。汉化包必须与源【逐字同名】
// 才能覆盖，而磁盘上建不出带 `*` 的名字 —— 所以约定：磁盘文件名里写 `__STAR__`，
// 打包时还原成 `*`。（`*` 的 ASCII 42 排在字母数字前，作者常用来让文件排最前。）
const STAR_TOKEN = '__STAR__';
const starDecode = (s) => s.split(STAR_TOKEN).join('*');

// ─────────────────────────────────────────── MCP over HTTP

let sessionId = null;
let rpcId = 1;

function httpPost(body, sid) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(data),
    };
    if (sid) headers['Mcp-Session-Id'] = sid;
    const req = http.request({ host: HOST, port: PORT, path: '/mcp', method: 'POST', headers, timeout: 600000 }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('请求超时（600s）')); });
    req.write(data);
    req.end();
  });
}

function parseSse(body) {
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue;
    const p = line.slice(6);
    if (!p.trim()) continue;
    try { out.push(JSON.parse(p)); } catch (e) { /* 忽略非 JSON 的心跳 */ }
  }
  if (!out.length) { try { out.push(JSON.parse(body)); } catch (e) { /* ignore */ } }
  return out;
}

async function rpc(method, params) {
  const res = await httpPost({ jsonrpc: '2.0', id: rpcId++, method, params }, sessionId);
  for (const m of parseSse(res.body)) {
    if (m.error) throw new Error(`${method} 失败: ${m.error.message || JSON.stringify(m.error)}`);
    if (m.result) return m.result;
  }
  throw new Error(`${method} 无返回`);
}

async function callTool(name, args) {
  const r = await rpc('tools/call', { name, arguments: args || {} });
  let text = '';
  for (const c of (r.content || [])) text += (c.type === 'text' ? c.text : JSON.stringify(c)) + '\n';
  text = text.trim();
  // RPFM 把失败也塞在正常返回里
  if (/^\{"Error"/.test(text)) {
    const m = text.match(/"Error":"([^"]*)"/);
    throw new Error(`${name}: ${m ? m[1] : text.slice(0, 300)}`);
  }
  if (/^"Error/.test(text)) throw new Error(`${name}: ${text.slice(0, 300)}`);
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON 也正常 */ }
  return { text, json };
}

// ─────────────────────────────────────────── 服务器就绪

function portAlive() {
  return new Promise((resolve) => {
    const s = http.request({ host: HOST, port: PORT, path: '/mcp', method: 'POST', timeout: 1500 },
      () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.end();
  });
}

async function ensureServer() {
  if (await portAlive()) { log('  RPFM 服务器已在运行 ✓'); return; }
  if (!fs.existsSync(RPFM_SERVER)) {
    die(`未配置或找不到 RPFM server；请设置 RPFM_SERVER 或手动启动：${RPFM_SERVER}\n` +
        `  请先手动启动 RPFM server，或用环境变量 RPFM_SERVER 指定路径。`);
  }
  log('  正在启动 RPFM 服务器…');
  spawn(RPFM_SERVER, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await portAlive()) { log('  RPFM 服务器已就绪 ✓'); return; }
  }
  die('等了 30 秒，RPFM 服务器仍未监听 45127 端口。请检查 RPFM server 配置后重试。');
}

async function mcpInit() {
  const res = await httpPost({
    jsonrpc: '2.0', id: rpcId++, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'rpfm-pack', version: '1' } },
  }, null);
  sessionId = res.headers['mcp-session-id'] || null;
  await httpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
}

// ─────────────────────────────────────────── 扫描源文件夹

/** 读 TSV 第 2 行元数据 `#表名;版本;路径`，拿版本号 */
function readTsvMeta(tsvPath) {
  const fd = fs.openSync(tsvPath, 'r');
  const buf = Buffer.alloc(4096);
  const n = fs.readSync(fd, buf, 0, 4096, 0);
  fs.closeSync(fd);
  const lines = buf.slice(0, n).toString('utf8').split(/\r?\n/);
  if (lines.length < 2) return null;
  const meta = lines[1].split('\t')[0];
  const m = meta.match(/^#([^;]+);(\d+);(.*)$/);
  if (!m) return null;
  return { tableName: m[1], version: parseInt(m[2], 10), packPath: m[3] };
}

function scan(root) {
  const dbEntries = [];
  const locEntries = [];
  const resDirs = [];

  const dbRoot = path.join(root, 'db');
  if (fs.existsSync(dbRoot)) {
    for (const tableName of fs.readdirSync(dbRoot)) {
      const tableDir = path.join(dbRoot, tableName);
      if (!fs.statSync(tableDir).isDirectory()) continue;
      for (const f of fs.readdirSync(tableDir)) {
        if (!f.toLowerCase().endsWith('.tsv')) continue;
        const base = starDecode(f.replace(/\.tsv$/i, ''));
        const tsvPath = path.join(tableDir, f);
        const meta = readTsvMeta(tsvPath);
        dbEntries.push({
          tsvPath,
          tableName,
          fileName: base,
          version: meta ? meta.version : 0,
          rel: `db/${tableName}/${base}`,
        });
      }
    }
  }

  const textRoot = path.join(root, 'text');
  if (fs.existsSync(textRoot)) {
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) { walk(full); continue; }
        if (!f.toLowerCase().endsWith('.loc.tsv')) continue;
        const rel = starDecode(path.relative(root, full).replace(/\\/g, '/'));   // text/db/xxx.loc.tsv
        locEntries.push({ tsvPath: full, rel: rel.replace(/\.tsv$/i, ''), name: starDecode(f).replace(/\.loc\.tsv$/i, '') });
      }
    };
    walk(textRoot);
  }

  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    if (!fs.statSync(full).isDirectory()) continue;
    if (EXCLUDE_DIRS.has(name)) continue;
    if (name === 'db' || name === 'text') continue;
    resDirs.push({ name, full });
  }

  return { dbEntries, locEntries, resDirs };
}

// ─────────────────────────────────────────── 主流程

async function main() {
  let srcDir = process.argv[2];
  if (!srcDir) die('用法: node pack.js <mod文件夹> [输出.pack]\n  例: node pack.js <user-path>');
  srcDir = srcDir.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
  if (!fs.existsSync(srcDir)) die(`源文件夹不存在: ${srcDir}`);
  if (!fs.statSync(srcDir).isDirectory()) die(`不是文件夹: ${srcDir}`);

  // 源目录本身若叫「打包版 / 发布版」（RPFM 解包出来的工作副本），
  // 就用父目录名当 mod 名，输出也放回它自己里面。
  const baseName = path.basename(srcDir);
  const isPackDir = baseName === '打包版' || baseName === '发布版';
  const modName = (isPackDir ? path.basename(path.dirname(srcDir)) : baseName).replace(/^@/, '');
  const outDir = isPackDir ? srcDir : path.join(srcDir, '打包版');
  const outPack = process.argv[3]
    ? path.resolve(process.argv[3].trim().replace(/^"|"$/g, ''))
    : path.join(outDir, modName + '.pack');

  log('');
  log('════════════════════════════════════════════════');
  log(`  RPFM 打包  |  ${modName}`);
  log('════════════════════════════════════════════════');
  log(`  源文件夹 : ${srcDir}`);
  log(`  输出     : ${outPack}`);
  log('');

  // 扫描
  const { dbEntries, locEntries, resDirs } = scan(srcDir);
  log('【扫描结果】');
  log(`  DB 表    : ${dbEntries.length} 个`);
  dbEntries.forEach((e) => log(`             ${e.rel}  (ver=${e.version})`));
  log(`  本地化   : ${locEntries.length} 个`);
  locEntries.forEach((e) => log(`             ${e.rel}`));
  log(`  资源目录 : ${resDirs.length} 个`);
  resDirs.forEach((d) => {
    let n = 0;
    const count = (p) => { for (const f of fs.readdirSync(p)) { const q = path.join(p, f); if (fs.statSync(q).isDirectory()) count(q); else n++; } };
    try { count(d.full); } catch (e) { /* ignore */ }
    log(`             ${d.name}/  (${n} 个文件)`);
  });
  if (dbEntries.length + locEntries.length + resDirs.length === 0) die('没扫到任何可打包的内容。');

  // 服务器
  log('\n【连接 RPFM】');
  await ensureServer();
  await mcpInit();

  log('\n【打包】');
  await callTool('set_game_selected', { game_name: GAME, rebuild_dependencies: false });
  const np = await callTool('new_pack', {});
  const packKey = (np.json && (np.json.String || np.json)) || 'new_pack.pack';
  if (typeof packKey !== 'string') die('new_pack 返回异常: ' + np.text.slice(0, 200));

  // DB 表
  for (const e of dbEntries) {
    const newFile = JSON.stringify({ DB: [e.fileName, e.tableName, e.version] });
    if (process.env.PACK_DEBUG) {
      log(`  [debug] new_packed_file args: ${JSON.stringify({ pack_key: packKey, path: e.rel, new_file: newFile })}`);
      log(`  [debug] import_tsv args: ${JSON.stringify({ pack_key: packKey, tsv_path: e.tsvPath, table_path: e.rel })}`);
    }
    await callTool('new_packed_file', { pack_key: packKey, path: e.rel, new_file: newFile });
    await callTool('import_tsv', { pack_key: packKey, tsv_path: e.tsvPath, table_path: e.rel });
    log(`  ✓ ${e.rel}`);
  }

  // 本地化
  for (const e of locEntries) {
    const newFile = JSON.stringify({ Loc: e.name });
    await callTool('new_packed_file', { pack_key: packKey, path: e.rel, new_file: newFile });
    await callTool('import_tsv', { pack_key: packKey, tsv_path: e.tsvPath, table_path: e.rel });
    log(`  ✓ ${e.rel}`);
  }

  // 资源目录
  for (const d of resDirs) {
    await callTool('add_packed_files', {
      pack_key: packKey,
      source_paths: [d.full],
      destination_paths: JSON.stringify([{ Folder: '' }]),
    });
    log(`  ✓ ${d.name}/`);
  }

  // 保存
  fs.mkdirSync(path.dirname(outPack), { recursive: true });
  if (fs.existsSync(outPack)) fs.unlinkSync(outPack);
  await callTool('save_pack_as', { pack_key: packKey, path: outPack });

  const size = fs.statSync(outPack).size;
  log('');
  log('════════════════════════════════════════════════');
  log(`  ✅ 完成: ${outPack}`);
  log(`     大小: ${(size / 1024).toFixed(1)} KB`);
  log(`     内容: ${dbEntries.length} 张 DB 表 + ${locEntries.length} 个本地化 + ${resDirs.length} 个资源目录`);
  log('════════════════════════════════════════════════');
  log('');
}

main().catch((e) => die(e.message || String(e)));
