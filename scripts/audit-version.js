#!/usr/bin/env node
'use strict';
// Read-only by default. A new baseline is written only with --snapshot <file>.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');
const skillRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (flag === '--json' || flag === '--help') { opts[flag.slice(2)] = true; continue; }
  if (!['--source', '--game', '--baseline', '--snapshot', '--game-version', '--schema'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--')) {
    console.error('Invalid argument: ' + flag); process.exit(2);
  }
  opts[flag.slice(2)] = args[++i];
}
if (opts.help) {
  console.log('node audit-version.js [--source <export-root>] [--game <game-root>] [--baseline <json>] [--json]\nnode audit-version.js --snapshot <new-json> [--game-version <verified-version>] [--source <export-root>] [--game <game-root>] [--schema <ron>]\nDefault mode is read-only. Exit: 0 selected checks passed, 1 drift or bad export, 2 environment/arguments.');
  process.exit(0);
}
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const baselineFile = path.resolve(opts.baseline || path.join(skillRoot, 'assets', 'version-baseline.json'));
let baseline;
try {
  baseline = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : null;
  if (!baseline && !opts.snapshot) throw new Error('Baseline not found: ' + baselineFile);
  const suppliedSource = opts.source || process.env.WH3_EXPORT_DIR;
  if (!suppliedSource) throw new Error('Provide --source <export-root> or WH3_EXPORT_DIR');
  const source = path.resolve(suppliedSource);
  const game = opts.game || process.env.WH3_GAME_DIR;
  if (game && (!fs.existsSync(game) || !fs.statSync(game).isDirectory())) throw new Error("Game directory not found: " + game);
  const db = path.join(source, 'db');
  const problems = [], notes = [], tables = {};
  if (!game) notes.push("Game/build checks skipped: provide --game to enable");
  for (const entry of fs.readdirSync(db, { withFileTypes: true }).filter(x => x.isDirectory() && x.name.endsWith('_tables')).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(db, entry.name);
    const names = fs.readdirSync(dir).filter(x => x === 'data__.tsv' || x === 'data__');
    if (names.length !== 1) { problems.push(entry.name + ': expected one data__ or data__.tsv'); continue; }
    const bytes = fs.readFileSync(path.join(dir, names[0]));
    const info = { format: names[0] === 'data__' ? 'binary' : 'tsv', sha256: hash(bytes) };
    if (info.format === 'tsv') {
      const lines = decode(bytes).split(/\r?\n/);
      const columns = lines[0].replace(/^\uFEFF/, '').split('\t');
      const meta = /^#([^;]+);(\d+);([^\t]*)/.exec(lines[1] || '');
      if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) problems.push(entry.name + ': UTF-8 BOM');
      if (!meta || meta[1] !== entry.name || meta[3] !== 'db/' + entry.name + '/data__') problems.push(entry.name + ': invalid metadata');
      const rows = lines.slice(2).filter(x => x.length);
      const bad = rows.findIndex(x => x.split('\t').length !== columns.length);
      if (bad !== -1) problems.push(entry.name + ': bad row column count');
      Object.assign(info, { version: meta ? Number(meta[2]) : null, columns, rows: rows.length });
    } else { notes.push(entry.name + ': binary retained; rows/columns not verified'); }
    tables[entry.name] = info;
  }
  if (!Object.keys(tables).length) problems.push('No DB tables found');
  const packs = {};
  for (const name of ['db.pack', 'local_cn.pack', 'local_en.pack', 'data_script.pack']) {
    const local = path.join(source, name);
    const installed = game && path.join(game, 'data', name);
    const record = {};
    if (fs.existsSync(local)) record.exportCopy = hash(fs.readFileSync(local));
    if (installed && fs.existsSync(installed)) record.installed = hash(fs.readFileSync(installed));
    else if (game && ['db.pack', 'data_script.pack'].includes(name)) problems.push('Installed pack missing: ' + installed);
    else if (game) notes.push('Optional language pack not installed: ' + name);
    if (!record.exportCopy) notes.push('No source pack copy: ' + local);
    if (record.exportCopy && record.installed && record.exportCopy !== record.installed) problems.push(name + ': source pack differs from installed game');
    packs[name] = record;
  }
  let buildId = null;
  if (game) {
    const manifest = path.resolve(game, '../..', 'appmanifest_1142710.acf');
    if (fs.existsSync(manifest)) buildId = (/"buildid"\s+"(\d+)"/.exec(fs.readFileSync(manifest, 'utf8')) || [])[1] || null;
    else notes.push('Steam manifest missing: ' + manifest);
  }
  const schemaFile = opts.schema || process.env.WH3_SCHEMA;
  if (!schemaFile) notes.push("Schema check skipped: provide --schema to enable");
  const schema = schemaFile && fs.existsSync(schemaFile) ? { path: schemaFile, sha256: hash(fs.readFileSync(schemaFile)) } : null;
  if (schemaFile && !schema) problems.push('Schema missing: ' + schemaFile);
  const scripts = {};
  for (const name of ['lib_campaign_manager.lua', 'lib_battle_manager.lua', 'lib_battle_script_unit.lua', 'lib_mct.lua']) {
    const file = path.join(source, 'script', '_lib', name);
    if (fs.existsSync(file)) scripts[name] = hash(fs.readFileSync(file));
  }
  const facts = { formatVersion: 1, sourceRoot: source, gameRoot: game || null, gameVersion: opts['game-version'] || 'unknown', buildId, schema, packs, scripts, tables };
  const changes = [];
  if (baseline) {
    if (buildId && baseline.buildId !== buildId) changes.push('Steam build: ' + baseline.buildId + ' -> ' + buildId);
    if (schema && (!baseline.schema || baseline.schema.sha256 !== schema.sha256)) changes.push('RPFM schema changed');
    for (const name of new Set([...Object.keys(baseline.tables), ...Object.keys(tables)])) {
      const old = baseline.tables[name], current = tables[name];
      if (!old || !current) { changes.push(name + (old ? ': removed' : ': added')); continue; }
      if (old.sha256 === current.sha256) continue;
      const reasons = [];
      if (old.version !== current.version) reasons.push('version ' + old.version + ' -> ' + current.version);
      if (JSON.stringify(old.columns) !== JSON.stringify(current.columns)) reasons.push('columns/order changed');
      if (old.rows !== current.rows) reasons.push('rows ' + old.rows + ' -> ' + current.rows);
      changes.push(name + ': ' + (reasons.join('; ') || 'data values changed'));
    }
    for (const name of Object.keys(packs)) for (const field of Object.keys(packs[name])) {
      const old = (baseline.packs || {})[name];
      if (old && old[field] && old[field] !== packs[name][field]) changes.push(name + ': ' + field + ' hash changed');
    }
    for (const name of Object.keys(scripts)) if ((baseline.scripts || {})[name] && baseline.scripts[name] !== scripts[name]) changes.push(name + ': library changed');
    for (const name of Object.keys(baseline.scripts || {})) if (!scripts[name]) notes.push(name + ': library comparison skipped (not exported)');
  }
  const result = { tables: Object.keys(tables).length, readable: Object.values(tables).filter(x => x.format === 'tsv').length, binary: Object.values(tables).filter(x => x.format === 'binary').length, buildId, problems, changes, notes };
  if (opts.snapshot) {
    if (problems.length) throw new Error('Snapshot rejected: ' + problems.join('; '));
    const dest = path.resolve(opts.snapshot);
    if (fs.existsSync(dest)) throw new Error('Snapshot destination already exists; review it before replacing: ' + dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify({ ...facts, capturedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
    result.snapshot = dest;
  }
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('Tables ' + result.tables + ' (TSV ' + result.readable + ', binary ' + result.binary + '); Steam build ' + buildId);
    for (const item of problems) console.log('ERROR ' + item);
    for (const item of changes) console.log('DRIFT ' + item);
    for (const item of notes) console.log('NOTE ' + item);
    if (!problems.length && !changes.length) console.log('PASS: selected checks match baseline; skipped checks, binary content and engine behavior are not verified.');
    if (result.snapshot) console.log('Snapshot written: ' + result.snapshot);
  }
  process.exitCode = problems.length || (!opts.snapshot && changes.length) ? 1 : 0;
} catch (e) { console.error(e.message); process.exitCode = 2; }
