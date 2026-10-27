#!/usr/bin/env node
'use strict';
// Local HTML rendering only; does not interpret TWUI or run the game.
const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const {createHash} = require('crypto');
const {spawnSync} = require('child_process');
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    console.log('用法: node preview.js <本地.html> [--out <预览.png>] [--width 1600] [--height 934]\n  [--build-python <项目预览生成器.py>] [--config <runtime.json>] [--overwrite]\n输出 PNG 和同名 .json 检查报告。0=离线渲染通过；1=页面/资源错误；2=参数/环境错误。\n只支持本地 HTML；不解析 TWUI、不代表游戏内效果。');
    return;
  }
  const html = path.resolve(args.shift());
  const options = {width:1600, height:934, config:path.join(__dirname,'runtime.local.json')};
  const names = {'--out':'out','--width':'width','--height':'height','--config':'config','--build-python':'build'};
  while (args.length) {
    const key = args.shift();
    if (key === '--overwrite') { options.overwrite = true; continue; }
    if (!names[key] || !args.length || args[0].startsWith('--')) throw Error('未知或缺值参数: '+key);
    options[names[key]] = args.shift();
  }
  for (const key of ['width','height']) {
    options[key] = Number(options[key]);
    if (!Number.isInteger(options[key]) || options[key]<200 || options[key]>8192) throw Error(key+' 必须为 200–8192 的整数');
  }
  if (!/\.html?$/i.test(html)) throw Error('输入必须是 HTML；TWUI 需先由项目适配器拼合');
  const output = path.resolve(options.out || html.replace(/\.html?$/i,'.preview.png'));
  if (path.extname(output).toLowerCase() !== '.png') throw Error('输出扩展名须为 .png');
  const reportPath = output.replace(/\.png$/i,'.json');
  if (!options.overwrite && [output,reportPath].some(p=>fs.existsSync(p))) throw Error('输出已存在；换文件名或明确加 --overwrite');
  const runtime = JSON.parse(fs.readFileSync(path.resolve(options.config),'utf8').replace(/^\uFEFF/,''));
  if (options.build) {
    const builder = path.resolve(options.build);
    if (path.extname(builder).toLowerCase() !== '.py' || !fs.existsSync(builder)) throw Error('项目生成器不存在或不是 .py');
    const result = spawnSync(runtime.python,[builder],{cwd:path.dirname(builder),encoding:'utf8',windowsHide:true,timeout:60000});
    if (result.error || result.status !== 0) throw Error('项目生成器失败: '+(result.error?.message || result.stderr || result.stdout));
  }
  if (!fs.statSync(html).isFile() || !fs.existsSync(runtime.chrome)) throw Error('HTML 或 Chrome 路径无效；请按 README 配置 runtime.local.json');
  const {chromium} = require(runtime.playwright);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const report = {tool:'ui-preview/1',input:html,inputSha256:hash(html),viewport:{width:options.width,height:options.height},offlinePreviewOnly:true,inGameVerified:false,errors:[],failedRequests:[],brokenImages:[],remoteRequests:[]};
  let browser;
  try {
    browser = await chromium.launch({executablePath:runtime.chrome,headless:true});
    const page = await browser.newPage({viewport:report.viewport,deviceScaleFactor:1});
    page.on('pageerror',e=>report.errors.push(e.message));
    page.on('requestfailed',r=>report.failedRequests.push({url:r.url().slice(0,300),error:r.failure()?.errorText}));
    // Offline previews use local files or data URLs; do not silently rely on a website.
    await page.route('**/*',route=>{
      if (/^https?:/i.test(route.request().url())) {
        report.remoteRequests.push(route.request().url().slice(0,300));
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(pathToFileURL(html).href,{waitUntil:'load',timeout:15000});
    await page.evaluate(async()=>{
      await document.fonts.ready;
      await Promise.allSettled(Array.from(document.images,img=>img.decode()));
    });
    report.brokenImages = await page.locator('img').evaluateAll(es=>es.filter(e=>!e.complete||!e.naturalWidth).map(e=>(e.getAttribute('src')||'').slice(0,300)));
    // A separate top banner makes the limitation survive sharing the PNG.
    await page.evaluate(()=>{
      const banner=document.createElement('div');
      banner.textContent='离线 UI 素材预览 · 非游戏截图 · 字体、布局和状态需实机验收';
      Object.assign(banner.style,{position:'relative',zIndex:'2147483647',height:'30px',boxSizing:'border-box',padding:'6px 12px',background:'#131b18',color:'#ecdcae',font:'13px sans-serif'});
      const content=document.createElement('div');
      Object.assign(content.style,{position:'relative',display:'flow-root'});
      while(document.body.firstChild)content.appendChild(document.body.firstChild);
      document.body.append(banner,content);
    });
    await page.screenshot({path:output,fullPage:true,animations:'disabled',timeout:15000});
    report.screenshot = output;
    report.screenshotSha256 = hash(output);
    report.status = report.errors.length||report.failedRequests.length||report.brokenImages.length||report.remoteRequests.length ? 'failed' : 'passed';
  } catch (e) {
    report.errors.push(e.message); report.status='failed';
  } finally {
    if(browser)await browser.close();
    fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n','utf8');
  }
  console.log(JSON.stringify({status:report.status,preview:report.screenshot,report:reportPath,offlinePreviewOnly:true}));
  process.exitCode=report.status==='passed'?0:1;
}
main().catch(e=>{console.error(e.message);process.exitCode=2;});
