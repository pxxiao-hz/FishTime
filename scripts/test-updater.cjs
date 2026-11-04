const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const {createManifest}=require('./update-manifest');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function app(response,behavior={}) {
  const nodes=new Map(), calls=[], events=new Map(), timers=[],badgeCalls=[];
  const storage=behavior.storage||new Map();
  if(behavior.preferences)storage.set('fishtime-update-preferences',JSON.stringify(behavior.preferences));
  let now=Date.parse('2026-11-04T00:00:00Z'),remote=response;
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const get=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{textContent:'',hidden:false,dataset:{},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},removeAttribute(){},addEventListener(name,fn){this[name]=fn;}});}return nodes.get(id);};
  const context=vm.createContext({Date:Clock,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},document:{getElementById:get,addEventListener(){}},window:{setTimeout:fn=>timers.push(fn),addEventListener(){},__TAURI__:{event:{listen:(name,fn)=>{events.set(name,fn);return Promise.resolve();}}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../updater.js'),'utf8'),context);
  context.window.FishTimeUpdater.init({language:()=> 'zh',version:()=>behavior.currentVersion||'5.1.0',pause:()=>{calls.push('pause');if(behavior.pauseError)throw new Error('storage failure');},invoke:async(command,args)=>{if(command==='set_update_badge'){badgeCalls.push(args.version);return;}calls.push(command);if(behavior[command])return behavior[command]();if(command==='check_for_update')return remote;}});
  return {controller:context.window.FishTimeUpdater,get,calls,events,timers,storage,badgeCalls,advance:ms=>{now+=ms;},setResponse:value=>{remote=value;}};
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
const DAY=24*60*60*1000;
async function startup(a){await settle();a.timers.forEach(callback=>callback());await settle();}
test('automatic startup and 24-hour checks are passive and never download',async()=>{
  const a=app({version:'5.2.0'});await startup(a);
  assert.deepEqual(a.calls,['check_for_update']);assert.equal(a.get('updateBanner').hidden,false);
  assert.equal(a.get('updateDialog').classList.contains('visible'),false);assert.equal(a.badgeCalls.at(-1),'5.2.0');
  a.events.get('updater:tick')();await settle();assert.equal(a.calls.length,1);
  a.advance(DAY);a.events.get('updater:tick')();await settle();assert.deepEqual(a.calls,['check_for_update','check_for_update']);
});
test('remind later hides the version for 24 hours without hiding newer versions',async()=>{
  const a=app({version:'5.2.0'});await startup(a);a.get('updateBannerLaterBtn').click();
  assert.equal(a.get('updateBanner').hidden,true);assert.equal(a.badgeCalls.at(-1),null);
  a.advance(DAY-1);a.events.get('updater:tick')();await settle();assert.equal(a.get('updateBanner').hidden,true);
  a.advance(1);a.events.get('updater:tick')();await settle();assert.equal(a.get('updateBanner').hidden,false);
});
test('skip persists through relaunch; manual checks bypass it and a later version is announced',async()=>{
  const a=app({version:'5.2.0'});await startup(a);a.get('updateBannerSkipBtn').click();assert.equal(a.get('updateBanner').hidden,true);
  const b=app({version:'5.2.0'},{storage:a.storage});await startup(b);assert.equal(b.get('updateBanner').hidden,true);
  b.controller.open();await settle();assert.match(b.get('updateStatus').textContent,/5.2.0/);assert.equal(b.get('updateInstallBtn').hidden,false);
  b.get('updateCloseBtn').click();b.advance(DAY);b.setResponse({version:'5.3.0'});b.events.get('updater:tick')();await settle();assert.equal(b.get('updateBanner').hidden,false);assert.match(b.get('updateBannerText').textContent,/5.3.0/);
});
test('turning automatic checks off persists and manual checking still works',async()=>{
  const a=app({version:'5.2.0'},{preferences:{enabled:false}});await startup(a);assert.equal(a.calls.length,0);
  a.advance(DAY*2);a.events.get('updater:tick')();await settle();assert.equal(a.calls.length,0);
  a.controller.open();await settle();assert.equal(a.calls.length,1);assert.equal(a.get('updateBanner').hidden,true);
  assert.equal(a.get('updateInstallBtn').hidden,false);
});
test('automatic failures are quiet and retries are limited to once per hour',async()=>{
  const a=app(null,{check_for_update:()=>{throw new Error('offline');}});await startup(a);
  assert.equal(a.get('updateStatus').textContent,'');assert.equal(a.get('updateBanner').hidden,true);
  a.advance(59*60*1000);a.events.get('updater:tick')();await settle();assert.equal(a.calls.length,1);
  a.advance(60*1000);a.events.get('updater:tick')();await settle();assert.equal(a.calls.length,2);
  a.controller.open();await settle();assert.match(a.get('updateStatus').textContent,/失败/);
});
test('manual checks join an in-flight background check and show requested errors',async()=>{
  let reject;const pending=new Promise((_,failure)=>{reject=failure;});
  const a=app(null,{check_for_update:()=>pending});await startup(a);a.controller.open();
  reject(new Error('offline'));await settle();assert.equal(a.calls.length,1);assert.match(a.get('updateStatus').textContent,/失败/);
});
test('opting out while a request is running prevents its reminder',async()=>{
  let resolve;const pending=new Promise(done=>{resolve=done;});
  const a=app(null,{check_for_update:()=>pending});await startup(a);
  a.get('updateAutoEnabled').checked=false;a.get('updateAutoEnabled').change();resolve({version:'5.2.0'});await settle();
  assert.equal(a.get('updateBanner').hidden,true);assert.equal(a.badgeCalls.at(-1),null);
  assert.equal(JSON.parse(a.storage.get('fishtime-update-preferences')).enabled,false);
});
test('installed or older cached versions do not leave stale badges',async()=>{
  const a=app(null,{currentVersion:'5.3.0',preferences:{availableVersion:'5.2.0'}});await settle();assert.equal(a.get('updateBanner').hidden,true);
  const b=app(null,{currentVersion:'5.3.0',preferences:{availableVersion:'5.10.0'}});await settle();assert.equal(b.get('updateBanner').hidden,false);
});
test('restoring an automatic-check preference does not trigger a background request',async()=>{
  const a=app({version:'5.2.0'});await settle();a.controller.setAutomaticEnabled(false);
  assert.equal(a.controller.automaticEnabled,false);a.controller.setAutomaticEnabled(true);
  assert.equal(a.controller.automaticEnabled,true);assert.equal(a.calls.length,0);
});
