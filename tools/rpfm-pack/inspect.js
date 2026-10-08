#!/usr/bin/env node
/**
 * rpfm-inspect —— 用 RPFM 查看 / 对比 .pack 内容
 *
 * 用法:
 *   node inspect.js <pack路径>                  列出 pack 里有什么
 *   node inspect.js <packA> <packB>             对比两个 pack 的内容
 *
 * 例:
 *   node inspect.js "<user-path>"
 *   node inspect.js "<user-path>" "<user-path>"
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
    req.on('timeout', () => req.destroy(new Error('请求超时')));
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
  const m = text.match(/^\{"Error":"([^"]*)"/);
  if (m) throw new Error(`${name}: ${m[1]}`);
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
  if (!fs.existsSync(RPFM_SERVER)) die(`未配置或找不到 RPFM server；请设置 RPFM_SERVER 或手动启动：${RPFM_SERVER}\n  请先手动启动 RPFM server`);
  console.log('  正在启动 RPFM 服务器…');
  spawn(RPFM_SERVER, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await portAlive()) { console.log('  已就绪 ✓'); return; }
  }
  die('RPFM 服务器未能在 30 秒内就绪。');
}

async function readPack(packPath) {
  await callTool('open_packfiles', { paths: [packPath] });
  const info = await callTool('open_pack_info', { pack_key: packPath });
  const arr = info.json && info.json.ContainerInfoVecRFileInfo;
  if (!arr) return { files: [], meta: null };
  const meta = arr[0];
  const files = (arr[1] || []).map((f) => ({ path: f.path, type: f.file_type }));
  return { files, meta };
}

async function main() {
  const packs = process.argv.slice(2).map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  if (!packs.length) die('用法: node inspect.js <pack路径> [另一个pack路径]\n  例: node inspect.js "<user-path>"');
  for (const p of packs) if (!fs.existsSync(p)) die(`文件不存在: ${p}`);

  console.log('\n【连接 RPFM】');
  await ensureServer();
  const init = await httpPost({
    jsonrpc: '2.0', id: rpcId++, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'rpfm-inspect', version: '1' } },
  }, null);
  sessionId = init.headers['mcp-session-id'] || null;
  await httpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
  await callTool('set_game_selected', { game_name: 'warhammer_3', rebuild_dependencies: false });

  const results = [];
  for (const p of packs) {
    const r = await readPack(p);
    results.push({ pack: p, ...r });
  }

  if (results.length === 1) {
    const r = results[0];
    console.log('\n════════════════════════════════════════════════');
    console.log(`  ${path.basename(r.pack)}`);
    console.log('════════════════════════════════════════════════');
    console.log(`  路径: ${r.pack}`);
    if (r.meta) console.log(`  格式: ${r.meta.pfh_version} / ${r.meta.pfh_file_type} / 压缩 ${r.meta.compress}`);
    console.log(`  文件: ${r.files.length} 个`);
    console.log(`  大小: ${(fs.statSync(r.pack).size / 1024).toFixed(1)} KB`);
    console.log('');
    const byType = {};
    for (const f of r.files) (byType[f.type] = byType[f.type] || []).push(f.path);
    for (const t of Object.keys(byType).sort()) {
      console.log(`  [${t}] ${byType[t].length} 个`);
      byType[t].sort().forEach((p) => console.log(`      ${p}`));
    }
    console.log('');
  } else {
    console.log('\n════════════════════════════════════════════════');
    console.log('  pack 内容对比');
    console.log('════════════════════════════════════════════════');
    const sets = results.map((r) => ({
      name: path.basename(r.pack),
      pack: r.pack,
      map: new Map(r.files.map((f) => [f.path, f.type])),
      size: fs.statSync(r.pack).size,
    }));
    sets.forEach((s) => console.log(`  ${s.name}: ${s.map.size} 个文件, ${(s.size / 1024).toFixed(1)} KB`));

    const all = new Map();
    for (const s of sets) for (const k of s.map.keys()) all.set(k, true);

    let same = 0;
    const onlyIn = [];
    const missing = [];
    const typeDiff = [];
    for (const k of [...all.keys()].sort()) {
      const present = sets.map((s) => s.map.has(k));
      if (present.every((x) => x)) {
        const types = sets.map((s) => s.map.get(k));
        if (new Set(types).size === 1) same++;
        else typeDiff.push(`${k}  (类型: ${types.join(' vs ')})`);
      } else {
        const names = sets.filter((s, i) => present[i]).map((s) => s.name).join(', ');
        const absent = sets.filter((s, i) => !present[i]).map((s) => s.name).join(', ');
        onlyIn.push(`${k}  只在 [${names}]，不在 [${absent}]`);
      }
    }

    console.log(`\n  两边都有: ${same} 个`);
    if (typeDiff.length) {
      console.log(`\n  ⚠ 类型不同 ${typeDiff.length} 个:`);
      typeDiff.forEach((x) => console.log(`      ${x}`));
    }
    if (onlyIn.length) {
      console.log(`\n  ⚠ 只在一侧 ${onlyIn.length} 个:`);
      onlyIn.forEach((x) => console.log(`      ${x}`));
    }
    if (!typeDiff.length && !onlyIn.length) console.log('\n  ✅ 文件清单完全一致');
    console.log('');
  }
}

main().catch((e) => die(e.message || String(e)));
