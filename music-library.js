/* Native, persistent music copies. Metadata and original paths never leave the Mac. */
window.FishTimeMusic = (() => {
  let options, busy=false, message='', editing=null, removing=null;
  const $=id=>document.getElementById(id);
  const words={
    zh:{title:'本地音乐库',import:'导入音乐',folder:'在 Finder 中显示',close:'关闭',repeat:'播放模式',single:'单曲循环',list:'列表循环',hint:'导入时保存一份本地副本。移动或删除原文件不影响播放；移除曲目只删除副本。音乐文件不包含在计时 JSON 备份中。',formats:'支持 MP3、M4A、WAV、AAC、AIFF、FLAC，单首不超过 200 MB。',builtin:'内置曲目',selected:'已选择',playing:'正在播放',rename:'重命名',remove:'移除',save:'保存',cancel:'取消',confirm:'确认移除副本',question:'只移除音乐库副本，原始文件不会被删除。',missing:'副本缺失，请重新导入原文件',loading:'正在读取音乐库…',busy:'正在处理音乐文件…',unsupported:'永久导入仅在 FishTime 桌面 App 中可用。',failed:'操作失败，请检查磁盘空间和文件权限后重试。',invalid_library:'音乐库清单无法读取，现有文件未被覆盖。请检查音乐库文件夹。',invalid_size:'文件为空或超过 200 MB。',unsupported_format:'不支持此格式。请使用普通音频文件，不能直接播放加密的会员下载文件。',invalid_name:'请输入 1–100 个字符的名称。',read_failed:'音频文件无法读取。',playback:'无法播放这首音频，可能格式或编码不受支持。',added:'已导入 {count} 首',duplicates:'{count} 首重复曲目已跳过',errors:'{count} 首未导入',retry:'重新读取'},
    en:{title:'Local music library',import:'Import music',folder:'Show in Finder',close:'Close',repeat:'Playback',single:'Repeat one',list:'Repeat list',hint:'Imports create local copies. Moving the originals does not affect playback. Removing a track deletes its copy only. Audio is not included in timer JSON backups.',formats:'MP3, M4A, WAV, AAC, AIFF and FLAC. Up to 200 MB per file.',builtin:'Built-in',selected:'Selected',playing:'Playing',rename:'Rename',remove:'Remove',save:'Save',cancel:'Cancel',confirm:'Remove copy',question:'Only the library copy will be removed. Your original file will stay.',missing:'Copy missing. Import the original again.',loading:'Loading music…',busy:'Processing audio files…',unsupported:'Permanent imports are available in the FishTime desktop app only.',failed:'Operation failed. Check disk space and file permissions, then try again.',invalid_library:'Cannot read the library index. Existing audio has not been overwritten. Check the library folder.',invalid_size:'File is empty or larger than 200 MB.',unsupported_format:'Unsupported format. Use ordinary audio files, not encrypted subscription downloads.',invalid_name:'Enter a name with 1–100 characters.',read_failed:'Cannot read this audio file.',playback:'Cannot play this track. Its audio format or codec may not be supported.',added:'Imported {count} tracks',duplicates:'Skipped {count} duplicates',errors:'{count} tracks could not be imported',retry:'Reload library'}
  };
  const text=(key,count)=>{const value=(words[options?.language()||'zh']||words.zh)[key]||text('failed');return value.replace('{count}',count??'');};
  function button(label,action){const node=document.createElement('button');node.type='button';node.textContent=label;node.disabled=busy;node.addEventListener('click',action);return node;}
  function refresh(){
    if(!options)return;
    $('musicTitle').textContent=text('title');$('musicImportBtn').textContent=text('import');$('musicFolderBtn').textContent=text('folder');$('musicCloseBtn').textContent=text('close');
    $('musicHint').textContent=text('hint');$('musicFormats').textContent=text('formats');$('musicRepeatLabel').textContent=text('repeat');
    $('musicReloadBtn').textContent=text('retry');$('musicRepeatSingle').textContent=text('single');$('musicRepeatList').textContent=text('list');
    $('musicRepeatMode').value=options.repeat();$('musicImportBtn').disabled=busy||!window.__TAURI__;$('musicFolderBtn').disabled=busy||!window.__TAURI__;$('musicReloadBtn').disabled=busy;
    $('musicStatus').textContent=busy?text('busy'):message;
    const list=$('musicTracks');list.textContent='';
    options.tracks().forEach(track=>{
      const row=document.createElement('div');row.className='music-row';row.dataset.id=track.id;
      if(track.id===options.selected())row.classList.add('selected');
      const info=document.createElement('div');info.className='music-info';
      const select=button(track.name,()=>{message='';options.select(track.id);refresh();});select.className='music-select';select.disabled=busy||track.available===false;select.title=track.name;
      info.appendChild(select);
      const detail=document.createElement('span');detail.className='settings-hint';
      detail.textContent=track.available===false?text('missing'):track.builtIn?text('builtin'):`${(track.bytes/1048576).toFixed(1)} MB`;
      if(track.id===options.selected())detail.textContent+=' · '+text(options.playing()?'playing':'selected');info.appendChild(detail);row.appendChild(info);
      if(!track.builtIn){
        const actions=document.createElement('div');actions.className='music-actions';
        if(editing===track.id){
          const input=document.createElement('input');input.value=track.name;input.maxLength=100;input.setAttribute('aria-label',text('rename'));input.className='music-name-input';
          actions.append(input,button(text('save'),()=>mutate('music_rename',{id:track.id,name:input.value})),button(text('cancel'),()=>{editing=null;refresh();}));
          input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();mutate('music_rename',{id:track.id,name:input.value});}});
        }else if(removing===track.id){
          const warning=document.createElement('p');warning.className='settings-hint';warning.textContent=text('question');
          actions.append(warning,button(text('confirm'),()=>mutate('music_remove',{id:track.id})),button(text('cancel'),()=>{removing=null;refresh();}));
        }else actions.append(button(text('rename'),()=>{editing=track.id;removing=null;refresh();rowFocus(track.id);}),button(text('remove'),()=>{removing=track.id;editing=null;refresh();}));
        row.appendChild(actions);
      }
      list.appendChild(row);
    });
  }
  function rowFocus(id){document.querySelector(`.music-row[data-id="${id}"] input`)?.focus();}
  async function mutate(command,args){
    if(busy)return;busy=true;message='';refresh();
    try {
      const response=await options.invoke(command,args);
      options.apply(response?.tracks||[],command==='music_import'?response?.last_id:null,command==='music_remove'?args.id:null);
      editing=null;removing=null;
      if(command==='music_import'){
        const parts=[];if(response.added)parts.push(text('added',response.added));if(response.duplicates)parts.push(text('duplicates',response.duplicates));if(response.errors?.length)parts.push(text('errors',response.errors.length)+': '+text(response.errors[0]));message=parts.join(' · ');
      }
    }catch(error){const key=String(error);message=words.zh[key]?text(key):text('failed');}
    finally{busy=false;refresh();}
  }
  async function reload(){
    if(busy)return;busy=true;refresh();
    try{if(window.__TAURI__){const response=await options.invoke('music_list');options.apply(response?.tracks||[]);}else message=text('unsupported');}
    catch(error){message=String(error)==='invalid_library'?text('invalid_library'):text('failed');}
    finally{busy=false;refresh();}
  }
  function open(){editing=null;removing=null;$('musicDialog').classList.add('visible');refresh();reload();}
  function init(settings){
    options=settings;
    ['musicOpenBtn','settingsMusicBtn'].forEach(id=>$(id)?.addEventListener('click',open));
    $('musicImportBtn').addEventListener('click',()=>mutate('music_import'));
    $('musicReloadBtn').addEventListener('click',()=>{message='';reload();});
    $('musicFolderBtn').addEventListener('click',()=>{options.invoke('music_open_folder')?.catch(()=>{message=text('failed');refresh();});});
    $('musicCloseBtn').addEventListener('click',()=>$('musicDialog').classList.remove('visible'));
    $('musicRepeatMode').addEventListener('change',()=>options.setRepeat($('musicRepeatMode').value));
    reload();
  }
  return {init,open,refresh,playbackError(){if(options){message=text('playback');refresh();}}};
})();
