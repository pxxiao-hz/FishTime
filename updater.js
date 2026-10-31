/* Explicit, user-initiated updates. No background requests or record uploads. */
window.FishTimeUpdater = (() => {
  let options, metadata = null, state = "idle", installed = false, installing = false;
  let downloaded = 0, total = 0, currentVersion = "", errorKind = "";
  const $ = id => document.getElementById(id);
  const messages = {
    zh: {title:"软件更新",check:"检查更新",checking:"正在检查更新…",latest:"当前已是最新版本。",available:"发现新版本 {version}",install:"下载并安装",downloading:"正在下载更新…",installing:"正在安装，即将重新启动…",error:"更新失败。请检查网络后重试；若安装失败，请确认 App 已移入“应用程序”，或使用手动下载。",move:"请先将 FishTime 移入“应用程序”，退出后重新打开再更新。",unsupported:"此功能仅在 FishTime 桌面 App 中可用。",close:"关闭",manual:"手动下载",notice:"仅连接 GitHub 检查版本和下载安装包，不发送计时记录。安装前会保存并暂停计时。",current:"当前版本 {version}",restart:"重新启动",installed:"更新已安装，点击重新启动。"},
    en: {title:"Software update",check:"Check for updates",checking:"Checking for updates…",latest:"You're up to date.",available:"Version {version} is available",install:"Download & install",downloading:"Downloading update…",installing:"Installing. Restarting shortly…",error:"Update failed. Check your connection and try again. For installation errors, move FishTime to Applications or download manually.",move:"Move FishTime to Applications, quit it, and reopen it before updating.",unsupported:"Updates are available in the FishTime desktop app only.",close:"Close",manual:"Download manually",notice:"Connects to GitHub for updates only. Timer records are never sent. Timers are saved and paused before installation.",current:"Current version {version}",restart:"Restart",installed:"Update installed. Restart to finish."}
  };
  const text = (key, values = {}) => {
    let value = (messages[options?.language() || "zh"] || messages.zh)[key];
    Object.entries(values).forEach(([name,replacement]) => { value=value.replace(`{${name}}`,replacement); });
    return value;
  };
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
  }
  async function check() {
    if(['checking','downloading','installing'].includes(state)||installed) return;
    metadata=null; errorKind='';
    if(!window.__TAURI__) {state='unsupported';render();return;}
    state='checking';render();
    try {metadata=await options.invoke('check_for_update');state=metadata?'available':'latest';}
    catch(error) {state='error';errorKind=String(error);}
    render();
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
    if(!['checking','downloading','installing'].includes(state)&&!installed) check();
  }
  function init(settings) {
    options=settings;
    Promise.resolve(settings.version()).then(version=>{currentVersion=version;render();});
    ['settingsCheckUpdateBtn','aboutCheckUpdateBtn'].forEach(id=>$(id)?.addEventListener('click',open));
    $('updateCheckBtn').addEventListener('click',check);
    $('updateInstallBtn').addEventListener('click',()=>{install().catch(()=>{});});
    $('updateCloseBtn').addEventListener('click',()=>{if(!installing)$('updateDialog').classList.remove('visible');});
    $('updateManualBtn').addEventListener('click',()=>{options.invoke('open_release_page')?.catch(()=>{});});
    window.__TAURI__?.event?.listen('updater:progress',event=>{
      if(state!=='downloading') return;
      downloaded=event.payload.downloaded;total=event.payload.total||0;render();
    }).catch(()=>{});
    render();
  }
  return {init,open,refresh:render,get installing(){return installing;}};
})();
