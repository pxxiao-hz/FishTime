const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function app(preferences={}){
  const storage=new Map([['fishtime-bgm',JSON.stringify(preferences)]]);let src='';
  const audio={paused:true,loop:true,getAttribute:()=>src,get src(){return src;},set src(value){src=value;this.paused=true;},play(){this.paused=false;return Promise.resolve();}};
  const nodes=new Map();const element=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',dataset:{},style:{}});return nodes.get(id);};
  const context=vm.createContext({console,window:{addEventListener(){},__TAURI__:{core:{convertFileSrc:p=>'asset://localhost/'+p}},FishTimeMusic:{refresh(){}}},document:{getElementById:element},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),context);context.testAudio=audio;
  vm.runInContext('loadBgmSettings();bgmAudio=testAudio;setBgmSource(0,false,false);',context);
  return {audio,storage,run:code=>vm.runInContext(code,context)};
}
test('restores a selected library track after asynchronous loading without storing local paths',()=>{
  const a=app({selectedId:'track-a',repeatMode:'list'});
  assert.equal(JSON.parse(a.storage.get('fishtime-bgm')).selectedId,'track-a');
  a.run('applyMusicLibrary([{id:"track-a",name:"Private title",path:"/private/music/a.wav",available:true,bytes:100}]);');
  assert.equal(a.run('bgmSources[bgmState.index].id'),'track-a');
  const saved=JSON.parse(a.storage.get('fishtime-bgm'));assert.equal(saved.selectedId,'track-a');assert.equal(saved.repeatMode,'list');
  assert.equal(JSON.stringify(saved).includes('/private/music'),false);assert.equal(saved.sources.length,1);
});
test('next and previous skip missing copies and removing the selected track stops playback',()=>{
  const a=app();a.run('applyMusicLibrary([{id:"track-a",name:"Missing",path:null,available:false,bytes:100},{id:"track-b",name:"Ready",path:"/private/music/b.wav",available:true,bytes:100}]);');
  assert.equal(a.run('nextBgmIndex(1)'),2);a.run('setBgmSource(2,true,true);');assert.equal(a.audio.paused,false);
  a.run('applyMusicLibrary([],null,"track-b");');assert.equal(a.audio.paused,true);assert.equal(a.run('bgmSettings.selectedId'),'builtin-1');
});
