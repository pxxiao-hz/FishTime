const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function app() {
  let now = new Date('2026-10-31T10:00:00').getTime();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const stored = new Map();
  const elements = new Map();
  const actions = new Map();
  const calls = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, callback) { actions.set(`${id}:${name}`, callback); },
      closest() { return null; }, appendChild() {},
      querySelectorAll() { return []; }, querySelector() { return null; }
    });
    return elements.get(id);
  };
  let nativeAction;
  const context = vm.createContext({
    console, Date: Clock, setTimeout, clearTimeout,
    alert(message) { throw new Error(message); },
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key)
    },
    document: { getElementById: element, querySelector: element, querySelectorAll: () => [], createElement: () => ({}) },
    window: {
      addEventListener() {},
      __TAURI__: {
        core: { invoke: async (command, args) => { calls.push({command, args}); } },
        event: { listen: async (name, callback) => { if (name === 'timer:action') nativeAction = callback; } }
      }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), context);
  vm.runInContext('renderForecast = () => {}; render = () => syncTray(); setupEvents();', context);
  await new Promise(resolve => setImmediate(resolve));
  return {
    run: source => vm.runInContext(source, context),
    advance: ms => { now += ms; },
    action: name => nativeAction({payload: name}),
    click: id => actions.get(`${id}:click`)(),
    snapshot: () => calls.filter(call => call.command === 'sync_tray').at(-1).args.snapshot,
    elements, stored, calls
  };
}

test('native actions and window buttons share a single persisted session and save once', async () => {
  const a = await app();
  await a.action('start');
  assert.equal(a.snapshot().state, 'running');
  assert.equal(a.snapshot().intervals.length, 1);
  assert.equal(a.snapshot().intervals[0].end_ms, null, 'zero-length new segment remains open');
  a.advance(60000);
  a.click('pauseBtn');
  assert.equal(a.snapshot().state, 'paused');
  a.advance(30000);
  await a.action('start');
  assert.equal(a.snapshot().intervals.length, 2);
  assert.notEqual(a.snapshot().intervals[0].end_ms, null);
  assert.equal(a.snapshot().intervals[1].end_ms, null);
  a.advance(120000);
  a.elements.get('tagInput').value = '测试';
  a.elements.get('noteInput').value = '备注';
  await a.action('stop');
  await a.action('stop');
  const records = JSON.parse(a.run('JSON.stringify(loadRecords())'));
  assert.equal(records.length, 1);
  assert.equal(records[0].durationMs, 180000);
  assert.equal(records[0].tag, '测试');
  assert.equal(records[0].note, '备注');
  assert.equal(a.snapshot().state, 'idle');
  assert.equal(Object.values(a.snapshot().daily_totals)[0], 180000);
});

test('finish splits a session at local midnight', async () => {
  const a = await app();
  a.advance(14 * 3600000 - 60000);
  await a.action('start');
  a.advance(120000);
  await a.action('stop');
  const records = JSON.parse(a.run('JSON.stringify(loadRecords())'));
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(record => record.durationMs), [60000, 60000]);
  assert.notEqual(records[0].date, records[1].date);
});

test('quit pauses all workspaces before exit, and resume keeps accumulated time', async () => {
  const a = await app();
  await a.action('start');
  a.advance(10000);
  a.run('setWorkspace("second")');
  await a.action('start');
  a.advance(20000);
  await a.action('quit');
  for (const workspace of ['default', 'second']) {
    const session = JSON.parse(a.stored.get(`workTimerActiveSessionV1:${workspace}`));
    assert.equal(session.state, 'paused');
    assert.ok(session.segments.at(-1).end);
  }
  assert.equal(a.calls.at(-1).command, 'exit_app');
  a.advance(100000);
  await a.action('start');
  a.advance(5000);
  assert.equal(a.run('getActiveElapsedMs(loadActiveSession())'), 25000);
});

test('legacy running session is projected without losing accumulated time', async () => {
  const a = await app();
  a.run('saveActiveSession({state:"running",date:formatDate(new Date()),firstStart:new Date(Date.now()-20000).toISOString(),start:new Date().toISOString(),accumulatedMs:10000}); render();');
  const intervals = a.snapshot().intervals;
  assert.equal(intervals.length, 2);
  assert.equal(intervals[0].end_ms - intervals[0].start_ms, 10000);
  assert.equal(intervals[1].end_ms, null);
});
