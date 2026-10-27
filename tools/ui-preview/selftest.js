'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
const {spawnSync}=require('child_process');
const configArgs=process.argv[2]?['--config',path.resolve(process.argv[2])]:[];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wh3-ui-preview-'));
const cases=[
  ['valid','<html><body style="margin:0"><div style="height:100px;background:#253e32;color:white">中文 UI 预览</div></body></html>',0],
  ['missing','<html><body><img src="missing.png"></body></html>',1],
  ['script-error','<html><body><script>throw Error("fixture page failure")</script></body></html>',1],
  ['remote-resource','<html><body><img src="https://example.invalid/blocked.png"></body></html>',1]
];
for(const [name,html,code] of cases){
  const input=path.join(dir,name+'.html');fs.writeFileSync(input,html);
  const result=spawnSync(process.execPath,[path.join(__dirname,'preview.js'),input,...configArgs,'--width','640','--height','360'],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.strictEqual(result.status,code,result.stderr+result.stdout);
  assert.strictEqual(fs.readFileSync(input,'utf8'),html,'source HTML was changed');
  const report=JSON.parse(fs.readFileSync(path.join(dir,name+'.preview.json'),'utf8'));
  assert.strictEqual(report.inGameVerified,false);
  if(name==='missing')assert(report.brokenImages.length>0);
  if(name==='script-error')assert(report.errors.some(e=>e.includes('fixture page failure')));
  if(name==='remote-resource')assert(report.remoteRequests.length>0);
}
const repeat=spawnSync(process.execPath,[path.join(__dirname,'preview.js'),path.join(dir,'valid.html'),...configArgs],{encoding:'utf8',windowsHide:true});
assert.strictEqual(repeat.status,2,'existing output must not be silently replaced');
console.log(JSON.stringify({passed:5,fixtures:dir,scope:'render/missing-image/page-error/remote-block/overwrite-guard; no game execution'}));
