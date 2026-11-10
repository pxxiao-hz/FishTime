// Optional browser QA: install Playwright and Chrome, then run npm run test:ui.
// Uses a fresh browser profile and synthetic records only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = process.env.FISHTIME_SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'fishtime-ui-'));
  const allowed = new Set(['index.html', 'main.js', 'updater.js', 'music-library.js', 'rest-reminder.js', 'style.css', 'assets/bgm/track1.mp3']);
  const wave=Buffer.alloc(44+22050*10*2);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(22050,24);wave.writeUInt32LE(44100,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(wave.length-44,40);
  const server = http.createServer((request, response) => {
    const file = request.url.split('?')[0].slice(1) || 'index.html';
    if(file==='test-tone.wav'){response.setHeader('Content-Type','audio/wav');response.end(wave);return;}
    if (!allowed.has(file)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.mp3') ? 'audio/mpeg' : 'text/html');
    response.end(fs.readFileSync(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, timezoneId: 'Asia/Shanghai' });
    const page = await context.newPage();
    await page.clock.install({time:new Date('2026-10-31T10:00:00+08:00')});
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.locator('#timerDisplay').textContent(), '00:00:00');
    assert.equal(await page.locator('#pauseBtn').isVisible(), false);
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => document.querySelector('#timerDisplay').textContent !== '00:00:00');
    await page.locator('#pauseBtn').click();
    const paused = await page.locator('#timerDisplay').textContent();
    await page.reload();
    assert.equal(await page.locator('#timerDisplay').textContent(), paused);
    await page.locator('#startBtn').click();
    await page.locator('#stopBtn').click();
    assert.equal(await page.locator('#todayRecordsBody .row-menu').count(), 1);
    console.log('PASS: start, pause, reload, resume, finish');

    const dates = await page.evaluate(() => {
      const key = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      const today = new Date(); const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
      const row = (id, date, hour, minutes, tag, note) => {
        const start = new Date(date.getFullYear(),date.getMonth(),date.getDate(),hour);
        const end = new Date(start.getTime()+minutes*60000);
        return {id,date:key(date),startTime:start.toISOString(),endTime:end.toISOString(),startTimeText:`${String(hour).padStart(2,'0')}:00:00`,endTimeText:`${String(end.getHours()).padStart(2,'0')}:${String(end.getMinutes()).padStart(2,'0')}:00`,durationMs:minutes*60000,tag,note};
      };
      localStorage.setItem('workTimerRecordsV1:default',JSON.stringify([
        row('sample-a',today,9,45,'阅读','梳理论文思路'), row('sample-b',today,11,90,'开发','完善项目界面'),row('sample-c',yesterday,10,60,'阅读','整理阅读笔记')
      ]));
      return {today:key(today),yesterday:key(yesterday)};
    });
    await page.reload();
    await page.screenshot({path:path.join(output,'today-light.png'),fullPage:true});
    await page.locator('#pageRecordsBtn').click();
    assert.equal(await page.locator('#filterDateBody .row-menu').count(),3);
    await page.locator('#recordSearch').fill('论文');
    assert.equal(await page.locator('#filterDateBody .row-menu').count(),1);
    await page.locator('#resetRecordFilters').click();
    await page.locator('#filterDate').fill(dates.yesterday);
    assert.equal(await page.locator('#filterDateBody .row-menu').count(),1);
    await page.locator('#filterDateBody summary').click();
    await page.locator('#filterDateBody .record-edit').click();
    await page.locator('#editNoteInput').fill('已修订的阅读笔记');
    await page.locator('#editSaveBtn').click();
    assert.ok((await page.locator('#filterDateBody').textContent()).includes('已修订'));
    await page.locator('#resetRecordFilters').click();
    await page.locator('#recordTagFilter').selectOption('开发');
    assert.equal(await page.locator('#filterDateBody .row-menu').count(),1);
    await page.locator('#resetRecordFilters').click();
    await page.screenshot({path:path.join(output,'records-light.png'),fullPage:true});
    console.log('PASS: full history, date/tag/search filters, edit yesterday');

    await page.locator('#pageStatsBtn').click();
    const before = await page.locator('#forecastTotal').textContent();
    assert.equal(await page.locator('#statsTotal').textContent(), '3 小时 15 分钟');
    await page.screenshot({path:path.join(output,'insights-light.png'),fullPage:true});
    await page.locator('#pageRecordsBtn').click();
    await page.locator('#filterDate').fill(dates.yesterday);
    await page.locator('#filterDateBody summary').click();
    await page.locator('#filterDateBody .record-delete').click();
    assert.ok((await page.locator('#deleteDialogMessage').textContent()).includes(dates.yesterday));
    await page.locator('#deleteCancelBtn').click();
    assert.equal(await page.locator('#filterDateBody .row-menu').count(),1);
    await page.locator('#filterDateBody summary').click();
    await page.locator('#filterDateBody .record-delete').click();
    await page.locator('#deleteConfirmBtn').click();
    assert.equal(await page.locator('#filterDateBody .row-menu').count(),0);
    await page.locator('#pageStatsBtn').click();
    assert.notEqual(await page.locator('#forecastTotal').textContent(),before);
    await page.locator('#forecastRefreshBtn').click();
    await page.reload();
    assert.equal(await page.locator('#statsTotal').textContent(),'2 小时 15 分钟');
    console.log('PASS: delete/cancel, forecast refresh, persisted statistics');

    await page.locator('#pageRecordsBtn').click();
    await page.locator('[data-record-view="calendar"]').click();
    await page.locator(`.calendar-cell[data-date="${dates.today}"]`).click();
    assert.equal(await page.locator('#calendarDateBody .row-menu').count(),2);
    await page.locator('#settingsBtn').click();
    await page.locator('[data-theme-option="mode-dark"]').click();
    await page.locator('#settingsCloseBtn').click();
    assert.equal(await page.locator('body.mode-dark').count(),1);
    await page.screenshot({path:path.join(output,'calendar-dark.png'),fullPage:true});
    await page.locator('#settingsBtn').click();
    await page.locator('[data-lang-option="en"]').click();
    await page.screenshot({path:path.join(output,'settings-dark-en.png'),fullPage:true});
    const downloaded = page.waitForEvent('download');
    await page.locator('#exportDataBtn').click();
    const download = await downloaded;
    const backup = JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(backup.format,'fishtime-backup'); assert.equal(backup.workspaceData.default.records.length,2);
    assert.equal(backup.preferences.theme,'mode-dark');
    assert.equal(JSON.stringify(backup).includes('apiKey'),false);
    // Round-trip a complete v4-compatible backup, then a legacy Electron backup.
    await page.locator('#importFileInput').setInputFiles({name:'fishtime-full.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('workTimerRecordsV1:default')).length===2);
    const legacy={records:[{...backup.records[0],id:12345}],activeSession:null};
    await page.locator('#importFileInput').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('workTimerRecordsV1:default')).length===1);
    await page.locator('#importFileInput').setInputFiles({name:'fishtime-full.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('workTimerRecordsV1:default')).length===2);
    await page.locator('[data-theme-option="mode-system"]').click();
    await page.locator('[data-lang-option="zh"]').click();
    await page.locator('#settingsCloseBtn').click();
    await page.emulateMedia({colorScheme:'dark'}); await page.waitForSelector('body.mode-dark');
    await page.emulateMedia({colorScheme:'light'}); await page.waitForSelector('body.mode-default');
    await page.locator('#pageHomeBtn').click();
    await page.setViewportSize({width:720,height:560});
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    assert.equal(await page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().width),76);
    assert.equal(await page.locator('#startBtn').isVisible(),true);
    await page.screenshot({path:path.join(output,'today-compact.png'),fullPage:true});
    console.log('PASS: calendar, themes, language, backup export, compact layout');
    await page.locator('#settingsBtn').click();
    await page.locator('#settingsCheckUpdateBtn').click();
    await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('桌面'));
    await page.locator('#updateCloseBtn').click();
    const updateContext=await browser.newContext({viewport:{width:1000,height:700}});
    await updateContext.addInitScript(()=>{
      window.__mockEvents={};window.__mockFail=true;
      window.__TAURI__={core:{invoke:async(command)=>{
        if(command==='app_version')return '5.1.0';
        if(command==='load_api_key')return '';
        if(command==='check_for_update')return {version:'5.2.0',currentVersion:'5.1.0',notes:'测试更新说明'};
        if(command==='download_update'){window.__mockEvents['updater:progress']?.({payload:{downloaded:50,total:100}});return;}
        if(command==='install_update')throw new Error('move_to_applications');
      }},event:{listen:async(name,callback)=>{window.__mockEvents[name]=callback;}}};
    });
    const updatePage=await updateContext.newPage();
    updatePage.on('pageerror',error=>errors.push(String(error)));
    await updatePage.goto(`http://127.0.0.1:${server.address().port}`);
    await updatePage.locator('#startBtn').click();
    await updatePage.locator('#noteInput').fill('更新前未完成的备注');
    await updatePage.evaluate(()=>window.__mockEvents['app:check-update']({}));
    await updatePage.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('5.2.0'));
    await updatePage.screenshot({path:path.join(output,'update-available.png')});
    await updatePage.locator('#updateInstallBtn').click();
    await updatePage.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('应用程序'));
    await updatePage.reload();
    assert.equal(await updatePage.locator('#noteInput').inputValue(),'更新前未完成的备注');
    assert.equal(await updatePage.locator('body').getAttribute('data-timer-state'),'paused');
    await updateContext.close();
    console.log('PASS: update entry points, native update flow simulation, install error, paused session and draft recovery');
    const musicContext=await browser.newContext({viewport:{width:720,height:560}});
    await musicContext.addInitScript(()=>{
      window.__TAURI__={core:{convertFileSrc:()=>location.origin+'/test-tone.wav',invoke:async(command,args)=>{
        if(command==='app_version')return '5.2.0';if(command==='load_api_key')return '';
        let tracks=JSON.parse(localStorage.getItem('test-music-library')||'[]');let added=0,duplicates=0,last_id=null;
        if(command==='music_import'){
          if(window.__musicError)throw window.__musicError;
          const id='track-'+'a'.repeat(64);if(tracks.length)duplicates=1;else {tracks.push({id,name:'测试曲目',bytes:441044,path:'/test/music/track.wav',available:true});added=1;}last_id=id;
        }
        if(command==='music_rename')tracks.find(track=>track.id===args.id).name=args.name;
        if(command==='music_remove')tracks=tracks.filter(track=>track.id!==args.id);
        if(command.startsWith('music_')){localStorage.setItem('test-music-library',JSON.stringify(tracks));return {tracks,added,duplicates,last_id,errors:[]};}
      }},event:{listen:async()=>{}}};
    });
    const musicPage=await musicContext.newPage();musicPage.on('pageerror',error=>errors.push(String(error)));
    await musicPage.goto(`http://127.0.0.1:${server.address().port}`);
    await musicPage.locator('#musicOpenBtn').click();await musicPage.locator('#musicImportBtn').click();
    await musicPage.waitForSelector('.music-row[data-id^="track-"]');
    await musicPage.locator('.music-row[data-id^="track-"] .music-select').click();
    await musicPage.waitForFunction(()=>!document.querySelector('#bgmPlayer').paused&&document.querySelector('#bgmPlayer').readyState>=2);
    await musicPage.reload();await musicPage.locator('#musicOpenBtn').click();
    await musicPage.waitForSelector('.music-row.selected[data-id^="track-"]');
    assert.equal(await musicPage.locator('#bgmPlayer').evaluate(audio=>audio.paused),true);
    await musicPage.locator('.music-row[data-id^="track-"] button', {hasText:'重命名'}).click();
    await musicPage.locator('.music-name-input').fill('我的专注音乐');
    await musicPage.locator('.music-actions button',{hasText:'保存'}).click();
    await musicPage.waitForFunction(()=>document.querySelector('.music-row[data-id^="track-"] .music-select').textContent==='我的专注音乐');
    await musicPage.locator('#musicImportBtn').click();
    await musicPage.waitForFunction(()=>document.querySelector('#musicStatus').textContent.includes('重复'));
    assert.equal(await musicPage.locator('.music-row[data-id^="track-"]').count(),1);
    await musicPage.locator('#musicRepeatMode').selectOption('list');
    assert.equal(await musicPage.locator('#bgmPlayer').evaluate(audio=>audio.loop),false);
    await musicPage.screenshot({path:path.join(output,'music-library.png')});
    await musicPage.reload();await musicPage.locator('#musicOpenBtn').click();
    await musicPage.waitForSelector('.music-row.selected[data-id^="track-"]');
    assert.equal(await musicPage.locator('#musicRepeatMode').inputValue(),'list');
    await musicPage.locator('#bgmPlayer').evaluate(audio=>audio.dispatchEvent(new Event('ended')));
    await musicPage.waitForSelector('.music-row.selected[data-id="builtin-1"]');
    await musicPage.locator('.music-row[data-id^="track-"] button',{hasText:'移除',exact:true}).click();
    await musicPage.locator('.music-actions button',{hasText:'取消'}).click();
    assert.equal(await musicPage.locator('.music-row[data-id^="track-"]').count(),1);
    await musicPage.locator('.music-row[data-id^="track-"] button',{hasText:'移除',exact:true}).click();
    await musicPage.locator('.music-actions button',{hasText:'确认移除副本'}).click();
    await musicPage.waitForFunction(()=>!document.querySelector('.music-row[data-id^="track-"]'));
    assert.equal(await musicPage.evaluate(()=>localStorage.getItem('fishtime-bgm').includes('/test/music')),false);
    await musicPage.evaluate(()=>{window.__musicError='invalid_size';});await musicPage.locator('#musicImportBtn').click();
    await musicPage.waitForFunction(()=>document.querySelector('#musicStatus').textContent.includes('200 MB'));
    await musicContext.close();
    console.log('PASS: music import, real WAV playback, selection/rename/repeat persistence, duplicate feedback, remove confirmation, import error');
    const reminderContext=await browser.newContext({viewport:{width:1000,height:700}});
    await reminderContext.addInitScript(()=>{
      window.__autoEvents={};window.__checkCount=0;window.__downloadCount=0;
      window.__TAURI__={core:{invoke:async(command,args)=>{
        if(command==='app_version')return '5.3.0';if(command==='load_api_key')return '';
        if(command==='music_list')return {tracks:[]};
        if(command==='set_update_badge'){window.__badge=args.version;return;}
        if(command==='check_for_update'){window.__checkCount+=1;return {version:'5.4.0',currentVersion:'5.3.0',notes:'合成测试版本，用于验证自动提醒。'};}
        if(command==='download_update')window.__downloadCount+=1;
      }},event:{listen:async(name,callback)=>{window.__autoEvents[name]=callback;}}};
    });
    const reminderPage=await reminderContext.newPage();reminderPage.on('pageerror',error=>errors.push(String(error)));
    await reminderPage.clock.install({time:new Date('2026-11-04T10:00:00+08:00')});
    await reminderPage.goto(`http://127.0.0.1:${server.address().port}`);
    await reminderPage.waitForFunction(()=>document.querySelector('#updateCurrentVersion').textContent.includes('5.3.0'));
    await reminderPage.clock.fastForward(8100);
    await reminderPage.waitForSelector('#updateBanner:visible');
    assert.equal(await reminderPage.locator('#updateDialog').isVisible(),false);
    assert.equal(await reminderPage.evaluate(()=>window.__badge),'5.4.0');
    await reminderPage.screenshot({path:path.join(output,'auto-update-banner.png')});
    await reminderPage.locator('#updateBannerLaterBtn').click();assert.equal(await reminderPage.locator('#updateBanner').isVisible(),false);
    await reminderPage.clock.fastForward(24*60*60*1000);
    await reminderPage.evaluate(()=>window.__autoEvents['updater:tick']({}));
    await reminderPage.waitForSelector('#updateBanner:visible');
    await reminderPage.locator('#updateBannerSkipBtn').click();assert.equal(await reminderPage.locator('#updateBanner').isVisible(),false);
    await reminderPage.reload();await reminderPage.waitForFunction(()=>document.querySelector('#updateCurrentVersion').textContent.includes('5.3.0'));
    await reminderPage.clock.fastForward(8100);assert.equal(await reminderPage.locator('#updateBanner').isVisible(),false);
    await reminderPage.locator('#settingsBtn').click();await reminderPage.locator('#settingsCheckUpdateBtn').click();
    await reminderPage.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('5.4.0'));
    assert.equal(await reminderPage.locator('#updateInstallBtn').isVisible(),true);
    await reminderPage.locator('#updateCloseBtn').click();await reminderPage.locator('#updateRestoreBtn').click();
    assert.equal(await reminderPage.locator('#updateBanner').isVisible(),true);
    await reminderPage.locator('#updateAutoEnabled').uncheck();await reminderPage.locator('#settingsCloseBtn').click();
    const checks=await reminderPage.evaluate(()=>window.__checkCount);
    await reminderPage.clock.fastForward(48*60*60*1000);await reminderPage.evaluate(()=>window.__autoEvents['updater:tick']({}));
    assert.equal(await reminderPage.evaluate(()=>window.__checkCount),checks);assert.equal(await reminderPage.evaluate(()=>window.__downloadCount),0);
    await reminderPage.reload();await reminderPage.waitForFunction(()=>document.querySelector('#updateCurrentVersion').textContent.includes('5.3.0'));
    await reminderPage.clock.fastForward(8100);assert.equal(await reminderPage.locator('#updateAutoEnabled').isChecked(),false);
    assert.equal(await reminderPage.evaluate(()=>window.__checkCount),0);
    await reminderContext.close();
    console.log('PASS: automatic reminder, native badge request, 24-hour snooze, persistent skip/restore/opt-out, manual override, no automatic download');
    const restContext=await browser.newContext({viewport:{width:1000,height:700}});
    await restContext.addInitScript(()=>{
      window.__restEvents={};window.__raised=0;
      window.__TAURI__={core:{invoke:async(command)=>{
        if(command==='app_version')return '5.5.0';if(command==='load_api_key')return '';if(command==='music_list')return {tracks:[]};
        if(command==='show_reminder_window'){window.__raised+=1;return;}
      }},event:{listen:async(name,callback)=>{window.__restEvents[name]=callback;}}};
    });
    const restPage=await restContext.newPage();let alerts=0;restPage.on('dialog',dialog=>{alerts+=1;dialog.dismiss();});restPage.on('pageerror',error=>errors.push(String(error)));
    await restPage.clock.install({time:new Date('2026-11-10T10:00:00+08:00')});await restPage.goto(`http://127.0.0.1:${server.address().port}`);
    await restPage.waitForFunction(()=>!!window.__restEvents['timer:rest-reminder']);
    await restPage.locator('#startBtn').click();await restPage.clock.fastForward(4*3600000+1000);
    const signal=()=>restPage.evaluate(()=>{const active=JSON.parse(localStorage.getItem('workTimerActiveSessionV1:default'));window.__restEvents['timer:rest-reminder']({payload:{workspace:'default',started_ms:Date.parse(active.segments.at(-1).start)}});});
    await signal();assert.equal(await restPage.locator('#restReminderDialog').isVisible(),false);assert.equal(alerts,0);assert.equal(await restPage.evaluate(()=>window.__raised),0);
    await restPage.locator('#stopBtn').click();await restPage.locator('#settingsBtn').click();
    assert.equal(await restPage.locator('#restReminderEnabled').isChecked(),false);
    await restPage.locator('#restReminderMinutes').fill('1');await restPage.locator('#restReminderMinutes').press('Tab');await restPage.locator('#restReminderEnabled').check();
    await restPage.locator('#settingsCloseBtn').click();await restPage.locator('#startBtn').click();await restPage.clock.fastForward(61000);await signal();
    await restPage.waitForSelector('#restReminderDialog:visible');await restPage.screenshot({path:path.join(output,'rest-reminder.png')});
    await restPage.locator('#restReminderPause').click();assert.equal(await restPage.locator('body').getAttribute('data-timer-state'),'paused');
    await restPage.reload();await restPage.waitForFunction(()=>!!window.__restEvents['timer:rest-reminder']);
    assert.equal(await restPage.locator('#restReminderEnabled').isChecked(),true);assert.equal(await restPage.locator('#restReminderMinutes').inputValue(),'1');
    await restPage.locator('#startBtn').click();await signal();assert.equal(await restPage.locator('#restReminderDialog').isVisible(),false);
    await restPage.clock.fastForward(61000);await signal();await restPage.waitForSelector('#restReminderDialog:visible');
    await restPage.locator('#restReminderLater').click();assert.equal(await restPage.locator('body').getAttribute('data-timer-state'),'running');
    await signal();assert.equal(await restPage.locator('#restReminderDialog').isVisible(),false);
    await restPage.clock.fastForward(600001);await signal();await restPage.waitForSelector('#restReminderDialog:visible');await restPage.locator('#restReminderFinish').click();
    assert.equal(await restPage.locator('body').getAttribute('data-timer-state'),'idle');assert.equal(await restPage.locator('#todayRecordsBody .row-menu').count(),2);
    await restContext.close();console.log('PASS: reminder off beyond four hours, custom threshold, pause/resume, persistence, snooze and finish/save');
    assert.deepEqual(errors,[]);
    console.log(`UI smoke tests passed. Screenshots: ${output}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{ console.error(error); process.exitCode=1; });
