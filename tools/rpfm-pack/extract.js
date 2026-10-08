#!/usr/bin/env node
/**
 * rpfm-extract —— 从 .pack 里导出文件到磁盘（可导出为 TSV）
 *
 * 用法:
 *   node extract.js <pack路径> <输出目录>                      导出【全部】文件
 *   node extract.js <pack路径> <输出目录> text/db ui/units     只导出指定前缀的路径
 *
 * 例:
 *   node extract.js "<user-path>" "<user-path>" text/
 *
 * 说明:
 *   - 前缀匹配忽略大小写，按 pack 内原始路径 startsWith 判断
 *   - export_as_tsv = true：DB 表与 Loc 会导出成 .tsv 文本（可读），
 *     否则按原始字节导出（DB 是二进制）
 *   - 输出目录里保持 pack 内的原始相对路径
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const PORT = 45127;
const RPFM_SERVER = process.env.RPFM_SERVER || '';

const die = (m) => { console.error('\n[错误] ' + m); process.exit(1); };

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
      res.on('end', () => resolve({ headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('请求超时（600s）')));
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
    try { out.push(JSON.parse(p)); } catch (e) { /* ignore */ }
  }
  if (!out.length) { try { out.push(JSON.parse(body)); } catch (e) { /* ignore */ } }
  return out;
}

async function rpc(method, params) {
  const res = await httpPost({ jsonrpc: '2.0', id: rpcId++, method, params }, sessionId);
  for (const m of parseSse(res.body)) {
    if (m.error) throw new Error(`${method}: ${m.error.message}`);
    if (m.result) return m.result;
  }
  throw new Error(`${method} 无返回`);
}

async function callTool(name, args) {
  const r = await rpc('tools/call', { name, arguments: args || {} });
  let text = '';
  for (const c of (r.content || [])) text += (c.type === 'text' ? c.text : JSON.stringify(c)) + '\n';
  text = text.trim();
  if (/^\{?"Error/.test(text)) {
    const m = text.match(/"Error":"([^"]*)"/);
    throw new Error(`${name}: ${m ? m[1] : text.slice(0, 300)}`);
  }
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* ignore */ }
  return { text, json };
}

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
  if (await portAlive()) return;
  if (!fs.existsSync(RPFM_SERVER)) die(`未配置或找不到 RPFM server；请设置 RPFM_SERVER 或手动启动：${RPFM_SERVER}`);
  console.log('  正在启动 RPFM 服务器…');
  spawn(RPFM_SERVER, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await portAlive()) { console.log('  已就绪 ✓'); return; }
  }
  die('RPFM 服务器未能在 30 秒内就绪。');
}

async function main() {
  const argv = process.argv.slice(2).map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const packPath = argv[0];
  const outDir = argv[1];
  const prefixes = argv.slice(2).map((s) => s.toLowerCase());
  if (!packPath || !outDir) {
    die('用法: node extract.js <pack路径> <输出目录> [路径前缀...]\n' +
        '  例: node extract.js "<user-path>" "<user-path>" text/db');
  }
  if (!fs.existsSync(packPath)) die(`文件不存在: ${packPath}`);

  console.log('\n【连接 RPFM】');
  await ensureServer();
  const init = await httpPost({
    jsonrpc: '2.0', id: rpcId++, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'rpfm-extract', version: '1' } },
  }, null);
  sessionId = init.headers['mcp-session-id'] || null;
  await httpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
  await callTool('set_game_selected', { game_name: 'warhammer_3', rebuild_dependencies: false });

  await callTool('open_packfiles', { paths: [packPath] });
  const info = await callTool('open_pack_info', { pack_key: packPath });
  const arr = info.json && info.json.ContainerInfoVecRFileInfo;
  if (!arr) die('读不到 pack 内容');
  const all = (arr[1] || []).map((f) => f.path);
  const picked = prefixes.length ? all.filter((p) => prefixes.some((x) => p.toLowerCase().startsWith(x))) : all;

  if (!picked.length) die('没有匹配的路径（前缀写错？）');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n【导出】${path.basename(packPath)}`);
  console.log(`  pack 内共 ${all.length} 个，匹配 ${picked.length} 个`);
  console.log(`  输出到 ${outDir}`);

  // 分批，避免单次参数过大
  const BATCH = 400;
  for (let i = 0; i < picked.length; i += BATCH) {
    const chunk = picked.slice(i, i + BATCH);
    const sourcePaths = JSON.stringify({ PackFile: chunk.map((c) => ({ File: c })) });
    await callTool('extract_packed_files', {
      pack_key: packPath,
      source_paths: sourcePaths,
      destination_path: outDir,
      export_as_tsv: true,
    });
    console.log(`  ✓ ${Math.min(i + BATCH, picked.length)}/${picked.length}`);
  }

  // 统计
  let n = 0, bytes = 0;
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full); else { n++; bytes += st.size; }
    }
  };
  walk(outDir);
  console.log(`\n  ✅ 完成：${n} 个文件，${(bytes / 1024).toFixed(1)} KB`);
}

main().catch((e) => die(e.message || String(e)));
