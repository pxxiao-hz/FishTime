/* Manual and opt-out automatic checks. Never download or install without a click. */
window.FishTimeUpdater = (() => {
  let options, metadata = null, state = "idle", installed = false, installing = false;
  let downloaded = 0, total = 0, currentVersion = "", errorKind = "";
  const PREFERENCE_KEY='fishtime-update-preferences', DAY=24*60*60*1000, RETRY=60*60*1000;
  let startupDone=false, interactiveCheck=false, lastBadge;
  function readPreferences(){
    const defaults={enabled:true,skippedVersion:'',snoozedVersion:'',snoozeUntil:0,availableVersion:'',lastCheckedAt:0,lastAttemptAt:0};
    try{
      const saved=JSON.parse(localStorage.getItem(PREFERENCE_KEY)||'null');
      if(!saved||typeof saved!=='object')return defaults;
      const result={...defaults,enabled:saved.enabled!==false};
      ['skippedVersion','snoozedVersion','availableVersion'].forEach(key=>{if(typeof saved[key]==='string'&&saved[key].length<=64)result[key]=saved[key];});
      ['snoozeUntil','lastCheckedAt','lastAttemptAt'].forEach(key=>{if(Number.isFinite(saved[key])&&saved[key]>=0)result[key]=saved[key];});
      return result;
    }catch{return defaults;}
  }
  const preferences=readPreferences();
  function savePreferences(){try{localStorage.setItem(PREFERENCE_KEY,JSON.stringify(preferences));}catch{/* Keep the setting in memory if storage is unavailable. */}}
  function newerThan(version,current){
    const parse=value=>/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value||'');
    const a=parse(version),b=parse(current);if(!a||!b)return false;
    for(let i=1;i<=3;i+=1){if(Number(a[i])!==Number(b[i]))return Number(a[i])>Number(b[i]);}
    if(!a[4]||!b[4])return !a[4]&&!!b[4];
    const left=a[4].split('.'),right=b[4].split('.');
    for(let i=0;i<Math.max(left.length,right.length);i+=1){
      if(left[i]===undefined)return false;if(right[i]===undefined)return true;
      if(left[i]===right[i])continue;
      const numericA=/^\d+$/.test(left[i]),numericB=/^\d+$/.test(right[i]);
      return numericA&&numericB?Number(left[i])>Number(right[i]):numericA!==numericB?!numericA:left[i]>right[i];
    }
    return false;
  }
  const $ = id => document.getElementById(id);
  const messages = {
    zh: {title:"软件更新",check:"检查更新",checking:"正在检查更新…",latest:"当前已是最新版本。",available:"发现新版本 {version}",install:"下载并安装",downloading:"正在下载更新…",installing:"正在安装，即将重新启动…",error:"更新失败。请检查网络后重试；若安装失败，请确认 App 已移入“应用程序”，或使用手动下载。",move:"请先将 FishTime 移入“应用程序”，退出后重新打开再更新。",unsupported:"此功能仅在 FishTime 桌面 App 中可用。",close:"关闭",manual:"手动下载",notice:"仅连接 GitHub 检查版本和下载安装包，不发送计时记录。安装前会保存并暂停计时。",current:"当前版本 {version}",restart:"重新启动",installed:"更新已安装，点击重新启动。"},
    en: {title:"Software update",check:"Check for updates",checking:"Checking for updates…",latest:"You're up to date.",available:"Version {version} is available",install:"Download & install",downloading:"Downloading update…",installing:"Installing. Restarting shortly…",error:"Update failed. Check your connection and try again. For installation errors, move FishTime to Applications or download manually.",move:"Move FishTime to Applications, quit it, and reopen it before updating.",unsupported:"Updates are available in the FishTime desktop app only.",close:"Close",manual:"Download manually",notice:"Connects to GitHub for updates only. Timer records are never sent. Timers are saved and paused before installation.",current:"Current version {version}",restart:"Restart",installed:"Update installed. Restart to finish."}
  };
  Object.assign(messages.zh,{auto:'自动检查更新',autoHint:'启动后检查，持续运行时每 24 小时检查；不会自动下载安装。',view:'查看更新',later:'24 小时后提醒',skip:'跳过此版本',restore:'恢复此版本提示',skipped:'已跳过版本 {version}',lastChecked:'上次检查：{time}',newVersion:'发现新版本 {version}',badge:'有新版本'});
  Object.assign(messages.en,{auto:'Automatically check for updates',autoHint:'Check after launch and every 24 hours while running. Never downloads or installs automatically.',view:'View update',later:'Remind me in 24 hours',skip:'Skip this version',restore:'Restore reminders',skipped:'Skipped version {version}',lastChecked:'Last checked: {time}',newVersion:'Version {version} is available',badge:'Update available'});
  const text = (key, values = {}) => {
    let value = (messages[options?.language() || "zh"] || messages.zh)[key];
    Object.entries(values).forEach(([name,replacement]) => { value=value.replace(`{${name}}`,replacement); });
    return value;
  };
  function reminderVersion(){
    const version=preferences.availableVersion;
    return preferences.enabled&&newerThan(version,currentVersion)&&version!==preferences.skippedVersion
      &&!(version===preferences.snoozedVersion&&preferences.snoozeUntil>Date.now())?version:null;
  }
  function renderReminder(){
    if(!options)return;
    const version=reminderVersion(),banner=$('updateBanner');
    if(banner)banner.hidden=!version||installed||['downloading','installing'].includes(state);
    const label=$('updateBannerText'),value=version?text('newVersion',{version}):'';
    if(label&&label.textContent!==value)label.textContent=value;
    [['updateBannerViewBtn','view'],['updateBannerLaterBtn','later'],['updateBannerSkipBtn','skip'],['updateLaterBtn','later'],['updateSkipBtn','skip'],['updateAutoLabel','auto'],['updateAutoHint','autoHint'],['updateRestoreBtn','restore']].forEach(([id,key])=>{if($(id))$(id).textContent=text(key);});
    if($('updateAutoEnabled'))$('updateAutoEnabled').checked=preferences.enabled;
    if($('settingsUpdateBadge')){$('settingsUpdateBadge').hidden=!version;$('settingsUpdateBadge').textContent=text('badge');}
    const skipped=newerThan(preferences.skippedVersion,currentVersion);
    if($('updateSkippedRow'))$('updateSkippedRow').hidden=!skipped;
    if($('updateSkippedText'))$('updateSkippedText').textContent=text('skipped',{version:preferences.skippedVersion});
    if($('updateLastChecked'))$('updateLastChecked').textContent=preferences.lastCheckedAt?text('lastChecked',{time:new Date(preferences.lastCheckedAt).toLocaleString(options.language()==='en'?'en-US':'zh-CN')}):'';
    const badge=installed?null:version;
    if(window.__TAURI__&&lastBadge!==badge){lastBadge=badge;Promise.resolve(options.invoke('set_update_badge',{version:badge})).catch(()=>{lastBadge=undefined;});}
  }
  function render() {
    if (!$('updateDialog')) return;
    $('updateTitle').textContent=text('title');
    $('updateCurrentVersion').textContent=text('current',{version:currentVersion});
    $('updateNotice').textContent=text('notice');
    $('updateCloseBtn').textContent=text('close'); $('updateManualBtn').textContent=text('manual');
    $('updateCheckBtn').textContent=text('check');
    $('updateInstallBtn').textContent=text(installed?'restart':'install');
    $('updateInstallBtn').hidden=!(state==='available'||installed);
    $('updateCheckBtn').disabled=['checking','downloading','installing'].includes(state)||installed;
    $('updateCloseBtn').disabled=installing;
    $('updateManualBtn').disabled=installing;
    $('updateDialog').dataset.lockClose=String(installing);
    $('updateNotes').textContent=metadata?.notes || '';
    const statusKey=state==='available'?'available':state==='error'?(errorKind==='move_to_applications'?'move':'error'):state;
    $('updateStatus').textContent=messages.zh[statusKey]?text(statusKey,{version:metadata?.version || ''}):'';
    const progress=$('updateProgress'); progress.hidden=state!=='downloading';
    if(total>0) {progress.max=total;progress.value=downloaded;}
    else progress.removeAttribute('value');
    $('updateProgressText').textContent=state==='downloading'&&downloaded ? (total>0?`${Math.min(100,Math.floor(downloaded/total*100))}%`:`${(downloaded/1048576).toFixed(1)} MB`) : '';
    if($('updateLaterBtn'))$('updateLaterBtn').hidden=state!=='available';
    if($('updateSkipBtn'))$('updateSkipBtn').hidden=state!=='available';
    renderReminder();
  }
  async function check(automatic=false) {
    if(state==='checking'){if(!automatic)interactiveCheck=true;return;}
    if(['downloading','installing'].includes(state)||installed) return;
    if(automatic&&!preferences.enabled)return;
    interactiveCheck=!automatic;
    const previousMetadata=metadata,previousState=state;
    if(!window.__TAURI__) {if(!automatic){state='unsupported';render();}return;}
    if(!automatic)metadata=null;errorKind='';
    preferences.lastAttemptAt=Date.now();savePreferences();
    state='checking';render();
    try {
      metadata=await options.invoke('check_for_update');state=metadata?'available':'latest';
      preferences.lastCheckedAt=Date.now();preferences.availableVersion=metadata?.version||'';
      savePreferences();
    }catch(error){
      if(interactiveCheck){metadata=null;state='error';errorKind=String(error);}
      else{metadata=previousMetadata;state=previousState;}
    }
    render();
  }
  function automaticTick(startup=false){
    renderReminder();
    if(!preferences.enabled||!currentVersion||!window.__TAURI__||installed||['checking','downloading','installing'].includes(state))return;
    if($('updateDialog')?.classList.contains('visible'))return;
    const now=Date.now(),first=startup||!startupDone;startupDone=true;
    const due=first||!preferences.lastCheckedAt||now-preferences.lastCheckedAt>=DAY||preferences.lastCheckedAt>now;
    const retryAllowed=!preferences.lastAttemptAt||now-preferences.lastAttemptAt>=RETRY||preferences.lastAttemptAt>now;
    if(due&&retryAllowed)check(true);
  }
  function dismiss(kind){
    const version=metadata?.version||preferences.availableVersion;if(!version)return;
    if(kind==='skip')preferences.skippedVersion=version;
    else{preferences.snoozedVersion=version;preferences.snoozeUntil=Date.now()+DAY;}
    savePreferences();$('updateDialog').classList.remove('visible');render();
  }
  function setAutomaticEnabled(enabled,checkNow=false){
    preferences.enabled=enabled===true;savePreferences();render();
    if(preferences.enabled&&checkNow)check(true);
  }
  async function install() {
    if(installed) {await options.invoke('restart_after_update');return;}
    if(state!=='available') return;
    state='downloading';downloaded=0;total=0;render();
    try {
      await options.invoke('download_update');
      installing=true;state='installing';render();
      options.pause();
      await options.invoke('install_update');
      installed=true;state='installed';installing=false;render();
      await options.invoke('restart_after_update');
    } catch(error) {installing=false;state=installed?'installed':'error';errorKind=String(error);render();}
  }
  function open() {
    $('updateDialog').classList.add('visible');
    render();
    check(false);
  }
  function init(settings) {
    options=settings;
    Promise.resolve(settings.version()).then(version=>{currentVersion=version;render();window.setTimeout?.(()=>automaticTick(true),8000);});
    ['settingsCheckUpdateBtn','aboutCheckUpdateBtn'].forEach(id=>$(id)?.addEventListener('click',open));
    $('updateCheckBtn').addEventListener('click',()=>check(false));
    $('updateBannerViewBtn')?.addEventListener('click',open);
    ['updateBannerLaterBtn','updateLaterBtn'].forEach(id=>$(id)?.addEventListener('click',()=>dismiss('later')));
    ['updateBannerSkipBtn','updateSkipBtn'].forEach(id=>$(id)?.addEventListener('click',()=>dismiss('skip')));
    $('updateAutoEnabled')?.addEventListener('change',()=>setAutomaticEnabled($('updateAutoEnabled').checked,true));
    $('updateRestoreBtn')?.addEventListener('click',()=>{preferences.skippedVersion='';savePreferences();render();});
    $('updateInstallBtn').addEventListener('click',()=>{install().catch(()=>{});});
    $('updateCloseBtn').addEventListener('click',()=>{if(!installing)$('updateDialog').classList.remove('visible');});
    $('updateManualBtn').addEventListener('click',()=>{options.invoke('open_release_page')?.catch(()=>{});});
    window.__TAURI__?.event?.listen('updater:progress',event=>{
      if(state!=='downloading') return;
      downloaded=event.payload.downloaded;total=event.payload.total||0;render();
    }).catch(()=>{});
    window.__TAURI__?.event?.listen('updater:tick',()=>automaticTick()).catch(()=>{});
    window.addEventListener?.('focus',()=>automaticTick());
    document.addEventListener?.('visibilitychange',()=>{if(!document.hidden)automaticTick();});
    render();
  }
  return {init,open,refresh:render,setAutomaticEnabled,get automaticEnabled(){return preferences.enabled;},get installing(){return installing;}};
})();
