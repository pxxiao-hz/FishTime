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
  const allowed = new Set(['index.html', 'main.js', 'updater.js', 'style.css', 'assets/bgm/track1.mp3']);
  const server = http.createServer((request, response) => {
    const file = request.url.split('?')[0].slice(1) || 'index.html';
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
    assert.deepEqual(errors,[]);
    console.log(`UI smoke tests passed. Screenshots: ${output}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{ console.error(error); process.exitCode=1; });
