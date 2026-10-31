const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const {createManifest}=require('./update-manifest');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function app(response,behavior={}) {
  const nodes=new Map(), calls=[], events=new Map();
  const get=id=>{if(!nodes.has(id)) nodes.set(id,{textContent:'',hidden:false,dataset:{},classList:{add(){},remove(){}},removeAttribute(){},addEventListener(name,fn){this[name]=fn;}});return nodes.get(id);};
  const context=vm.createContext({document:{getElementById:get},window:{__TAURI__:{event:{listen:(name,fn)=>{events.set(name,fn);return Promise.resolve();}}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../updater.js'),'utf8'),context);
  context.window.FishTimeUpdater.init({language:()=> 'zh',version:()=> '5.1.0',pause:()=>{calls.push('pause');if(behavior.pauseError)throw new Error('storage failure');},invoke:async(command)=>{calls.push(command);if(behavior[command])return behavior[command]();if(command==='check_for_update')return response;}});
  return {controller:context.window.FishTimeUpdater,get,calls,events};
}
test('manifest points to a versioned signed Apple Silicon archive',()=>{
  const result=createManifest('5.1.0','YWJjZA==','notes',new Date('2026-10-31T00:00:00Z'));
  assert.equal(result.platforms['darwin-aarch64'].url,'https://github.com/pxxiao-hz/FishTime/releases/download/v5.1.0/FishTime.app.tar.gz');
  assert.equal(result.platforms['darwin-aarch64'].signature,'YWJjZA==');
  assert.throws(()=>createManifest('bad','YWJjZA==',''));
  assert.throws(()=>createManifest('5.1.0','',''));
});
test('up-to-date check does not pause or install',async()=>{
  const a=app(null);a.controller.open();await settle();
  assert.match(a.get('updateStatus').textContent,/最新/);
  assert.deepEqual(a.calls,['check_for_update']);
  assert.equal(a.get('updateInstallBtn').hidden,true);
});
test('download completes before sessions pause; only then install and restart',async()=>{
  let finish;const downloading=new Promise(resolve=>{finish=resolve;});
  const a=app({version:'5.2.0',notes:'notes'},{download_update:()=>downloading});
  a.controller.open();await settle();a.get('updateInstallBtn').click();await settle();
  assert.equal(a.calls.includes('pause'),false);
  a.events.get('updater:progress')({payload:{downloaded:50,total:100}});
  assert.equal(a.get('updateProgressText').textContent,'50%');
  finish();await settle();
  assert.deepEqual(a.calls,['check_for_update','download_update','pause','install_update','restart_after_update']);
});
test('download failure leaves timers running and does not install',async()=>{
  const a=app({version:'5.2.0'},{download_update:()=>{throw new Error('bad signature');}});
  a.controller.open();await settle();a.get('updateInstallBtn').click();await settle();
  assert.match(a.get('updateStatus').textContent,/失败/);
  assert.equal(a.calls.includes('pause'),false);assert.equal(a.calls.includes('install_update'),false);
});
test('a session save failure prevents replacing the application',async()=>{
  const a=app({version:'5.2.0'},{pauseError:true});
  a.controller.open();await settle();a.get('updateInstallBtn').click();await settle();
  assert.equal(a.calls.includes('install_update'),false);assert.equal(a.controller.installing,false);
});
test('installation failure does not restart and allows retry',async()=>{
  const a=app({version:'5.2.0'},{install_update:()=>{throw new Error('move_to_applications');}});
  a.controller.open();await settle();a.get('updateInstallBtn').click();await settle();
  assert.match(a.get('updateStatus').textContent,/应用程序/);
  assert.equal(a.calls.includes('restart_after_update'),false);assert.equal(a.get('updateCheckBtn').disabled,false);
});
