/* Optional continuous-work reminder. Stored locally; disabled by default. */
window.FishTimeRestReminder=(()=>{
  const KEY='fishtime-rest-reminder';let options,token=null,error='';
  let preferences={enabled:false,minutes:180};
  const $=id=>document.getElementById(id);
  function normalize(value){return {enabled:value?.enabled===true,minutes:Number.isInteger(value?.minutes)&&value.minutes>=1&&value.minutes<=1440?value.minutes:180};}
  try{preferences=normalize(JSON.parse(localStorage.getItem(KEY)||'null'));}catch{}
  const words={zh:{title:'该休息一下了',enabled:'连续计时提醒',minutes:'提醒间隔（分钟）',hint:'默认关闭，默认间隔 180 分钟，可设置 1–1440 分钟。按当前分区的连续计时计算，暂停后重新计算；开启后到时会打开 FishTime 提示。',message:'已连续计时 {duration}。请检查是否忘记结束计时，或暂停休息一下。',pause:'暂停休息',finish:'结束并保存',later:'10 分钟后提醒',invalid:'请输入 1–1440 的整数分钟。',failed:'无法保存提醒状态，请检查本地存储后重试。'},en:{title:'Time for a break',enabled:'Continuous-work reminder',minutes:'Reminder interval (minutes)',hint:'Off by default. Default: 180 minutes; range: 1–1440. Applies to continuous timing in the current workspace. Pausing resets it. FishTime opens a reminder when due.',message:'You have been timing continuously for {duration}. Check whether the timer was left running, or pause for a break.',pause:'Pause for a break',finish:'Finish & save',later:'Remind in 10 minutes',invalid:'Enter a whole number from 1 to 1440 minutes.',failed:'Cannot save the reminder state. Check local storage and try again.'}};
  function text(key,values={}){let value=(words[options?.language()||'zh']||words.zh)[key];Object.entries(values).forEach(([name,replacement])=>{value=value.replace(`{${name}}`,replacement);});return value;}
  function started(active){if(active?.state!=='running')return null;const last=active.segments?.[active.segments.length-1];const raw=last&&!last.end?last.start:!active.segments?active.start:null;const ms=new Date(raw||'').getTime();return Number.isFinite(ms)?ms:null;}
  function close(){token=null;$('restReminderDialog')?.classList.remove('visible');}
  function sync(){const result=options?.sync();if(result)result.catch(()=>{});}
  function render(){if(!options)return;
    $('restReminderEnabled').checked=preferences.enabled;$('restReminderMinutes').value=preferences.minutes;
    $('restReminderLabel').textContent=text('enabled');$('restReminderMinutesLabel').textContent=text('minutes');$('restReminderHint').textContent=text('hint');$('restReminderError').textContent=error?text(error):'';
    $('restReminderTitle').textContent=text('title');$('restReminderPause').textContent=text('pause');$('restReminderFinish').textContent=text('finish');$('restReminderLater').textContent=text('later');
    if(token)$('restReminderMessage').textContent=text('message',{duration:options.duration(Math.max(0,Date.now()-token.started_ms))});
  }
  function restore(value){preferences=normalize(value);try{localStorage.setItem(KEY,JSON.stringify(preferences));error='';}catch{error='failed';}if(!preferences.enabled)close();render();sync();}
  function snapshot(active){const start=started(active);if(token&&(start!==token.started_ms||options?.workspace()!==token.workspace))close();
    const saved=active?.restReminder;const next=saved?.startedMs===start&&Number.isFinite(saved?.nextAtMs)&&saved.nextAtMs<=Date.now()+86400000?saved.nextAtMs:null;
    return {enabled:preferences.enabled,after_ms:preferences.minutes*60000,next_at_ms:next,presented:!!token&&!!$('restReminderDialog')?.classList.contains('visible')};
  }
  function matching(){const active=options.session();return token&&token.workspace===options.workspace()&&started(active)===token.started_ms?active:null;}
  function defer(){const active=matching();if(active){try{options.save({...active,restReminder:{startedMs:token.started_ms,nextAtMs:Date.now()+600000}});}catch{error='failed';render();return;}}close();sync();}
  function show(event){
    if(!preferences.enabled||!options||window.FishTimeUpdater?.installing)return;
    const active=options.session(),start=started(active);
    if(event.workspace!==options.workspace()||event.started_ms!==start||start===null||Date.now()-start<preferences.minutes*60000){sync();return;}
    if(active.restReminder?.startedMs===start&&active.restReminder.nextAtMs>Date.now()){sync();return;}
    if(token&&$('restReminderDialog').classList.contains('visible'))return;
    token={workspace:event.workspace,started_ms:start};
    $('restReminderDialog').classList.add('visible');
    try{options.save({...active,restReminder:{startedMs:start,nextAtMs:Date.now()+600000}});}catch{error='failed';}
    render();sync();options.invoke('show_reminder_window')?.catch(()=>{});
  }
  function init(settings){options=settings;
    $('restReminderEnabled').addEventListener('change',()=>restore({...preferences,enabled:$('restReminderEnabled').checked}));
    $('restReminderMinutes').addEventListener('change',()=>{const minutes=Number($('restReminderMinutes').value);if(!Number.isInteger(minutes)||minutes<1||minutes>1440){error='invalid';render();return;}restore({...preferences,minutes});});
    $('restReminderLater').addEventListener('click',defer);
    $('restReminderPause').addEventListener('click',()=>{const active=matching();close();if(active)options.pause();sync();});
    $('restReminderFinish').addEventListener('click',()=>{const active=matching();close();if(active)options.finish();sync();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&token&&!window.FishTimeUpdater?.installing)defer();});
    window.__TAURI__?.event?.listen('timer:rest-reminder',event=>show(event.payload)).catch(()=>{});
    window.__TAURI__?.event?.listen('timer:rest-dismissed',()=>{if(token)defer();}).catch(()=>{});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&token)defer();});
    render();sync();
  }
  return {init,refresh:render,snapshot,restore,get preferences(){return {...preferences};}};
})();
