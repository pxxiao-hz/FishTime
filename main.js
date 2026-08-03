const STORAGE_KEY_RECORDS = "workTimerRecordsV1";
const STORAGE_KEY_ACTIVE = "workTimerActiveSessionV1";
const STORAGE_KEY_LANG = "fishtime-lang";
const STORAGE_KEY_PAGE = "fishtime-page";
const STORAGE_KEY_AI = "fishtime-ai";
const STORAGE_KEY_AI_SUMMARY = "fishtime-ai-summary";
const STORAGE_KEY_WORKSPACE = "fishtime-workspaces";
const STORAGE_KEY_MODULES = "fishtime-modules";
const STORAGE_KEY_BGM = "fishtime-bgm";
const DEFAULT_WORKSPACE = "default";
const DEFAULT_LANG = "zh";

const chartHitboxes = {};
let chartTooltipEl = null;
const MAX_SESSION_MS = 4 * 60 * 60 * 1000; // 单次计时最长 4 小时
const QUOTES_ZH = [
  "今日的投入，决定明天的高度。",
  "小步不停，终会抵达。",
  "专注当下，就是最好的开始。",
  "时间会奖励每一次认真。",
  "慢一点没关系，别停下。",
  "把复杂的事做成一件一件的小事。",
  "每天进步 1%，一年就是 37 倍。",
  "先完成，再完美。",
  "你走得再慢，也在前进。",
  "方向对了，就别怕路远。",
  "努力是把能力变成习惯。",
  "认真做一件事，时间会给回报。",
  "今天的坚持，是未来的底气。",
  "把目标拆小，把行动做实。",
  "不积跬步，无以至千里。",
  "你所积累的，都会成为实力。",
  "一次专注，胜过十次分心。",
  "越简单的动作，越需要长期坚持。",
  "相信过程，结果自然会来。",
  "保持节奏，胜过一时爆发。",
  "你投入的专注，会变成竞争力。",
  "当你开始行动，答案就会出现。",
  "做对的事，把它做久。",
  "今天的你，正在塑造明天的你。",
  "别等灵感，先把手头的事做好。",
  "有所取舍，才能更快前进。",
  "你的专注，就是你的壁垒。",
  "每一次复盘，都是升级。",
  "把时间花在重要的事情上。",
  "坚持的力量，远胜天赋。"
];
const QUOTES_EN = [
  "Small steps every day add up.",
  "Focus on what matters, ignore the rest.",
  "Progress beats perfection.",
  "Do it now, polish later.",
  "Consistency builds strength.",
  "Show up, even on slow days.",
  "Time rewards honest effort.",
  "Keep the rhythm, not the rush.",
  "One task at a time.",
  "Start before you feel ready.",
  "Clarity comes from action.",
  "Make it simple, make it steady.",
  "Deep focus wins.",
  "Build habits, not excuses.",
  "Your future is shaped today.",
  "Practice turns effort into skill.",
  "Stay patient, stay present.",
  "Little by little, you get there.",
  "Keep moving forward.",
  "Energy follows intention.",
  "Discipline creates freedom.",
  "Finish what you start.",
  "Less noise, more progress.",
  "Hard things become habits.",
  "Keep the bar high and the mind calm.",
  "One hour well spent beats three distracted.",
  "Trust the process.",
  "Good work compounds.",
  "Do the right thing, repeatedly.",
  "Your focus is your advantage."
];

function wsKey(base) {
  return `${base}:${currentWorkspace}`;
}

function normalizeWorkspaceName(name) {
  return name.trim();
}

function isValidWorkspaceName(name) {
  if (!name) return false;
  if (name.length < 1 || name.length > 20) return false;
  return /^[\w\u4e00-\u9fa5-]+$/.test(name);
}

function loadWorkspaceMeta() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_WORKSPACE);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && Array.isArray(obj.list) && obj.list.length) {
        workspaces = Array.from(new Set(obj.list));
      }
      if (obj && obj.current && workspaces.includes(obj.current)) {
        currentWorkspace = obj.current;
      }
    }
  } catch (e) {
    console.error(e);
  }
  if (!workspaces.includes(DEFAULT_WORKSPACE)) {
    workspaces.unshift(DEFAULT_WORKSPACE);
  }
  currentWorkspace = currentWorkspace || DEFAULT_WORKSPACE;
  saveWorkspaceMeta();
}

function saveWorkspaceMeta() {
  localStorage.setItem(
    STORAGE_KEY_WORKSPACE,
    JSON.stringify({ current: currentWorkspace, list: workspaces })
  );
}

function loadModulePrefs() {
  const saved = loadScopedJSON(STORAGE_KEY_MODULES, true, null);
  if (saved && typeof saved === "object") {
    modulePrefs = { ...defaultModulePrefs(), ...saved };
  } else {
    modulePrefs = defaultModulePrefs();
  }
  // 保证新字段补全
  modulePrefs = { ...defaultModulePrefs(), ...modulePrefs };
  saveModulePrefs();
}

function saveModulePrefs() {
  if (!modulePrefs) return;
  saveScopedJSON(STORAGE_KEY_MODULES, modulePrefs);
}

function loadBgmSettings() {
  const defaultSources = defaultBgmSettings().sources;
  const builtInUrls = new Set(defaultSources.map(source => source.url));
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BGM);
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === "object") {
      bgmSettings = { ...defaultBgmSettings(), ...obj };
    } else {
      bgmSettings = defaultBgmSettings();
    }
  } catch {
    bgmSettings = defaultBgmSettings();
  }
  // 保证有至少一首
  if (!Array.isArray(bgmSettings.sources) || !bgmSettings.sources.length) {
    bgmSettings.sources = defaultSources;
  } else {
    // blob URL 仅在当前进程有效；同时清理旧版本中已失效的内置空音轨。
    bgmSettings.sources = bgmSettings.sources.filter(source =>
      source && source.builtIn && builtInUrls.has(source.url)
    );
    if (!bgmSettings.sources.length) bgmSettings.sources = defaultSources;
  }
  if (bgmSettings.index >= bgmSettings.sources.length) {
    bgmSettings.index = 0;
  }
  bgmSources = bgmSettings.sources;
}

function saveBgmSettings() {
  if (!bgmSettings) return;
  const persisted = {
    ...bgmSettings,
    sources: bgmSources.filter(source => source && source.builtIn)
  };
  localStorage.setItem(STORAGE_KEY_BGM, JSON.stringify(persisted));
}

function setBgmSource(index) {
  if (!bgmAudio || !bgmSources.length) return;
  bgmState.index = (index + bgmSources.length) % bgmSources.length;
  bgmSettings.index = bgmState.index;
  const src = bgmSources[bgmState.index];
  bgmAudio.src = src.url;
  updateBgmUI();
  saveBgmSettings();
}

function updateBgmUI() {
  const titleEl = document.getElementById("bgmTitle");
  const toggleBtn = document.getElementById("bgmToggle");
  const muteBtn = document.getElementById("bgmMute");
  if (titleEl && bgmSources.length) {
    titleEl.textContent = bgmSources[bgmState.index]?.name || "BGM";
  }
  if (toggleBtn) {
    toggleBtn.textContent = bgmState.playing ? "❚❚" : "▶︎";
  }
  if (muteBtn) {
    muteBtn.textContent = bgmSettings?.muted ? "🔇" : "🔊";
  }
  const volumeInput = document.getElementById("bgmVolume");
  if (volumeInput && bgmSettings) {
    volumeInput.value = bgmSettings.volume;
  }
}

function updateWorkspaceUI() {
  const select = document.getElementById("workspaceSelect");
  if (select) {
    select.innerHTML = "";
    workspaces.forEach(ws => {
      const opt = document.createElement("option");
      opt.value = ws;
      opt.textContent = ws;
      if (ws === currentWorkspace) opt.selected = true;
      select.appendChild(opt);
    });
  }
  const display = document.getElementById("currentWorkspaceBadge");
  if (display) {
    display.textContent = currentWorkspace;
  }
}

function setWorkspace(name) {
  const clean = normalizeWorkspaceName(name);
  if (!isValidWorkspaceName(clean)) {
    alert(t("settings.workspaceError"));
    return;
  }
  if (!workspaces.includes(clean)) {
    workspaces.push(clean);
  }
  currentWorkspace = clean;
  saveWorkspaceMeta();
  loadAiSummaryCache();
  loadModulePrefs();
  updateWorkspaceUI();
  render();
}
const I18N = {
  zh: {
    "app.title": "工作时长计时器",
    "mode.default": "默认",
    "mode.color": "色块",
    "mode.dark": "黑夜",
    "quote.label": "今日一句",
    "action.start": "开始工作",
    "action.pause": "暂停工作",
    "action.stop": "结束工作",
    "action.view": "查看",
    "action.edit": "编辑",
    "action.delete": "删除",
    "action.expand": "展开",
    "action.collapse": "收起",
    "action.save": "保存",
    "action.cancel": "取消",
    "nav.home": "主页",
    "nav.stats": "统计",
    "settings.title": "设置",
    "settings.language": "语言",
    "settings.theme": "界面模式",
    "settings.defaultPage": "默认页面",
    "settings.open": "打开设置",
    "settings.close": "关闭设置",
    "settings.workspace": "工作分区",
    "settings.workspaceSelect": "当前分区",
    "settings.workspaceAdd": "新建分区",
    "settings.workspacePlaceholder": "输入名称，回车创建",
    "settings.workspaceError": "分区名称需 1-20 个字符，只能包含中英文、数字、_ 或 -",
    "modules.title": "模块展示",
    "modules.homeForecast": "本月预测",
    "modules.homeToday": "今日记录",
    "modules.homeAI": "AI 总结",
    "modules.statsDate": "筛选统计",
    "modules.statsCalendar": "工作日历",
    "modules.statsMonthTag": "本月 Tag 汇总",
    "modules.statsMonthTotals": "月度总时长",
    "modules.statsBackup": "数据备份",
    "settings.aiProvider": "AI 服务",
    "settings.aiTitle": "AI 总结",
    "settings.aiKey": "Gemini / 硅基 API Key",
    "settings.aiKeyPlaceholder": "输入 API Key",
    "settings.aiHint": "用于生成工作总结，保存在本机。",
    "ai.title": "AI 总结",
    "ai.generate": "生成今日总结",
    "ai.copy": "复制",
    "ai.statusReady": "点击生成今日总结。",
    "ai.statusNoKey": "请在设置中填写 Gemini API Key。",
    "ai.statusLoading": "生成中，请稍候…",
    "ai.statusError": "生成失败，请稍后重试。",
    "ai.statusEmpty": "今天暂无记录可总结。",
    "ai.statusCached": "已加载本地总结，可重新生成。",
    "ai.provider.gemini": "Gemini",
    "ai.provider.silicon": "硅基流动",
    "heatmap.title": "工作日历",
    "heatmap.subtitle": "本月",
    "heatmap.rangeMonth": "本月",
    "heatmap.range30": "最近 30 天",
    "heatmap.rangeCustom": "自定义",
    "heatmap.customStart": "开始",
    "heatmap.customEnd": "结束",
    "heatmap.apply": "应用",
    "lang.optionZh": "中文",
    "lang.optionEn": "EN",
    "lang.toggleToEn": "切换到 English",
    "lang.toggleToZh": "切换到 中文",
    "lang.shortZh": "中",
    "lang.shortEn": "EN",
    "status.idle": "当前未在计时",
    "status.running": "正在计时",
    "status.runningFrom": "正在计时：从 {time} 开始",
    "status.paused": "当前已暂停",
    "status.sessionDuration": "本次已计时：{duration}",
    "label.tag": "Tag：",
    "label.note": "备注：",
    "label.date": "日期：",
    "label.month": "月份：",
    "placeholder.tag": "例如：Python / 单细胞",
    "placeholder.note": "这段时间做了什么",
    "summary.today": "今天工作时长",
    "summary.monthToDate": "本月截至今天",
    "forecast.title": "本月总时长预测",
    "forecast.estimated": "预计：{duration}",
    "forecast.noData": "预计：暂无数据",
    "forecast.note": "基于本月已过 {days} 天，平均每天 {avg}",
    "forecast.noDataNote": "请先记录至少一天的数据，再进行预测。",
    "filters.title": "筛选统计",
    "filters.byDate": "按日期/月份查看",
    "filters.pickDate": "请选择日期查看统计",
    "filters.pickMonth": "请选择月份查看统计",
    "filters.dateSummary": "{date} 总时长：{total}，共 {count} 段记录",
    "filters.monthSummary": "{month} 总时长：{total}，共 {days} 天有记录",
    "table.startTime": "开始时间",
    "table.endTime": "结束时间",
    "table.duration": "时长",
    "table.tag": "Tag",
    "table.note": "备注",
    "table.actions": "操作",
    "table.date": "日期",
    "table.dailyTotal": "当日总时长",
    "table.month": "月份",
    "table.totalDuration": "总时长",
    "chart.tagDistribution": "Tag 用时分布",
    "chart.bar": "柱状图",
    "chart.pie": "饼图",
    "chart.noData": "暂无数据",
    "chart.noTagData": "暂无 Tag 数据",
    "chart.xAxisDate": "日期",
    "chart.xAxisTag": "Tag",
    "chart.xAxisTagDay": "Tag（当天）",
    "chart.xAxisTagMonth": "Tag（当月）",
    "records.today": "今天的工作记录",
    "records.monthTag": "本月 Tag 工作记录（当前月份）",
    "records.monthTotals": "每月总时长",
    "backup.title": "数据备份",
    "backup.export": "导出数据",
    "backup.import": "导入数据",
    "backup.clear": "清空本机数据",
    "backup.tip":
      "建议从旧版本中导出一次数据，再在 FishTime 中导入，之后升级版本数据将自动保留。",
    "backup.importSuccess": "数据导入成功。",
    "backup.importFail": "数据导入失败：文件格式不正确。",
    "backup.clearConfirm": "确定要清空本机所有记录吗？此操作不可恢复。",
    "backup.clearSuccess": "已清空所有数据。",
    "edit.title": "编辑记录",
    "edit.start": "开始：",
    "edit.end": "结束：",
    "edit.timeRange": "时间段：{start} - {end}",
    "edit.endBeforeStart": "结束时间必须晚于开始时间。",
    "record.deleteConfirm": "确定删除这条记录吗？",
    "tag.unlabeled": "未标记",
    "unit.hour": "小时",
    "unit.minute": "分钟",
    "unit.hourShort": "小时",
    "unit.minuteShort": "分钟",
    "unit.hourAxis": "小时",
    "unit.minuteAxis": "分钟",
    "chart.tooltip.cumulative": "累计",
    "chart.tooltip.predicted": "预测累计",
    "alert.overLimit":
      "本次计时已超过 4 小时，请检查是否忘记结束或需要在工作记录中调整。"
  },
  en: {
    "app.title": "FishTime Work Timer",
    "mode.default": "Default",
    "mode.color": "Color",
    "mode.dark": "Dark",
    "quote.label": "Daily Quote",
    "action.start": "Start",
    "action.pause": "Pause",
    "action.stop": "Stop",
    "action.view": "View",
    "action.edit": "Edit",
    "action.delete": "Delete",
    "action.expand": "Expand",
    "action.collapse": "Collapse",
    "action.save": "Save",
    "action.cancel": "Cancel",
    "nav.home": "Home",
    "nav.stats": "Statistics",
    "settings.title": "Settings",
    "settings.language": "Language",
    "settings.theme": "Theme",
    "settings.defaultPage": "Default page",
    "settings.open": "Open settings",
    "settings.close": "Close settings",
    "modules.title": "Modules",
    "modules.homeForecast": "Monthly forecast",
    "modules.homeToday": "Today records",
    "modules.homeAI": "AI summary",
    "modules.statsDate": "Filters",
    "modules.statsCalendar": "Calendar",
    "modules.statsMonthTag": "Tag summary (month)",
    "modules.statsMonthTotals": "Monthly totals",
    "modules.statsBackup": "Backup",
    "settings.workspace": "Workspace",
    "settings.workspaceSelect": "Current workspace",
    "settings.workspaceAdd": "New workspace",
    "settings.workspacePlaceholder": "Enter name, press Enter",
    "settings.workspaceError": "Name must be 1-20 chars (letters, numbers, _ or -).",
    "settings.aiProvider": "AI Service",
    "settings.aiTitle": "AI Summary",
    "settings.aiKey": "Gemini / Silicon API Key",
    "settings.aiKeyPlaceholder": "Enter API Key",
    "settings.aiHint": "Used for summaries; stored locally.",
    "ai.title": "AI Summary",
    "ai.generate": "Generate today",
    "ai.copy": "Copy",
    "ai.statusReady": "Click to generate today’s summary.",
    "ai.statusNoKey": "Please add a Gemini API Key in Settings.",
    "ai.statusLoading": "Generating, please wait…",
    "ai.statusError": "Generation failed, please try again.",
    "ai.statusEmpty": "No records for today to summarize.",
    "ai.statusCached": "Loaded local summary; you can regenerate.",
    "ai.provider.gemini": "Gemini",
    "ai.provider.silicon": "SiliconFlow",
    "heatmap.title": "Work Calendar",
    "heatmap.subtitle": "This month",
    "heatmap.rangeMonth": "This month",
    "heatmap.range30": "Last 30 days",
    "heatmap.rangeCustom": "Custom",
    "heatmap.customStart": "Start",
    "heatmap.customEnd": "End",
    "heatmap.apply": "Apply",
    "lang.optionZh": "中文",
    "lang.optionEn": "EN",
    "lang.toggleToEn": "Switch to English",
    "lang.toggleToZh": "Switch to 中文",
    "lang.shortZh": "中",
    "lang.shortEn": "EN",
    "status.idle": "Not tracking",
    "status.running": "Tracking",
    "status.runningFrom": "Tracking since {time}",
    "status.paused": "Paused",
    "status.sessionDuration": "This session: {duration}",
    "label.tag": "Tag:",
    "label.note": "Note:",
    "label.date": "Date:",
    "label.month": "Month:",
    "placeholder.tag": "e.g. Python / Single-cell",
    "placeholder.note": "What did you work on?",
    "summary.today": "Today",
    "summary.monthToDate": "Month to Date",
    "forecast.title": "Monthly Total Forecast",
    "forecast.estimated": "Estimated: {duration}",
    "forecast.noData": "Estimated: No data",
    "forecast.note": "Based on {days} days so far, avg {avg} per day",
    "forecast.noDataNote": "Record at least one day to enable forecast.",
    "filters.title": "Filters",
    "filters.byDate": "By Date / Month",
    "filters.pickDate": "Pick a date to view stats",
    "filters.pickMonth": "Pick a month to view stats",
    "filters.dateSummary": "{date} total: {total}, {count} entries",
    "filters.monthSummary": "{month} total: {total}, {days} days with records",
    "table.startTime": "Start",
    "table.endTime": "End",
    "table.duration": "Duration",
    "table.tag": "Tag",
    "table.note": "Note",
    "table.actions": "Actions",
    "table.date": "Date",
    "table.dailyTotal": "Daily Total",
    "table.month": "Month",
    "table.totalDuration": "Total",
    "chart.tagDistribution": "Tag Time Distribution",
    "chart.bar": "Bar",
    "chart.pie": "Pie",
    "chart.noData": "No data",
    "chart.noTagData": "No tag data",
    "chart.xAxisDate": "Date",
    "chart.xAxisTag": "Tag",
    "chart.xAxisTagDay": "Tag (Day)",
    "chart.xAxisTagMonth": "Tag (Month)",
    "records.today": "Today's Records",
    "records.monthTag": "This Month Tag Records",
    "records.monthTotals": "Monthly Totals",
    "backup.title": "Data Backup",
    "backup.export": "Export",
    "backup.import": "Import",
    "backup.clear": "Clear Local Data",
    "backup.tip":
      "Export once from the old version and import into FishTime. Data will be kept automatically after upgrades.",
    "backup.importSuccess": "Import succeeded.",
    "backup.importFail": "Import failed: invalid file.",
    "backup.clearConfirm": "Clear all local records? This cannot be undone.",
    "backup.clearSuccess": "All data cleared.",
    "edit.title": "Edit Record",
    "edit.start": "Start:",
    "edit.end": "End:",
    "edit.timeRange": "Time: {start} - {end}",
    "edit.endBeforeStart": "End time must be after start time.",
    "record.deleteConfirm": "Delete this record?",
    "tag.unlabeled": "Unlabeled",
    "unit.hour": "h",
    "unit.minute": "min",
    "unit.hourShort": "h",
    "unit.minuteShort": "min",
    "unit.hourAxis": "Hours",
    "unit.minuteAxis": "Minutes",
    "chart.tooltip.cumulative": "Cumulative",
    "chart.tooltip.predicted": "Predicted",
    "alert.overLimit":
      "This session exceeded 4 hours. Please check if you forgot to stop or adjust in records."
  }
};
const chartModes = {
  tagDateChart: "bar",
  tagMonthChart: "bar"
};
let monthTagSortAsc = false;
let todaySortField = "start"; // "start" | "end" | "duration"
let todaySortAsc = true;
let currentEditKey = null;
let pendingDeleteKey = null;
let cachedTags = [];
let currentLang = DEFAULT_LANG;
let currentPage = "home";
let langOptionButtons = [];
let themeOptionButtons = [];
let pageOptionButtons = [];
let aiProviderButtons = [];
let aiSettings = {
  provider: "gemini",
  apiKey: ""
};
let aiSummaryCache = {};
let workspaces = [DEFAULT_WORKSPACE];
let currentWorkspace = DEFAULT_WORKSPACE;
let modulePrefs = null;
let bgmSettings = null;
let bgmSources = [];
let bgmAudio = null;
let bgmState = {
  index: 0,
  playing: false
};

function defaultBgmSettings() {
  return {
    volume: 0.5,
    muted: false,
    index: 0,
    sources: [
      { name: "内置曲目 1", url: "assets/bgm/track1.mp3", builtIn: true }
    ]
  };
}

function defaultModulePrefs() {
  return {
    homeForecast: true,
    homeToday: true,
    homeAI: true,
    statsDate: true,
    statsCalendar: true,
    statsMonthTag: true,
    statsMonthTotals: true,
    statsBackup: true
  };
}
const AI_MODEL = "gemini-2.0-flash";
const AI_MODEL_SILICON = "Qwen/Qwen3-8B";
const HEATMAP_DAYS = 35;
let calendarRangeMode = "month"; // "month" | "30d" | "custom"
let calendarCustomStart = null;
let calendarCustomEnd = null;
let calendarSelectedDate = null;
let calendarTagFilter = null;

function t(key, vars) {
  const dict = I18N[currentLang] || I18N[DEFAULT_LANG];
  let text = dict[key] || I18N[DEFAULT_LANG][key] || key;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    });
  }
  return text;
}

function getUnitLabel(useMinutes, variant) {
  if (variant === "axis") {
    return useMinutes ? t("unit.minuteAxis") : t("unit.hourAxis");
  }
  if (variant === "short") {
    return useMinutes ? t("unit.minuteShort") : t("unit.hourShort");
  }
  return useMinutes ? t("unit.minute") : t("unit.hour");
}

function formatValueWithUnit(value, useMinutes, decimals) {
  const unit = getUnitLabel(useMinutes, "short");
  const display =
    decimals == null ? value.toString() : Number(value).toFixed(decimals);
  return currentLang === "en" ? `${display} ${unit}` : `${display} ${unit}`;
}

function formatDisplayDate(date) {
  if (currentLang === "en") {
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y} 年 ${m} 月 ${d} 日`;
}

function loadAiSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AI);
    if (!raw) return { ...aiSettings };
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      aiSettings = {
        provider: obj.provider || "gemini",
        apiKey: obj.apiKey || ""
      };
    }
  } catch (e) {
    console.error(e);
  }
  return { ...aiSettings };
}

function saveAiSettings(next) {
  aiSettings = { ...aiSettings, ...next };
  // API Key 仅保留在内存；Tauri 桌面版写入系统钥匙串。
  localStorage.setItem(
    STORAGE_KEY_AI,
    JSON.stringify({ provider: aiSettings.provider, apiKey: "" })
  );
}

function tauriInvoke(command, args) {
  const invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  return invoke ? invoke(command, args) : null;
}

async function loadSecureApiKey(provider) {
  try {
    const result = tauriInvoke("load_api_key", { provider });
    return result ? (await result) || "" : aiSettings.apiKey || "";
  } catch (error) {
    console.error(error);
    return "";
  }
}

async function saveSecureApiKey(provider, apiKey) {
  const result = tauriInvoke("save_api_key", { provider, apiKey });
  if (result) await result;
}

function loadAiSummaryCache() {
  const obj = loadScopedJSON(STORAGE_KEY_AI_SUMMARY, true, {});
  aiSummaryCache = obj && typeof obj === "object" ? obj : {};
  return aiSummaryCache;
}

function saveAiSummary(dateKey, text) {
  aiSummaryCache = { ...aiSummaryCache, [dateKey]: text };
  saveScopedJSON(STORAGE_KEY_AI_SUMMARY, aiSummaryCache);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(date) {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return currentLang === "en" ? `${Math.max(0, totalSeconds)} sec` : `${Math.max(0, totalSeconds)} 秒`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (currentLang === "en") {
    return `${hours} h ${minutes} min`;
  }
  return `${hours} 小时 ${minutes} 分钟`;
}

function loadScopedJSON(baseKey, migrateOld = false, fallback = null) {
  const key = wsKey(baseKey);
  let raw = localStorage.getItem(key);
  if (!raw && migrateOld) {
    const old = localStorage.getItem(baseKey);
    if (old) {
      raw = old;
      localStorage.setItem(key, old);
      localStorage.removeItem(baseKey);
    }
  }
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveScopedJSON(baseKey, value) {
  const key = wsKey(baseKey);
  localStorage.setItem(key, JSON.stringify(value));
}

function loadRecords() {
  const arr = loadScopedJSON(STORAGE_KEY_RECORDS, true, []);
  return Array.isArray(arr) ? arr : [];
}

function saveRecords(records) {
  saveScopedJSON(STORAGE_KEY_RECORDS, records);
  // 任意记录变更都会影响按日总结；宁可重新生成，也不展示过期内容。
  aiSummaryCache = {};
  saveScopedJSON(STORAGE_KEY_AI_SUMMARY, aiSummaryCache);
}

function loadActiveSession() {
  const obj = loadScopedJSON(STORAGE_KEY_ACTIVE, true, null);
  if (!obj || typeof obj !== "object" || !["running", "paused"].includes(obj.state)) {
    return null;
  }
  if (typeof obj.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(obj.date)) {
    return null;
  }
  const hasSegments = Array.isArray(obj.segments) && obj.segments.length > 0;
  if (obj.state === "running" && !hasSegments && (!obj.start || !Number.isFinite(new Date(obj.start).getTime()))) {
    return null;
  }
  if (obj.state === "paused" && !hasSegments && !Number.isFinite(Number(obj.accumulatedMs))) {
    return null;
  }
  return obj;
}

function saveActiveSession(session) {
  if (!session) {
    localStorage.removeItem(wsKey(STORAGE_KEY_ACTIVE));
  } else {
    saveScopedJSON(STORAGE_KEY_ACTIVE, session);
  }
}

function getTodayRecords(records, todayStr) {
  return records.filter(r => r.date === todayStr);
}

function getMonthRecords(records, year, month) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return records.filter(r => r && typeof r.date === "string" && r.date.startsWith(prefix));
}

function sumDuration(records) {
  return records.reduce((acc, r) => {
    const duration = Number(r && r.durationMs);
    return acc + (Number.isFinite(duration) && duration > 0 ? duration : 0);
  }, 0);
}

function getActiveElapsedMs(active, nowMs = Date.now()) {
  return getActiveIntervals(active, nowMs).reduce((total, interval) =>
    total + Math.max(0, interval.endMs - interval.startMs), 0);
}

function getActiveIntervals(active, nowMs = Date.now()) {
  if (!active) return [];
  if (Array.isArray(active.segments)) {
    return active.segments
      .map(segment => {
        const startMs = new Date(segment.start).getTime();
        const endMs = segment.end ? new Date(segment.end).getTime() : nowMs;
        return { startMs, endMs };
      })
      .filter(interval => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs) && interval.endMs > interval.startMs);
  }

  // 兼容旧版的 accumulatedMs + start 数据结构。
  const intervals = [];
  const startMs = active.start ? new Date(active.start).getTime() : NaN;
  if (Number.isFinite(startMs) && active.state !== "paused") {
    intervals.push({ startMs, endMs: nowMs });
  }
  const accumulatedMs = Number(active.accumulatedMs);
  const firstStartMs = active.firstStart ? new Date(active.firstStart).getTime() : startMs;
  if (Number.isFinite(accumulatedMs) && accumulatedMs > 0 && Number.isFinite(firstStartMs)) {
    intervals.unshift({ startMs: firstStartMs, endMs: firstStartMs + accumulatedMs });
  }
  return intervals;
}

function getActiveDurationsByDate(active, nowMs = Date.now()) {
  const grouped = {};
  getActiveIntervals(active, nowMs).forEach(({ startMs, endMs }) => {
    let cursor = startMs;
    while (cursor < endMs) {
      const cursorDate = new Date(cursor);
      const nextMidnight = new Date(
        cursorDate.getFullYear(),
        cursorDate.getMonth(),
        cursorDate.getDate() + 1
      ).getTime();
      const partEnd = Math.min(endMs, nextMidnight);
      const date = formatDate(cursorDate);
      const entry = grouped[date] || {
        durationMs: 0,
        firstStartMs: cursor,
        lastEndMs: partEnd
      };
      entry.durationMs += partEnd - cursor;
      entry.firstStartMs = Math.min(entry.firstStartMs, cursor);
      entry.lastEndMs = Math.max(entry.lastEndMs, partEnd);
      grouped[date] = entry;
      cursor = partEnd;
    }
  });
  return grouped;
}

function closeRunningSegment(active, endIso) {
  if (!active || active.state === "paused") return active;
  const segments = Array.isArray(active.segments) ? [...active.segments] : [];
  if (!segments.length && active.start) {
    segments.push({ start: active.start });
  }
  const last = segments[segments.length - 1];
  if (last && !last.end) {
    segments[segments.length - 1] = { ...last, end: endIso };
  }
  return { ...active, segments, state: "paused", start: null };
}

function buildRecordsFromActiveSession(active, end, tag, note) {
  const byDate = getActiveDurationsByDate(active, end.getTime());
  return Object.entries(byDate).map(([date, entry]) => {
    const start = new Date(entry.firstStartMs);
    const stop = new Date(entry.lastEndMs);
    return {
      id: `${entry.firstStartMs}-${Math.random().toString(16).slice(2)}`,
      date,
      startTime: start.toISOString(),
      endTime: stop.toISOString(),
      startTimeText: formatTime(start),
      endTimeText: formatTime(stop),
      durationMs: entry.durationMs,
      tag,
      note
    };
  });
}

function getRecordKey(record) {
  if (record.id !== undefined && record.id !== null && String(record.id)) {
    return String(record.id);
  }
  return `${record.startTime || ""}|${record.endTime || ""}`;
}

function appendRecordActions(container, record) {
  const key = getRecordKey(record);
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "record-edit";
  editBtn.dataset.key = key;
  editBtn.textContent = t("action.edit");

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "record-delete";
  deleteBtn.dataset.key = key;
  deleteBtn.textContent = t("action.delete");

  container.appendChild(editBtn);
  container.appendChild(deleteBtn);
}

function toTimeInputValue(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function formatAvgDuration(ms) {
  if (ms < 60 * 60 * 1000) {
    const mins = Math.max(0, Math.round(ms / 60000));
    if (currentLang === "en") {
      return `${mins} min`;
    }
    return `${mins} 分钟`;
  }
  const hours = ms / 3600000;
  if (currentLang === "en") {
    return `${hours.toFixed(1)} h`;
  }
  return `${hours.toFixed(1)} 小时`;
}

function limitTagDisplay(label) {
  if (!label) return "";
  let units = 0;
  let result = "";
  for (const ch of label) {
    const code = ch.codePointAt(0);
    const isAscii = code <= 0x7f;
    const add = isAscii ? 1 : 2;
    if (units + add > 10) {
      break;
    }
    units += add;
    result += ch;
  }
  if (result.length < label.length) {
    result += "…";
  }
  return result;
}

function getTagColor(label) {
  const palette = [
    "#4caf50",
    "#2196f3",
    "#ff9800",
    "#e91e63",
    "#9c27b0",
    "#00bcd4",
    "#8bc34a",
    "#ffc107",
    "#ff5722",
    "#607d8b",
    "#3f51b5",
    "#009688",
    "#cddc39",
    "#795548",
    "#f06292",
    "#ba68c8",
    "#4dd0e1",
    "#aed581",
    "#ffb74d",
    "#90a4ae"
  ];
  let hash = 0;
  for (const ch of label) {
    hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

function getChartColors() {
  const styles = getComputedStyle(document.body);
  return {
    background: styles.getPropertyValue("--chart-bg").trim() || "#fafafa",
    text: styles.getPropertyValue("--chart-text").trim() || "#666",
    axis: styles.getPropertyValue("--chart-axis").trim() || "#ccc",
    empty: styles.getPropertyValue("--chart-empty").trim() || "#999"
  };
}
function getChartTooltip() {
  if (!chartTooltipEl) {
    chartTooltipEl = document.createElement("div");
    chartTooltipEl.className = "chart-tooltip";
    chartTooltipEl.style.display = "none";
    document.body.appendChild(chartTooltipEl);
  }
  return chartTooltipEl;
}

function showChartTooltip(text, clientX, clientY) {
  const el = getChartTooltip();
  el.textContent = text;
  el.style.left = `${clientX}px`;
  el.style.top = `${clientY}px`;
  el.style.display = "block";
}

function hideChartTooltip() {
  if (chartTooltipEl) {
    chartTooltipEl.style.display = "none";
  }
}

function setRandomQuote() {
  const quoteEl = document.getElementById("quoteText");
  const quotes = currentLang === "en" ? QUOTES_EN : QUOTES_ZH;
  if (!quoteEl || !quotes.length) return;
  const index = Math.floor(Math.random() * quotes.length);
  quoteEl.textContent = quotes[index];
}

function updateToggleButtonLabels() {
  const mappings = [
    {
      btn: document.getElementById("toggleDateSection"),
      section: document.querySelector('.filter-group[data-section="date-month"]')
    },
    {
      btn: document.getElementById("toggleTodayRecords"),
      section: document.querySelector('.records.collapsible[data-section="todayRecords"]')
    },
    {
      btn: document.getElementById("toggleMonthTagRecords"),
      section: document.querySelector('.records.collapsible[data-section="monthTagRecords"]')
    },
    {
      btn: document.getElementById("toggleMonthTotals"),
      section: document.querySelector('.records.collapsible[data-section="monthTotals"]')
    }
  ];

  mappings.forEach(({ btn, section }) => {
    if (!btn || !section) return;
    const collapsed = section.classList.contains("collapsed");
    btn.textContent = t(collapsed ? "action.expand" : "action.collapse");
  });
}

function applyLocale(lang) {
  if (lang) {
    currentLang = I18N[lang] ? lang : DEFAULT_LANG;
  } else if (!I18N[currentLang]) {
    currentLang = DEFAULT_LANG;
  }

  localStorage.setItem(STORAGE_KEY_LANG, currentLang);
  document.documentElement.lang = currentLang === "en" ? "en" : "zh-CN";
  document.title = t("app.title");

  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    el.textContent = t(key);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) return;
    el.setAttribute("placeholder", t(key));
  });

  const modeDefaultBtn = document.getElementById("modeDefaultBtn");
  const modeColorBtn = document.getElementById("modeColorBtn");
  const modeDarkBtn = document.getElementById("modeDarkBtn");
  const pageHomeBtn = document.getElementById("pageHomeBtn");
  const pageStatsBtn = document.getElementById("pageStatsBtn");
  const langToggleBtn = document.getElementById("langToggleBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsPanel = document.getElementById("settingsPanel");
  const settingsCloseBtn = document.getElementById("settingsCloseBtn");
  const aiApiKeyInput = document.getElementById("aiApiKeyInput");
  const aiSaveBtn = document.getElementById("aiSaveBtn");
  const aiGenerateBtn = document.getElementById("aiGenerateBtn");
  const aiCopyBtn = document.getElementById("aiCopyBtn");
  const aiSummaryBox = document.getElementById("aiSummaryBox");
  const aiSummaryStatus = document.getElementById("aiSummaryStatus");
  langOptionButtons = Array.from(document.querySelectorAll("[data-lang-option]"));
  themeOptionButtons = Array.from(document.querySelectorAll("[data-theme-option]"));
  pageOptionButtons = Array.from(document.querySelectorAll("[data-page-option]"));
  aiProviderButtons = Array.from(document.querySelectorAll("[data-ai-provider]"));
  const moduleCheckboxes = Array.from(document.querySelectorAll("input[data-module-key]"));
  moduleCheckboxes.forEach(box => {
    const key = box.dataset.moduleKey;
    if (key && modulePrefs && key in modulePrefs) {
      box.checked = !!modulePrefs[key];
    }
  });
  if (modeDefaultBtn) {
    modeDefaultBtn.setAttribute("aria-label", t("mode.default"));
    modeDefaultBtn.setAttribute("title", t("mode.default"));
  }
  if (modeColorBtn) {
    modeColorBtn.setAttribute("aria-label", t("mode.color"));
    modeColorBtn.setAttribute("title", t("mode.color"));
  }
  if (modeDarkBtn) {
    modeDarkBtn.setAttribute("aria-label", t("mode.dark"));
    modeDarkBtn.setAttribute("title", t("mode.dark"));
  }

  if (langToggleBtn) {
    const isZh = currentLang === "zh";
    langToggleBtn.dataset.short = t(isZh ? "lang.shortZh" : "lang.shortEn");
    langToggleBtn.setAttribute(
      "title",
      t(isZh ? "lang.toggleToEn" : "lang.toggleToZh")
    );
    langToggleBtn.setAttribute(
      "aria-label",
      t(isZh ? "lang.toggleToEn" : "lang.toggleToZh")
    );
  }
  if (settingsBtn) {
    settingsBtn.setAttribute("title", t("settings.open"));
    settingsBtn.setAttribute("aria-label", t("settings.open"));
  }
  if (settingsCloseBtn) {
    settingsCloseBtn.setAttribute("title", t("settings.close"));
    settingsCloseBtn.setAttribute("aria-label", t("settings.close"));
  }

  updateToggleButtonLabels();
  setRandomQuote();
  updateSettingsOptions();
}

function setPage(page) {
  currentPage = page === "stats" ? "stats" : "home";
  localStorage.setItem(STORAGE_KEY_PAGE, currentPage);

  applyModuleVisibility();

  const homeBtn = document.getElementById("pageHomeBtn");
  const statsBtn = document.getElementById("pageStatsBtn");
  if (homeBtn) homeBtn.classList.toggle("active", currentPage === "home");
  if (statsBtn) statsBtn.classList.toggle("active", currentPage === "stats");
  updateSettingsOptions();
}

function applyModuleVisibility() {
  const bgmFloating = document.getElementById("bgmFloating");
  if (bgmFloating) {
    bgmFloating.classList.remove("hidden");
  }
  document.querySelectorAll(".page-section").forEach(el => {
    const target = el.getAttribute("data-page");
    if (!target) return;
    let hide = target !== currentPage;
    if (!hide && modulePrefs) {
      let id = null;
      if (target === "home") {
        if (el.classList.contains("forecast")) id = "homeForecast";
        if (el.classList.contains("records") && el.dataset.section === "todayRecords") id = "homeToday";
        if (el.classList.contains("ai-summary")) id = "homeAI";
      } else if (target === "stats") {
        if (el.classList.contains("filters") && modulePrefs.statsDate === false) hide = true;
        if (el.classList.contains("heatmap")) id = "statsCalendar";
        if (el.classList.contains("records") && el.dataset.section === "monthTagRecords") id = "statsMonthTag";
        if (el.classList.contains("records") && el.dataset.section === "monthTotals") id = "statsMonthTotals";
        if (el.classList.contains("backup")) id = "statsBackup";
      }
      if (!hide && id && modulePrefs[id] === false) {
        hide = true;
      }
    }
    el.classList.toggle("hidden", hide);
  });
}

function updateSettingsOptions() {
  langOptionButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.langOption === currentLang);
  });

  themeOptionButtons.forEach(btn => {
    const mode = btn.dataset.themeOption;
    btn.classList.toggle("active", document.body.classList.contains(mode));
  });

  pageOptionButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.pageOption === currentPage);
  });

  aiProviderButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.aiProvider === aiSettings.provider);
  });

  updateWorkspaceUI();

  const moduleCheckboxes = Array.from(document.querySelectorAll("input[data-module-key]"));
  moduleCheckboxes.forEach(box => {
    const key = box.dataset.moduleKey;
    if (!key || !modulePrefs) return;
    box.checked = modulePrefs[key] !== false;
  });

  const heatmapSubtitle = document.getElementById("heatmapSubtitle");
  if (heatmapSubtitle) {
    heatmapSubtitle.textContent = t("heatmap.subtitle");
  }
}

function updateAiStatus(text) {
  const statusEl = document.getElementById("aiSummaryStatus");
  if (statusEl) statusEl.textContent = text;
}

async function callAiApi(prompt, settings) {
  if (settings.provider === "silicon") {
    const resp = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: AI_MODEL_SILICON,
        messages: [
          { role: "system", content: currentLang === "en" ? "You are a concise work summary assistant." : "你是一个简洁的工作总结助手。" },
          { role: "user", content: prompt }
        ],
        stream: false,
        temperature: 0.7,
        top_p: 0.7
      })
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} ${txt}`);
    }
    return resp;
  }

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${AI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ]
      })
    }
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${txt}`);
  }
  return resp;
}

function parseAiResponse(resp, provider) {
  if (provider === "silicon") {
    // response already checked ok
    return resp.json().then(data => {
      const text =
        data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content;
      return text || "";
    });
  }
  return resp.json().then(data => {
    const text =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;
    return text || "";
  });
}

async function handleAiGenerate() {
  const now = new Date();
  const todayStr = formatDate(now);
  const records = loadRecords();
  const todayRecords = getTodayRecords(records, todayStr);
  if (!todayRecords.length) {
    updateAiStatus(t("ai.statusEmpty"));
    return;
  }

  const settings = loadAiSettings();
  if (!settings.apiKey) {
    updateAiStatus(t("ai.statusNoKey"));
    return;
  }

  updateAiStatus(t("ai.statusLoading"));

  const prompt = buildAiPrompt(todayRecords, todayStr);
  try {
    const resp = await callAiApi(prompt, settings);
    const text = await parseAiResponse(resp, settings.provider);
    if (!text) throw new Error("Empty response");
    const box = document.getElementById("aiSummaryBox");
    if (box) {
      box.textContent = text;
    }
    saveAiSummary(todayStr, text);
    updateAiStatus(t("ai.statusCached"));
  } catch (e) {
    console.error(e);
    const msg = e && e.message ? e.message : "";
    const friendly =
      currentLang === "en"
        ? `${t("ai.statusError")} ${msg}`
        : `${t("ai.statusError")} ${msg}`;
    updateAiStatus(friendly);
  }
}

function buildAiPrompt(todayRecords, dateStr) {
  const lines = todayRecords.map(r => {
    const start = r.startTimeText || "";
    const end = r.endTimeText || "";
    const tag = r.tag ? `Tag: ${r.tag}` : "Tag: -";
    const note = r.note ? `备注: ${r.note}` : "";
    const dur = formatDuration(r.durationMs || 0);
    return `- ${start}-${end} ${tag} ${note} 时长: ${dur}`;
  });
  if (currentLang === "en") {
    return (
      `Date: ${dateStr}\n` +
      `Please summarize today's work into 3-5 bullet points and give 2 suggestions for tomorrow.\n` +
      `Records:\n` +
      lines.join("\n")
    );
  }
  return (
    `日期：${dateStr}\n` +
    `请基于以下记录生成今日工作总结（3-5 条要点）并给出明天建议（2 条）。\n` +
    `记录：\n` +
    lines.join("\n")
  );
}

function exportData() {
  const workspaceData = {};
  workspaces.forEach(workspace => {
    const readScoped = (baseKey, fallback) => {
      try {
        const raw = localStorage.getItem(`${baseKey}:${workspace}`);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    };
    workspaceData[workspace] = {
      records: readScoped(STORAGE_KEY_RECORDS, []),
      activeSession: readScoped(STORAGE_KEY_ACTIVE, null),
      modules: readScoped(STORAGE_KEY_MODULES, defaultModulePrefs()),
      aiSummaries: readScoped(STORAGE_KEY_AI_SUMMARY, {})
    };
  });

  const data = {
    format: "fishtime-backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    currentWorkspace,
    workspaceData,
    preferences: {
      language: localStorage.getItem(STORAGE_KEY_LANG) || DEFAULT_LANG,
      page: localStorage.getItem(STORAGE_KEY_PAGE) || "home",
      theme: localStorage.getItem("fishtime-ui-mode") || "mode-default",
      bgm: bgmSettings,
      aiProvider: aiSettings.provider || "gemini"
    },
    // 保留旧字段，旧版 FishTime 仍能导入当前分区。
    records: loadRecords(),
    activeSession: loadActiveSession()
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  a.href = url;
  a.download = `FishTime-data-${y}${m}${d}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importFullBackup(parsed) {
  if (
    parsed.format !== "fishtime-backup" ||
    Number(parsed.version) < 2 ||
    !parsed.workspaceData ||
    typeof parsed.workspaceData !== "object"
  ) {
    return false;
  }

  const importedWorkspaces = Object.keys(parsed.workspaceData)
    .map(normalizeWorkspaceName)
    .filter(isValidWorkspaceName);
  if (!importedWorkspaces.length) {
    throw new Error("Backup has no valid workspaces");
  }

  const prepared = importedWorkspaces.map(workspace => {
    const source = parsed.workspaceData[workspace] || {};
    return {
      workspace,
      records: Array.isArray(source.records)
      ? source.records.map(normalizeImportedRecord).filter(Boolean)
      : [],
      activeSession: source.activeSession && typeof source.activeSession === "object"
        ? source.activeSession
        : null,
      modules: { ...defaultModulePrefs(), ...(source.modules || {}) },
      aiSummaries: source.aiSummaries && typeof source.aiSummaries === "object"
        ? source.aiSummaries
        : {}
    };
  });

  const storageKeys = prepared.flatMap(({ workspace }) => [
    `${STORAGE_KEY_RECORDS}:${workspace}`,
    `${STORAGE_KEY_ACTIVE}:${workspace}`,
    `${STORAGE_KEY_MODULES}:${workspace}`,
    `${STORAGE_KEY_AI_SUMMARY}:${workspace}`
  ]);
  const snapshot = new Map(storageKeys.map(key => [key, localStorage.getItem(key)]));
  try {
    prepared.forEach(({ workspace, records, activeSession, modules, aiSummaries }) => {
      localStorage.setItem(`${STORAGE_KEY_RECORDS}:${workspace}`, JSON.stringify(records));
      if (activeSession) {
        localStorage.setItem(`${STORAGE_KEY_ACTIVE}:${workspace}`, JSON.stringify(activeSession));
      } else {
        localStorage.removeItem(`${STORAGE_KEY_ACTIVE}:${workspace}`);
      }
      localStorage.setItem(`${STORAGE_KEY_MODULES}:${workspace}`, JSON.stringify(modules));
      localStorage.setItem(`${STORAGE_KEY_AI_SUMMARY}:${workspace}`, JSON.stringify(aiSummaries));
    });
  } catch (error) {
    snapshot.forEach((value, key) => {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
    throw error;
  }

  workspaces = Array.from(new Set([DEFAULT_WORKSPACE, ...importedWorkspaces]));
  currentWorkspace = importedWorkspaces.includes(parsed.currentWorkspace)
    ? parsed.currentWorkspace
    : importedWorkspaces[0];
  saveWorkspaceMeta();

  const prefs = parsed.preferences || {};
  if (I18N[prefs.language]) localStorage.setItem(STORAGE_KEY_LANG, prefs.language);
  if (["home", "stats"].includes(prefs.page)) localStorage.setItem(STORAGE_KEY_PAGE, prefs.page);
  if (["mode-default", "mode-color", "mode-dark"].includes(prefs.theme)) {
    localStorage.setItem("fishtime-ui-mode", prefs.theme);
  }
  if (prefs.bgm && typeof prefs.bgm === "object") {
    localStorage.setItem(STORAGE_KEY_BGM, JSON.stringify(prefs.bgm));
  }
  if (typeof prefs.aiProvider === "string") {
    saveAiSettings({ provider: prefs.aiProvider, apiKey: "" });
  }

  loadAiSummaryCache();
  loadModulePrefs();
  loadBgmSettings();
  updateWorkspaceUI();
  return true;
}

function normalizeImportedRecord(record) {
  if (!record || typeof record !== "object") return null;
  const startDate = new Date(record.startTime);
  const endDate = new Date(record.endTime);
  const durationMs = Number(record.durationMs);
  if (
    !Number.isFinite(startDate.getTime()) ||
    !Number.isFinite(endDate.getTime()) ||
    endDate <= startDate ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return null;
  }

  const date = typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.date)
    ? record.date
    : formatDate(startDate);
  return {
    id: typeof record.id === "string" && record.id ? record.id : `${startDate.getTime()}-${Math.random().toString(16).slice(2)}`,
    date,
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
    startTimeText: formatTime(startDate),
    endTimeText: formatTime(endDate),
    durationMs,
    tag: typeof record.tag === "string" ? record.tag.slice(0, 100) : "",
    note: typeof record.note === "string" ? record.note.slice(0, 500) : ""
  };
}

function importDataFromFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    alert(t("backup.importFail"));
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (importFullBackup(parsed)) {
        render();
        alert(t("backup.importSuccess"));
        return;
      }
      if (!parsed || !Array.isArray(parsed.records)) {
        throw new Error("Invalid backup format");
      }
      const records = parsed.records
        .map(normalizeImportedRecord)
        .filter(Boolean);
      if (parsed.records.length && !records.length) {
        throw new Error("No valid records in backup");
      }
      saveRecords(records);
      if (parsed && parsed.activeSession) {
        saveActiveSession(parsed.activeSession);
      }
      render();
      alert(t("backup.importSuccess"));
    } catch (e) {
      console.error(e);
      alert(t("backup.importFail"));
    }
  };
  reader.readAsText(file, "utf-8");
}

function clearAllData() {
  if (!confirm(t("backup.clearConfirm"))) {
    return;
  }
  saveRecords([]);
  saveActiveSession(null);
  render();
  alert(t("backup.clearSuccess"));
}

function renderMonthChart(days, dailyMap) {
  const canvas = document.getElementById("monthChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const displayWidth = canvas.clientWidth || 400;
  const displayHeight = canvas.clientHeight || 220;
  const colors = getChartColors();
  canvas.classList.toggle("is-empty", !days.length);

  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, displayWidth, displayHeight);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, displayWidth, displayHeight);

  if (!days.length) {
    ctx.fillStyle = colors.empty;
    ctx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t("chart.noData"), displayWidth / 2, displayHeight / 2);
    return;
  }

  const padding = { top: 10, right: 10, bottom: 30, left: 40 };
  const innerWidth = displayWidth - padding.left - padding.right;
  const innerHeight = displayHeight - padding.top - padding.bottom;

  const valuesMs = days.map(d => dailyMap[d] || 0);
  const hasData = valuesMs.some(value => value > 0);
  canvas.classList.toggle("is-empty", !hasData);
  if (!hasData) {
    ctx.fillStyle = colors.empty;
    ctx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t("chart.noData"), displayWidth / 2, displayHeight / 2);
    chartHitboxes.monthChart = [];
    return;
  }
  const hoursArr = valuesMs.map(ms => ms / 3600000);
  const maxHours = Math.max(...hoursArr, 0);
  const useMinutes = maxHours < 1;
  const valueArr = useMinutes ? valuesMs.map(ms => ms / 60000) : hoursArr;
  const maxValue = Math.max(...valueArr, 1);
  const unitLabel = getUnitLabel(useMinutes, "axis");
  const unitShort = getUnitLabel(useMinutes, "short");

  // Y 轴
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + innerHeight);
  ctx.lineTo(padding.left + innerWidth, padding.top + innerHeight);
  ctx.stroke();

  // Y 轴刻度（0 和最大值）
  ctx.fillStyle = colors.text;
  ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("0", padding.left - 4, padding.top + innerHeight);
  const topLabel = useMinutes ? Math.round(maxValue).toString() : maxValue.toFixed(1);
  ctx.fillText(topLabel, padding.left - 4, padding.top);

  // 轴标签
  ctx.save();
  ctx.fillStyle = colors.text;
  ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(t("chart.xAxisDate"), padding.left + innerWidth / 2, padding.top + innerHeight + 18);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = colors.text;
  ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.translate(padding.left - 30, padding.top + innerHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(unitLabel, 0, 0);
  ctx.restore();

  // 柱子
  const count = days.length;
  const step = innerWidth / count;
  const barWidth = step * 0.6;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const bars = [];

  days.forEach((dateStr, index) => {
    const value = valueArr[index];
    const barHeight = (value / maxValue) * innerHeight;
    const x = padding.left + step * index + (step - barWidth) / 2;
    const y = padding.top + innerHeight - barHeight;

    ctx.fillStyle = "#90caf9";
    ctx.fillRect(x, y, barWidth, barHeight);

    // X 轴日期标签（显示日）
    const parts = dateStr.split("-");
    const day = parts[2] || dateStr;
    ctx.fillStyle = "#555";
    ctx.fillText(day, x + barWidth / 2, padding.top + innerHeight + 4);

    bars.push({
      type: "bar",
      x,
      y,
      width: barWidth,
      height: barHeight,
      label: dateStr,
      value,
      unit: unitShort,
      useMinutes
    });
  });

  chartHitboxes.monthChart = bars;
}

function renderTagChart(canvasId, labels, valuesMs, xLabel) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const displayWidth = canvas.clientWidth || 400;
  const displayHeight = canvas.clientHeight || 220;
  const colors = getChartColors();
  canvas.classList.toggle("is-empty", !labels.length);

  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, displayWidth, displayHeight);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, displayWidth, displayHeight);

  const mode = chartModes[canvasId] || "bar";

  const legendEl =
    canvasId === "tagDateChart"
      ? document.getElementById("tagDateLegend")
      : document.getElementById("tagMonthLegend");

  if (legendEl) {
    legendEl.innerHTML = "";
  }

  if (!labels.length) {
    ctx.fillStyle = colors.empty;
    ctx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t("chart.noTagData"), displayWidth / 2, displayHeight / 2);
    return;
  }

  const padding = { top: 10, right: 10, bottom: 50, left: 40 };
  const innerWidth = displayWidth - padding.left - padding.right;
  const innerHeight = displayHeight - padding.top - padding.bottom;

  const hoursArr = valuesMs.map(ms => ms / 3600000);
  const maxHours = Math.max(...hoursArr, 0);
  const useMinutes = maxHours < 1;
  const valueArr = useMinutes ? valuesMs.map(ms => ms / 60000) : hoursArr;
  const totalValue = valueArr.reduce((a, b) => a + b, 0);
  const maxValue = Math.max(...valueArr, 1);
  const unitLabel = getUnitLabel(useMinutes, "axis");
  const unitShort = getUnitLabel(useMinutes, "short");
  const xAxisLabel = xLabel || t("chart.xAxisTag");

  const items = [];

  if (legendEl && labels.length) {
    labels.forEach((label, index) => {
      const value = valueArr[index];
      const color = getTagColor(label);
      const div = document.createElement("div");
      div.className = "tag-legend-item";
      const colorBox = document.createElement("span");
      colorBox.className = "tag-legend-color";
      colorBox.style.backgroundColor = color;
      const text = document.createElement("span");
      const textValue = formatValueWithUnit(value, useMinutes, useMinutes ? 0 : 2);
      text.textContent = `${label || t("tag.unlabeled")}：${textValue}`;
      div.appendChild(colorBox);
      div.appendChild(text);
      legendEl.appendChild(div);
    });
  }

  if (mode === "bar") {
    ctx.strokeStyle = colors.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + innerHeight);
    ctx.lineTo(padding.left + innerWidth, padding.top + innerHeight);
    ctx.stroke();

    ctx.fillStyle = colors.text;
    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("0", padding.left - 4, padding.top + innerHeight);
    const topLabel = useMinutes ? Math.round(maxValue).toString() : maxValue.toFixed(1);
    ctx.fillText(topLabel, padding.left - 4, padding.top);

    ctx.save();
    ctx.fillStyle = colors.text;
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(xAxisLabel, padding.left + innerWidth / 2, padding.top + innerHeight + 22);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = colors.text;
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.translate(padding.left - 30, padding.top + innerHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(unitLabel, 0, 0);
    ctx.restore();

    const count = labels.length;
    const step = innerWidth / count;
    const barWidth = step * 0.6;

    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    labels.forEach((label, index) => {
      const value = valueArr[index];
      const barHeight = (value / maxValue) * innerHeight;
      const x = padding.left + step * index + (step - barWidth) / 2;
      const y = padding.top + innerHeight - barHeight;

      ctx.fillStyle = getTagColor(label);
      ctx.fillRect(x, y, barWidth, barHeight);

      ctx.fillStyle = colors.text;
      const text = limitTagDisplay(label);
      ctx.fillText(text, x + barWidth / 2, padding.top + innerHeight + 4);

      items.push({
        type: "bar",
        x,
        y,
        width: barWidth,
        height: barHeight,
        label,
        value,
        unit: unitShort,
        useMinutes
      });
    });
  } else {
    const cx = displayWidth / 2;
    const cy = padding.top + innerHeight / 2;
    const radius = Math.min(innerWidth, innerHeight) / 2 * 0.9;
    let startAngle = -Math.PI / 2;

    labels.forEach((label, index) => {
      const value = valueArr[index];
      const ratio = totalValue ? value / totalValue : 0;
      const angle = ratio * Math.PI * 2;
      const endAngle = startAngle + angle;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.fillStyle = getTagColor(label);
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fill();

      startAngle = endAngle;

      items.push({
        type: "slice",
        cx,
        cy,
        radius,
        startAngle: startAngle - angle,
        endAngle,
        label,
        value,
        unit: unitShort,
        useMinutes
      });
    });

    ctx.save();
    ctx.fillStyle = colors.text;
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(xAxisLabel, cx, padding.top + innerHeight + 22);
    ctx.restore();
  }

  chartHitboxes[canvasId] = items;
}

function renderCalendarView() {
  const grid = document.getElementById("calendarGrid");
  const legendEl = document.getElementById("calendarLegend");
  const summaryEl = document.getElementById("calendarSummary");
  const aiBox = document.getElementById("calendarAiSummary");
  const tbody = document.getElementById("calendarDateBody");
  if (!grid || !legendEl || !summaryEl || !aiBox || !tbody) return;

  const rangeBtns = document.querySelectorAll(".calendar-controls [data-range]");
  rangeBtns.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.range === calendarRangeMode);
  });
  const customBox = document.getElementById("calCustomBox");
  if (customBox) {
    customBox.style.display = calendarRangeMode === "custom" ? "flex" : "none";
  }
  const startInput = document.getElementById("calStart");
  const endInput = document.getElementById("calEnd");
  if (startInput && calendarCustomStart) startInput.value = calendarCustomStart;
  if (endInput && calendarCustomEnd) endInput.value = calendarCustomEnd;

  const now = new Date();
  let startDate;
  let endDate;

  if (calendarRangeMode === "month") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (calendarRangeMode === "30d") {
    endDate = new Date(now);
    startDate = new Date(now.getTime() - 29 * 86400000);
  } else {
    startDate = calendarCustomStart ? new Date(calendarCustomStart) : new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = calendarCustomEnd ? new Date(calendarCustomEnd) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
    if (startDate > endDate) {
      const tmp = startDate;
      startDate = endDate;
      endDate = tmp;
    }
  }

  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  const records = loadRecords();
  const dayTagMap = {};
  const dailyMap = {};
  records.forEach(r => {
    if (!r.date) return;
    if (r.date >= startStr && r.date <= endStr) {
      dailyMap[r.date] = (dailyMap[r.date] || 0) + (r.durationMs || 0);
      const tagLabel = (r.tag && r.tag.trim()) || t("tag.unlabeled");
      if (!dayTagMap[r.date]) dayTagMap[r.date] = {};
      dayTagMap[r.date][tagLabel] = (dayTagMap[r.date][tagLabel] || 0) + (r.durationMs || 0);
    }
  });
  const active = loadActiveSession();
  Object.entries(getActiveDurationsByDate(active)).forEach(([date, entry]) => {
    if (date < startStr || date > endStr) return;
    dailyMap[date] = (dailyMap[date] || 0) + entry.durationMs;
    const tagLabel = t("tag.unlabeled");
    if (!dayTagMap[date]) dayTagMap[date] = {};
    dayTagMap[date][tagLabel] = (dayTagMap[date][tagLabel] || 0) + entry.durationMs;
  });

  const days = [];
  for (let d = new Date(startDate); d <= endDate; d = new Date(d.getTime() + 86400000)) {
    days.push(formatDate(d));
  }

  const values = days.map(d => dailyMap[d] || 0);
  const hoursArr = values.map(ms => ms / 3600000);
  const maxHours = Math.max(...hoursArr, 0);
  const useMinutes = maxHours < 1;
  const valueArr = useMinutes ? values.map(ms => ms / 60000) : hoursArr;
  const maxValue = Math.max(...valueArr, 1);

  function colorFor(v) {
    if (!v) return "#f1f1f1";
    const ratio = Math.min(1, v / maxValue);
    const palette = ["#dceefc", "#b7dbf6", "#90c7f0", "#5aa6e4", "#2c7ecf"];
    const idx = Math.min(palette.length - 1, Math.floor(ratio * palette.length));
    return palette[idx];
  }

  grid.innerHTML = "";
  const weekdayLabels = currentLang === "en"
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : ["日", "一", "二", "三", "四", "五", "六"];
  weekdayLabels.forEach(lab => {
    const header = document.createElement("div");
    header.className = "calendar-cell empty";
    header.textContent = lab;
    header.style.fontWeight = "600";
    grid.appendChild(header);
  });

  const firstDay = new Date(startDate);
  const offset = firstDay.getDay();
  for (let i = 0; i < offset; i += 1) {
    const empty = document.createElement("div");
    empty.className = "calendar-cell empty";
    grid.appendChild(empty);
  }

  days.forEach((dateStr, idx) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-cell";
    const topRow = document.createElement("div");
    topRow.className = "calendar-top-row";
    const dayNum = document.createElement("div");
    dayNum.className = "day-number";
    dayNum.textContent = dateStr.split("-")[2];
    const tagWrap = document.createElement("div");
    tagWrap.className = "calendar-tags dots-only";
    const tagsMap = dayTagMap[dateStr] || {};
    let tagsSorted = Object.entries(tagsMap).sort((a, b) => (b[1] || 0) - (a[1] || 0));
    if (calendarTagFilter) {
      tagsSorted = tagsSorted.filter(([label]) => label === calendarTagFilter);
    }
    const maxChips = 6;
    tagsSorted.slice(0, maxChips).forEach(([label, ms]) => {
      const chip = document.createElement("span");
      chip.className = "calendar-tag-chip";
      chip.title = `${label}: ${formatDuration(ms)}`;
      const dot = document.createElement("span");
      dot.className = "calendar-tag-dot";
      dot.style.background = getTagColor(label);
      chip.appendChild(dot);
      tagWrap.appendChild(chip);
    });
    if (!calendarTagFilter && tagsSorted.length > maxChips) {
      const more = document.createElement("span");
      more.className = "calendar-tag-chip more";
      more.textContent = `+${tagsSorted.length - maxChips}`;
      tagWrap.appendChild(more);
    }
    topRow.appendChild(dayNum);
    topRow.appendChild(tagWrap);
    const val = valueArr[idx];
    const valEl = document.createElement("div");
    valEl.className = "day-value";
    valEl.textContent =
      val > 0
        ? val.toFixed(useMinutes ? 0 : 1) + " " + getUnitLabel(useMinutes, "short")
        : "-";
    cell.appendChild(topRow);
    cell.appendChild(valEl);
    cell.style.background = colorFor(val);
    cell.dataset.date = dateStr;
    cell.setAttribute(
      "aria-label",
      `${dateStr}，${val > 0 ? formatDuration(values[idx]) : t("chart.noData")}`
    );
    if (calendarSelectedDate === dateStr) {
      cell.classList.add("selected");
    }
    cell.addEventListener("click", () => {
      calendarSelectedDate = dateStr;
      renderCalendarDetails(dateStr);
      renderCalendarView(); // to refresh selection highlight
    });
    grid.appendChild(cell);
  });

  if (legendEl) {
    legendEl.innerHTML = "";
    const legendLabel = currentLang === "en" ? "Low" : "低";
    const legendLabelHi = currentLang === "en" ? "High" : "高";
    const band = document.createElement("div");
    band.className = "legend-band";
    const spanLow = document.createElement("span");
    spanLow.textContent = legendLabel;
    const gradient = document.createElement("span");
    gradient.className = "legend-gradient";
    const spanHigh = document.createElement("span");
    spanHigh.textContent = legendLabelHi;
    band.appendChild(spanLow);
    band.appendChild(gradient);
    band.appendChild(spanHigh);
    legendEl.appendChild(band);

    const tagLegendWrapper = document.createElement("div");
    tagLegendWrapper.className = "calendar-tag-legend";
    const unlabeled = t("tag.unlabeled");
    const tagTotals = {};
    Object.entries(dayTagMap).forEach(([, tagObj]) => {
      Object.entries(tagObj).forEach(([tag, ms]) => {
        if (tag === unlabeled) return;
        tagTotals[tag] = (tagTotals[tag] || 0) + ms;
      });
    });
    const tagEntries = Object.entries(tagTotals).sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, 6);
    if (tagEntries.length) {
      const label = document.createElement("span");
      label.className = "tag-legend-label";
      label.textContent = currentLang === "en" ? "Tags:" : "Tag：";
      tagLegendWrapper.appendChild(label);
      tagEntries.forEach(([tag, ms]) => {
        const item = document.createElement("span");
        item.className = "legend-tag-item";
        item.dataset.tag = tag;
        if (calendarTagFilter === tag) {
          item.classList.add("active");
        }
        const dot = document.createElement("span");
        dot.className = "calendar-tag-dot";
        dot.style.background = getTagColor(tag);
        const text = document.createElement("span");
        text.textContent = `${limitTagDisplay(tag)}`;
        item.appendChild(dot);
        item.appendChild(text);
        tagLegendWrapper.appendChild(item);
      });
      legendEl.appendChild(tagLegendWrapper);
      tagLegendWrapper.addEventListener("click", event => {
        const target = event.target.closest(".legend-tag-item");
        if (!target) return;
        const tag = target.dataset.tag;
        if (!tag) return;
        calendarTagFilter = calendarTagFilter === tag ? null : tag;
        renderCalendarView();
      });
    }
  }

  const subtitle = document.getElementById("heatmapSubtitle");
  if (subtitle) {
    const text =
      calendarRangeMode === "month"
        ? (currentLang === "en" ? "This month" : "本月")
        : calendarRangeMode === "30d"
          ? (currentLang === "en" ? "Last 30 days" : "最近 30 天")
          : `${startStr} - ${endStr}`;
    subtitle.textContent = text;
  }

  if (!calendarSelectedDate || !days.includes(calendarSelectedDate)) {
    if (days.length) {
      calendarSelectedDate = days[days.length - 1];
    } else {
      calendarSelectedDate = "";
    }
  }
  renderCalendarDetails(calendarSelectedDate);
}

function renderCalendarDetails(dateStr) {
  const summaryEl = document.getElementById("calendarSummary");
  const aiBox = document.getElementById("calendarAiSummary");
  const tbody = document.getElementById("calendarDateBody");
  if (!summaryEl || !aiBox || !tbody) return;

  if (!dateStr) {
    summaryEl.textContent = t("filters.pickDate");
    aiBox.textContent = "";
    tbody.innerHTML = "";
    renderTagChart("tagDateChart", [], [], t("chart.xAxisTagDay"));
    return;
  }

  const records = loadRecords();
  const list = records.filter(r => r.date === dateStr);
  const active = loadActiveSession();
  const activeByDate = getActiveDurationsByDate(active);
  const activeEntry = activeByDate[dateStr];
  const totalMs = sumDuration(list) + (activeEntry?.durationMs || 0);
  summaryEl.textContent = t("filters.dateSummary", {
    date: dateStr,
    total: formatDuration(totalMs),
    count: list.length + (activeEntry ? 1 : 0)
  });

  tbody.innerHTML = "";
  list.forEach(r => {
    const tr = document.createElement("tr");
    const tdStart = document.createElement("td");
    const tdEnd = document.createElement("td");
    const tdDur = document.createElement("td");
    const tdTag = document.createElement("td");
    const tdNote = document.createElement("td");
    const tdActions = document.createElement("td");

    tdStart.textContent = r.startTimeText || (r.startTime ? formatTime(new Date(r.startTime)) : "");
    tdEnd.textContent = r.endTimeText || (r.endTime ? formatTime(new Date(r.endTime)) : "");
    tdDur.textContent = formatDuration(r.durationMs || 0);
    tdTag.textContent = r.tag || "";
    tdNote.textContent = r.note || "";

    tr.appendChild(tdStart);
    tr.appendChild(tdEnd);
    tr.appendChild(tdDur);
    tr.appendChild(tdTag);
    tr.appendChild(tdNote);
    tdActions.className = "record-actions";
    appendRecordActions(tdActions, r);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });

  if (activeEntry) {
    const tr = document.createElement("tr");
    [
      formatTime(new Date(activeEntry.firstStartMs)),
      currentLang === "en" ? "Now" : "当前",
      formatDuration(activeEntry.durationMs),
      "",
      currentLang === "en" ? "In progress" : "计时中"
    ].forEach(value => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });
    tr.appendChild(document.createElement("td"));
    tbody.appendChild(tr);
  }

  const cached = aiSummaryCache[dateStr];
  aiBox.textContent = cached
    ? cached
    : currentLang === "en"
      ? "No AI summary for this date."
      : "该日期暂无 AI 总结。";
}

function renderFilterByDate() {
  const input = document.getElementById("filterDate");
  const summaryEl = document.getElementById("filterDateSummary");
  const aiBox = document.getElementById("filterDateAiSummary");
  const tbody = document.getElementById("filterDateBody");
  if (!input || !summaryEl || !tbody) return;

  const dateStr = input.value;
  if (!dateStr) {
    summaryEl.textContent = t("filters.pickDate");
    tbody.innerHTML = "";
    renderTagChart("tagDateChart", [], [], t("chart.xAxisTagDay"));
    if (aiBox) aiBox.textContent = "";
    return;
  }

  const records = loadRecords();
  const list = records.filter(r => r.date === dateStr);
  const activeEntry = getActiveDurationsByDate(loadActiveSession())[dateStr];
  const totalMs = sumDuration(list) + (activeEntry?.durationMs || 0);

  summaryEl.textContent = t("filters.dateSummary", {
    date: dateStr,
    total: formatDuration(totalMs),
    count: list.length + (activeEntry ? 1 : 0)
  });

  tbody.innerHTML = "";
  list.forEach(r => {
    const tr = document.createElement("tr");
    const tdStart = document.createElement("td");
    const tdEnd = document.createElement("td");
    const tdDur = document.createElement("td");
    const tdTag = document.createElement("td");
    const tdNote = document.createElement("td");
    const tdActions = document.createElement("td");
    tdStart.textContent = r.startTimeText;
    tdEnd.textContent = r.endTimeText;
    tdDur.textContent = formatDuration(r.durationMs);
    tdTag.textContent = r.tag || "";
    tdNote.textContent = r.note || "";
    tr.appendChild(tdStart);
    tr.appendChild(tdEnd);
    tr.appendChild(tdDur);
    tr.appendChild(tdTag);
    tr.appendChild(tdNote);
    tdActions.className = "record-actions";
    appendRecordActions(tdActions, r);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
  if (activeEntry) {
    const tr = document.createElement("tr");
    [
      formatTime(new Date(activeEntry.firstStartMs)),
      currentLang === "en" ? "Now" : "当前",
      formatDuration(activeEntry.durationMs),
      "",
      currentLang === "en" ? "In progress" : "计时中"
    ].forEach(value => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });
    tr.appendChild(document.createElement("td"));
    tbody.appendChild(tr);
  }

  const tagMap = {};
  list.forEach(r => {
    const tag = (r.tag && r.tag.trim()) || t("tag.unlabeled");
    if (!tagMap[tag]) tagMap[tag] = 0;
    tagMap[tag] += r.durationMs || 0;
  });
  const tags = Object.keys(tagMap);
  const values = tags.map(t => tagMap[t]);
  renderTagChart("tagDateChart", tags, values, t("chart.xAxisTagDay"));

  if (aiBox) {
    const cached = aiSummaryCache[dateStr];
    if (cached) {
      aiBox.textContent = cached;
    } else {
      aiBox.textContent =
        currentLang === "en" ? "No AI summary for this date." : "该日期暂无 AI 总结。";
    }
  }
}

function renderFilterByMonth() {
  const input = document.getElementById("filterMonth");
  const summaryEl = document.getElementById("filterMonthSummary");
  const tbody = document.getElementById("filterMonthBody");
  if (!input || !summaryEl || !tbody) return;

  const monthStr = input.value;
  if (!monthStr) {
    summaryEl.textContent = t("filters.pickMonth");
    tbody.innerHTML = "";
    renderMonthChart([], {});
    renderTagChart("tagMonthChart", [], [], t("chart.xAxisTagMonth"));
    return;
  }

  const records = loadRecords();
  const list = records.filter(r => r.date && r.date.startsWith(monthStr));
  const totalMs = sumDuration(list);

  const dailyMap = {};
  list.forEach(r => {
    if (!dailyMap[r.date]) {
      dailyMap[r.date] = 0;
    }
    dailyMap[r.date] += r.durationMs || 0;
  });

  const days = Object.keys(dailyMap).sort();
  summaryEl.textContent = t("filters.monthSummary", {
    month: monthStr,
    total: formatDuration(totalMs),
    days: days.length
  });

  tbody.innerHTML = "";
  days.forEach(dateStr => {
    const tr = document.createElement("tr");
    const tdDate = document.createElement("td");
    const tdDur = document.createElement("td");
    tdDate.textContent = dateStr;
    tdDur.textContent = formatDuration(dailyMap[dateStr]);
    tr.appendChild(tdDate);
    tr.appendChild(tdDur);
    tbody.appendChild(tr);
  });

  renderMonthChart(days, dailyMap);

  const tagMap = {};
  list.forEach(r => {
    const tag = (r.tag && r.tag.trim()) || t("tag.unlabeled");
    if (!tagMap[tag]) tagMap[tag] = 0;
    tagMap[tag] += r.durationMs || 0;
  });
  const tags = Object.keys(tagMap);
  const values = tags.map(t => tagMap[t]);
  renderTagChart("tagMonthChart", tags, values, t("chart.xAxisTagMonth"));
}

function render() {
  if (!modulePrefs) {
    loadModulePrefs();
  }
  if (!bgmSettings) {
    loadBgmSettings();
  }
  applyModuleVisibility();
  const now = new Date();
  const todayStr = formatDate(now);
  const todayDisplay = formatDisplayDate(now);

  const todayText = document.getElementById("todayText");
  const nowTime = document.getElementById("nowTime");
  todayText.textContent = todayDisplay;
  nowTime.textContent = formatTime(now);

  const records = loadRecords();
  const todayRecords = getTodayRecords(records, todayStr);
  let todayTotalMs = sumDuration(todayRecords);
  cachedTags = Array.from(
    new Set(
      records
        .map(r => (r.tag || "").trim())
        .filter(Boolean)
    )
  );

  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthRecords = getMonthRecords(records, year, month);
  let monthTotalMs = sumDuration(monthRecords);

  const activeByDateForTotals = getActiveDurationsByDate(loadActiveSession(), now.getTime());
  todayTotalMs += activeByDateForTotals[todayStr]?.durationMs || 0;
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  Object.entries(activeByDateForTotals).forEach(([date, entry]) => {
    if (date.startsWith(monthPrefix)) monthTotalMs += entry.durationMs;
  });

  document.getElementById("todayTotal").textContent = formatDuration(todayTotalMs);
  document.getElementById("monthTotal").textContent = formatDuration(monthTotalMs);

  const tbody = document.getElementById("todayRecordsBody");
  tbody.innerHTML = "";
  const todaySorted = [...todayRecords];
  todaySorted.sort((a, b) => {
    if (todaySortField === "duration") {
      const av = a.durationMs || 0;
      const bv = b.durationMs || 0;
      return todaySortAsc ? av - bv : bv - av;
    }
    const as = todaySortField === "start" ? (a.startTime || "") : (a.endTime || "");
    const bs = todaySortField === "start" ? (b.startTime || "") : (b.endTime || "");
    return todaySortAsc ? as.localeCompare(bs) : bs.localeCompare(as);
  });
  todaySorted.forEach(r => {
    const tr = document.createElement("tr");
    const tdStart = document.createElement("td");
    const tdEnd = document.createElement("td");
    const tdDur = document.createElement("td");
    const tdTag = document.createElement("td");
    const tdNote = document.createElement("td");
    const tdActions = document.createElement("td");
    tdStart.textContent = r.startTimeText;
    tdEnd.textContent = r.endTimeText;
    tdDur.textContent = formatDuration(r.durationMs);
    tdTag.textContent = r.tag || "";
    tdNote.textContent = r.note || "";
    tr.appendChild(tdStart);
    tr.appendChild(tdEnd);
    tr.appendChild(tdDur);
    tr.appendChild(tdTag);
    tr.appendChild(tdNote);
    tdActions.className = "record-actions";
    appendRecordActions(tdActions, r);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });

  const startHeader = document.getElementById("todayStartHeader");
  const endHeader = document.getElementById("todayEndHeader");
  const durHeader = document.getElementById("todayDurationHeader");
  if (startHeader) startHeader.textContent = t("table.startTime");
  if (endHeader) endHeader.textContent = t("table.endTime");
  if (durHeader) durHeader.textContent = t("table.duration");
  const arrow = todaySortAsc ? " ↑" : " ↓";
  if (todaySortField === "start" && startHeader) {
    startHeader.textContent = `${t("table.startTime")}${arrow}`;
  } else if (todaySortField === "end" && endHeader) {
    endHeader.textContent = `${t("table.endTime")}${arrow}`;
  } else if (todaySortField === "duration" && durHeader) {
    durHeader.textContent = `${t("table.duration")}${arrow}`;
  }

  const monthTagTbody = document.getElementById("monthTagRecordsBody");
  if (monthTagTbody) {
    const tagMap = {};
    monthRecords.forEach(r => {
      const tag = (r.tag && r.tag.trim()) || t("tag.unlabeled");
      if (!tagMap[tag]) tagMap[tag] = 0;
      tagMap[tag] += r.durationMs || 0;
    });
    const tags = Object.keys(tagMap).sort((a, b) => {
      const av = tagMap[a] || 0;
      const bv = tagMap[b] || 0;
      return monthTagSortAsc ? av - bv : bv - av;
    });
    monthTagTbody.innerHTML = "";
    tags.forEach(tag => {
      const tr = document.createElement("tr");
      const tdTag = document.createElement("td");
      const tdDur = document.createElement("td");
      tdTag.textContent = tag;
      tdDur.textContent = formatDuration(tagMap[tag]);
      tr.appendChild(tdTag);
      tr.appendChild(tdDur);
      monthTagTbody.appendChild(tr);
    });

    const monthHeader = document.getElementById("monthTagDurationHeader");
    if (monthHeader) {
      monthHeader.textContent = `${t("table.totalDuration")} ${monthTagSortAsc ? "↑" : "↓"}`;
    }
  }

  const monthTotalsBody = document.getElementById("monthTotalsBody");
  if (monthTotalsBody) {
    const monthlyMap = {};
    records.forEach(r => {
      if (!r.date) return;
      const key = r.date.slice(0, 7);
      monthlyMap[key] = (monthlyMap[key] || 0) + (r.durationMs || 0);
    });
    Object.entries(activeByDateForTotals).forEach(([date, entry]) => {
      const key = date.slice(0, 7);
      monthlyMap[key] = (monthlyMap[key] || 0) + entry.durationMs;
    });
    const months = Object.keys(monthlyMap).sort().reverse();
    monthTotalsBody.innerHTML = "";
    months.forEach(key => {
      const tr = document.createElement("tr");
      const tdMonth = document.createElement("td");
      const tdDur = document.createElement("td");
      tdMonth.textContent = key;
      tdDur.textContent = formatDuration(monthlyMap[key]);
      tr.appendChild(tdMonth);
      tr.appendChild(tdDur);
      monthTotalsBody.appendChild(tr);
    });
  }

  // 预测是记录数据的派生结果；即使当前停留在统计页，记录变更后也要刷新，
  // 这样切回主页时不会看到旧的预计时长。
  if (modulePrefs.homeForecast) {
    renderForecast();
  }

  const active = loadActiveSession();
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const sessionStatus = document.getElementById("sessionStatus");

  if (active) {
    if (active.state === "paused") {
      if (startBtn) startBtn.disabled = false;
      if (pauseBtn) pauseBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      const totalMs = getActiveElapsedMs(active);
      sessionStatus.textContent = t("status.paused");
      const sessionDurationEl = document.getElementById("sessionDuration");
      if (sessionDurationEl) {
        sessionDurationEl.textContent = t("status.sessionDuration", {
          duration: formatDuration(totalMs)
        });
      }
    } else {
      if (startBtn) startBtn.disabled = true;
      if (pauseBtn) pauseBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = false;
      const startDate = active.start ? new Date(active.start) : null;
      if (startDate) {
        sessionStatus.textContent = t("status.runningFrom", {
          time: formatTime(startDate)
        });
      } else {
        sessionStatus.textContent = t("status.running");
      }
    }
  } else {
    if (startBtn) startBtn.disabled = false;
    if (pauseBtn) pauseBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;
    sessionStatus.textContent = t("status.idle");
    document.getElementById("sessionDuration").textContent = "";
  }

  if (currentPage === "stats") {
    if (modulePrefs.statsDate) {
      renderFilterByDate();
      renderFilterByMonth();
    }
    if (modulePrefs.statsCalendar) renderCalendarView();
  }

  const cachedSummary = aiSummaryCache[todayStr];
  if (cachedSummary && document.getElementById("aiSummaryBox")) {
    document.getElementById("aiSummaryBox").textContent = cachedSummary;
    updateAiStatus(t("ai.statusCached"));
  } else {
    updateAiStatus(t(aiSettings.apiKey ? "ai.statusReady" : "ai.statusNoKey"));
  }

  const heatmapSubtitle = document.getElementById("heatmapSubtitle");
  if (heatmapSubtitle) {
    heatmapSubtitle.textContent = t("heatmap.subtitle");
  }
}

function renderForecast() {
  const canvas = document.getElementById("forecastChart");
  const totalEl = document.getElementById("forecastTotal");
  const noteEl = document.getElementById("forecastNote");
  if (!canvas || !totalEl || !noteEl) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const daysInMonth = getDaysInMonth(year, month);
  const todayDay = now.getDate();
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  const records = loadRecords();
  const dailyMap = {};
  records.forEach(r => {
    if (!r.date || !r.date.startsWith(monthKey)) return;
    dailyMap[r.date] = (dailyMap[r.date] || 0) + (r.durationMs || 0);
  });

  Object.entries(getActiveDurationsByDate(loadActiveSession(), now.getTime())).forEach(([date, entry]) => {
    if (date.startsWith(monthKey)) {
      dailyMap[date] = (dailyMap[date] || 0) + entry.durationMs;
    }
  });

  let sumActual = 0;
  for (let d = 1; d <= todayDay; d += 1) {
    const key = `${monthKey}-${String(d).padStart(2, "0")}`;
    sumActual += dailyMap[key] || 0;
  }

  if (sumActual <= 0) {
    canvas.classList.add("is-empty");
    totalEl.textContent = t("forecast.noData");
    noteEl.textContent = t("forecast.noDataNote");
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = canvas.clientWidth || 400;
    const displayHeight = canvas.clientHeight || 220;
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    const styles = getComputedStyle(document.body);
    const chartBg = styles.getPropertyValue("--card-bg").trim() || "#fafafa";
    ctx.fillStyle = chartBg;
    ctx.fillRect(0, 0, displayWidth, displayHeight);
    ctx.fillStyle = "#999";
    ctx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t("chart.noData"), displayWidth / 2, displayHeight / 2);
    chartHitboxes.forecastChart = [];
    return;
  }

  canvas.classList.remove("is-empty");

  const avgDailyMs = sumActual / todayDay;
  const predictedTotalMs = avgDailyMs * daysInMonth;
  totalEl.textContent = t("forecast.estimated", {
    duration: formatDuration(predictedTotalMs)
  });
  noteEl.textContent = t("forecast.note", {
    days: todayDay,
    avg: formatAvgDuration(avgDailyMs)
  });

  const cumulative = [];
  let running = 0;
  for (let d = 1; d <= daysInMonth; d += 1) {
    if (d <= todayDay) {
      const key = `${monthKey}-${String(d).padStart(2, "0")}`;
      running += dailyMap[key] || 0;
    } else {
      running += avgDailyMs;
    }
    cumulative.push(running);
  }

  const hoursArr = cumulative.map(ms => ms / 3600000);
  const maxHours = Math.max(...hoursArr, 0);
  const useMinutes = maxHours < 1;
  const valueArr = useMinutes ? cumulative.map(ms => ms / 60000) : hoursArr;
  const maxValue = Math.max(...valueArr, 1);
  const unitLabel = getUnitLabel(useMinutes, "axis");
  const unitShort = getUnitLabel(useMinutes, "short");

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const displayWidth = canvas.clientWidth || 400;
  const displayHeight = canvas.clientHeight || 220;
  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, displayWidth, displayHeight);
  const styles = getComputedStyle(document.body);
  const chartBg = styles.getPropertyValue("--card-bg").trim() || "#fafafa";
  const axisColor = styles.getPropertyValue("--border-color").trim() || "#ccc";
  const textColor = styles.getPropertyValue("--muted-color").trim() || "#666";
  ctx.fillStyle = chartBg;
  ctx.fillRect(0, 0, displayWidth, displayHeight);

  const padding = { top: 16, right: 10, bottom: 30, left: 30 };
  const innerWidth = displayWidth - padding.left - padding.right;
  const innerHeight = displayHeight - padding.top - padding.bottom;

  const points = valueArr.map((value, i) => {
    const x =
      padding.left +
      (i / Math.max(1, valueArr.length - 1)) * innerWidth;
    const y = padding.top + innerHeight - (value / maxValue) * innerHeight;
    return { x, y };
  });

  const yTicks = 4;
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + innerHeight);
  ctx.lineTo(padding.left + innerWidth, padding.top + innerHeight);
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= yTicks; i += 1) {
    const ratio = i / yTicks;
    const value = maxValue * ratio;
    const y = padding.top + innerHeight - ratio * innerHeight;
    const label = useMinutes ? Math.round(value).toString() : value.toFixed(1);
    ctx.fillText(label, padding.left - 4, y);
    if (i > 0 && i < yTicks) {
      ctx.strokeStyle = axisColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + innerWidth, y);
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.fillStyle = textColor;
  ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(t("chart.xAxisDate"), padding.left + innerWidth / 2, padding.top + innerHeight + 18);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = textColor;
  ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.translate(padding.left - 30, padding.top + innerHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(unitLabel, 0, 0);
  ctx.restore();

  const todayIndex = Math.min(todayDay - 1, points.length - 1);

  function drawSmoothLine(startIndex, endIndex) {
    if (endIndex <= startIndex) return;
    ctx.beginPath();
    ctx.moveTo(points[startIndex].x, points[startIndex].y);
    for (let i = startIndex; i < endIndex; i += 1) {
      const p = points[i];
      const next = points[i + 1];
      const midX = (p.x + next.x) / 2;
      const midY = (p.y + next.y) / 2;
      ctx.quadraticCurveTo(p.x, p.y, midX, midY);
    }
    ctx.quadraticCurveTo(
      points[endIndex].x,
      points[endIndex].y,
      points[endIndex].x,
      points[endIndex].y
    );
    ctx.stroke();
  }

  ctx.strokeStyle = "#1976d2";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  drawSmoothLine(0, todayIndex);

  ctx.strokeStyle = "#90a4ae";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  drawSmoothLine(todayIndex, points.length - 1);
  ctx.setLineDash([]);

  const todayPoint = points[todayIndex];
  if (todayPoint) {
    ctx.fillStyle = "#ff7043";
    ctx.beginPath();
    ctx.arc(todayPoint.x, todayPoint.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  chartHitboxes.forecastChart = points.map((p, i) => ({
    x: p.x,
    y: p.y,
    label: `${monthKey}-${String(i + 1).padStart(2, "0")}`,
    value: valueArr[i],
    unit: unitShort,
    useMinutes,
    predicted: i > todayIndex
  }));
}

function setupTimers() {
  let lastSummaryMinute = null;
  let lastDate = null;

  const updateLiveTotals = (now, active) => {
    const todayStr = formatDate(now);
    const records = loadRecords();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    let todayTotalMs = sumDuration(getTodayRecords(records, todayStr));
    let monthTotalMs = sumDuration(getMonthRecords(records, year, month));

    const activeByDate = getActiveDurationsByDate(active, now.getTime());
    todayTotalMs += activeByDate[todayStr]?.durationMs || 0;
    const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
    Object.entries(activeByDate).forEach(([date, entry]) => {
      if (date.startsWith(monthPrefix)) monthTotalMs += entry.durationMs;
    });

    const todayTotalEl = document.getElementById("todayTotal");
    const monthTotalEl = document.getElementById("monthTotal");
    if (todayTotalEl) todayTotalEl.textContent = formatDuration(todayTotalMs);
    if (monthTotalEl) monthTotalEl.textContent = formatDuration(monthTotalMs);
  };

  const tick = () => {
    const now = new Date();
    const nowTime = document.getElementById("nowTime");
    if (nowTime) {
      nowTime.textContent = formatTime(now);
    }

    const active = loadActiveSession();
    const durationEl = document.getElementById("sessionDuration");
    const activeTotalMs = getActiveElapsedMs(active, now.getTime());
    if (active) {
      if (durationEl) {
        durationEl.textContent = t("status.sessionDuration", {
          duration: formatDuration(activeTotalMs)
        });
      }
      if (!active.warnedOverLimit && activeTotalMs > MAX_SESSION_MS) {
        alert(t("alert.overLimit"));
        active.warnedOverLimit = true;
        saveActiveSession(active);
      }
    }

    // 时长显示精确到分钟，因此统计和画布只需每分钟刷新一次，避免每秒重绘所有图表。
    const dateKey = formatDate(now);
    const minuteKey = `${dateKey}-${now.getHours()}-${now.getMinutes()}`;
    if (dateKey !== lastDate) {
      lastDate = dateKey;
      lastSummaryMinute = minuteKey;
      render();
    } else if (minuteKey !== lastSummaryMinute) {
      lastSummaryMinute = minuteKey;
      updateLiveTotals(now, active);
      if (currentPage === "home" && modulePrefs?.homeForecast) renderForecast();
    }
  };

  tick();
  setInterval(tick, 1000);
}

function setupEvents() {
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const filterDateInput = document.getElementById("filterDate");
  const filterDateBtn = document.getElementById("filterDateBtn");
  const filterMonthInput = document.getElementById("filterMonth");
  const filterMonthBtn = document.getElementById("filterMonthBtn");
  const tagInput = document.getElementById("tagInput");
  const noteInput = document.getElementById("noteInput");
  const toggleDateBtn = document.getElementById("toggleDateSection");
  const dateGroup = document.querySelector('.filter-group[data-section="date-month"]');
  const tagDateBarBtn = document.getElementById("tagDateBarBtn");
  const tagDatePieBtn = document.getElementById("tagDatePieBtn");
  const tagMonthBarBtn = document.getElementById("tagMonthBarBtn");
  const tagMonthPieBtn = document.getElementById("tagMonthPieBtn");
  const monthTagDurationHeader = document.getElementById("monthTagDurationHeader");
  const todayStartHeader = document.getElementById("todayStartHeader");
  const todayEndHeader = document.getElementById("todayEndHeader");
  const todayDurationHeader = document.getElementById("todayDurationHeader");
  const toggleTodayRecordsBtn = document.getElementById("toggleTodayRecords");
  const toggleMonthTagRecordsBtn = document.getElementById("toggleMonthTagRecords");
  const todayRecordsSection = document.querySelector('.records.collapsible[data-section="todayRecords"]');
  const monthTagRecordsSection = document.querySelector('.records.collapsible[data-section="monthTagRecords"]');
  const toggleMonthTotalsBtn = document.getElementById("toggleMonthTotals");
  const monthTotalsSection = document.querySelector('.records.collapsible[data-section="monthTotals"]');
  const exportDataBtn = document.getElementById("exportDataBtn");
  const importDataBtn = document.getElementById("importDataBtn");
  const importFileInput = document.getElementById("importFileInput");
  const clearDataBtn = document.getElementById("clearDataBtn");
  const todayRecordsBody = document.getElementById("todayRecordsBody");
  const filterDateBody = document.getElementById("filterDateBody");
  const calendarDateBody = document.getElementById("calendarDateBody");
  const editDialog = document.getElementById("editDialog");
  const editDialogTime = document.getElementById("editDialogTime");
  const editStartTimeInput = document.getElementById("editStartTimeInput");
  const editEndTimeInput = document.getElementById("editEndTimeInput");
  const editTagInput = document.getElementById("editTagInput");
  const editNoteInput = document.getElementById("editNoteInput");
  const editSaveBtn = document.getElementById("editSaveBtn");
  const editCancelBtn = document.getElementById("editCancelBtn");
  const deleteDialog = document.getElementById("deleteDialog");
  const deleteDialogMessage = document.getElementById("deleteDialogMessage");
  const deleteCancelBtn = document.getElementById("deleteCancelBtn");
  const deleteConfirmBtn = document.getElementById("deleteConfirmBtn");
  const tagSuggestions = document.getElementById("tagSuggestions");
  const editTagSuggestions = document.getElementById("editTagSuggestions");
  const tagChip = document.getElementById("tagChip");
  const tagChipText = document.getElementById("tagChipText");
  const tagChipClear = document.getElementById("tagChipClear");
  const editTagChip = document.getElementById("editTagChip");
  const editTagChipText = document.getElementById("editTagChipText");
  const editTagChipClear = document.getElementById("editTagChipClear");
  const workspaceSelect = document.getElementById("workspaceSelect");
  const workspaceNameInput = document.getElementById("workspaceNameInput");
  const workspaceAddBtn = document.getElementById("workspaceAddBtn");

  function applyTagLimit(inputEl) {
    if (!inputEl) return;
    inputEl.addEventListener("input", () => {
      const raw = inputEl.value;
      let units = 0;
      let result = "";
      for (const ch of raw) {
        const code = ch.codePointAt(0);
        const isAscii = code <= 0x7f;
        const add = isAscii ? 1 : 2;
        if (units + add > 10) break;
        units += add;
        result += ch;
      }
      if (result !== raw) {
        inputEl.value = result;
      }
    });
  }

  applyTagLimit(tagInput);
  applyTagLimit(editTagInput);

  function syncChipWithInput(inputEl, chipEl, chipTextEl) {
    if (!inputEl || !chipEl || !chipTextEl) return;
    const value = inputEl.value.trim();
    const wrapper = inputEl.closest(".tag-input-wrapper");
    if (value) {
      chipTextEl.textContent = value;
      chipEl.style.display = "inline-block";
      inputEl.classList.add("tag-input-hidden");
      if (wrapper) {
        wrapper.classList.add("has-chip");
        wrapper.style.flex = "0 0 auto";
        wrapper.style.width = "auto";
      }
    } else {
      chipEl.style.display = "none";
      inputEl.classList.remove("tag-input-hidden");
      if (wrapper) {
        wrapper.classList.remove("has-chip");
        wrapper.style.flex = "";
        wrapper.style.width = "";
      }
    }
  }

  function updateTagSuggestionsFor(inputEl, containerEl) {
    if (!inputEl || !containerEl) return;
    const q = inputEl.value.trim().toLowerCase();
    const list = cachedTags
      .filter(t => !q || t.toLowerCase().includes(q))
      .slice(0, 8);
    containerEl.innerHTML = "";
    if (!list.length) {
      containerEl.style.display = "none";
      return;
    }
    list.forEach(tag => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = tag;
      btn.dataset.tag = tag;
      containerEl.appendChild(btn);
    });
    containerEl.style.display = "block";
  }

  function attachTagSuggestions(inputEl, containerEl) {
    if (!inputEl || !containerEl) return;
    inputEl.addEventListener("focus", () => {
      updateTagSuggestionsFor(inputEl, containerEl);
    });
    inputEl.addEventListener("input", () => {
      updateTagSuggestionsFor(inputEl, containerEl);
    });
    inputEl.addEventListener("blur", () => {
      setTimeout(() => {
        containerEl.style.display = "none";
        syncChipWithInput(
          inputEl,
          inputEl === tagInput ? tagChip : editTagChip,
          inputEl === tagInput ? tagChipText : editTagChipText
        );
      }, 150);
    });
    containerEl.addEventListener("click", event => {
      const target = event.target;
      if (!target) return;
      const btn =
        target.closest && target.closest("button[data-tag]");
      if (!btn) return;
      const tag = btn.dataset.tag;
      if (!tag) return;
      inputEl.value = tag;
      containerEl.style.display = "none";
      syncChipWithInput(
        inputEl,
        inputEl === tagInput ? tagChip : editTagChip,
        inputEl === tagInput ? tagChipText : editTagChipText
      );
    });
  }

  attachTagSuggestions(tagInput, tagSuggestions);
  attachTagSuggestions(editTagInput, editTagSuggestions);

  if (tagChipClear && tagInput) {
    tagChipClear.addEventListener("click", () => {
      tagInput.value = "";
      syncChipWithInput(tagInput, tagChip, tagChipText);
    });
  }

  if (editTagChipClear && editTagInput) {
    editTagChipClear.addEventListener("click", () => {
      editTagInput.value = "";
      syncChipWithInput(editTagInput, editTagChip, editTagChipText);
    });
  }

  startBtn.addEventListener("click", () => {
    const active = loadActiveSession();
    const now = new Date();
    if (!active) {
      saveActiveSession({
        start: now.toISOString(),
        firstStart: now.toISOString(),
        date: formatDate(now),
        segments: [{ start: now.toISOString() }],
        state: "running"
      });
    } else if (active.state === "paused") {
      let segments;
      if (Array.isArray(active.segments)) {
        segments = [...active.segments, { start: now.toISOString() }];
      } else {
        const legacyStart = new Date(active.firstStart || active.start || now);
        const legacyEnd = new Date(legacyStart.getTime() + Math.max(0, Number(active.accumulatedMs) || 0));
        segments = legacyEnd > legacyStart
          ? [{ start: legacyStart.toISOString(), end: legacyEnd.toISOString() }, { start: now.toISOString() }]
          : [{ start: now.toISOString() }];
      }
      saveActiveSession({
        ...active,
        start: now.toISOString(),
        segments,
        state: "running"
      });
    }
    render();
  });

  stopBtn.addEventListener("click", () => {
    const active = loadActiveSession();
    if (!active) {
      return;
    }
    const end = new Date();
    const records = loadRecords();
    const tag = tagInput ? tagInput.value.trim() : "";
    const note = noteInput ? noteInput.value.trim() : "";
    records.push(...buildRecordsFromActiveSession(active, end, tag, note));
    saveRecords(records);
    if (tagInput) tagInput.value = "";
    if (noteInput) noteInput.value = "";
    saveActiveSession(null);
    render();
    if (tagInput) {
      syncChipWithInput(tagInput, tagChip, tagChipText);
    }
  });

  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      const active = loadActiveSession();
      if (!active || active.state === "paused" || !active.start) {
        return;
      }
      const now = new Date();
      saveActiveSession(closeRunningSegment(active, now.toISOString()));
      render();
    });
  }

  if (filterDateBtn) {
    filterDateBtn.addEventListener("click", () => {
      renderFilterByDate();
    });
  }
  if (filterDateInput) {
    filterDateInput.addEventListener("change", () => {
      renderFilterByDate();
    });
  }

  if (filterMonthBtn) {
    filterMonthBtn.addEventListener("click", () => {
      renderFilterByMonth();
    });
  }
  if (filterMonthInput) {
    filterMonthInput.addEventListener("change", () => {
      renderFilterByMonth();
    });
  }

  if (toggleDateBtn && dateGroup) {
    toggleDateBtn.addEventListener("click", () => {
      const collapsed = dateGroup.classList.toggle("collapsed");
      toggleDateBtn.textContent = t(collapsed ? "action.expand" : "action.collapse");
    });
  }

  if (toggleTodayRecordsBtn && todayRecordsSection) {
    toggleTodayRecordsBtn.addEventListener("click", () => {
      const collapsed = todayRecordsSection.classList.toggle("collapsed");
      toggleTodayRecordsBtn.textContent = t(collapsed ? "action.expand" : "action.collapse");
    });
  }

  if (toggleMonthTagRecordsBtn && monthTagRecordsSection) {
    toggleMonthTagRecordsBtn.addEventListener("click", () => {
      const collapsed = monthTagRecordsSection.classList.toggle("collapsed");
      toggleMonthTagRecordsBtn.textContent = t(collapsed ? "action.expand" : "action.collapse");
    });
  }

  if (toggleMonthTotalsBtn && monthTotalsSection) {
    toggleMonthTotalsBtn.addEventListener("click", () => {
      const collapsed = monthTotalsSection.classList.toggle("collapsed");
      toggleMonthTotalsBtn.textContent = t(collapsed ? "action.expand" : "action.collapse");
    });
  }

  if (exportDataBtn) {
    exportDataBtn.addEventListener("click", () => {
      exportData();
    });
  }

  if (importDataBtn && importFileInput) {
    importDataBtn.addEventListener("click", () => {
      importFileInput.value = "";
      importFileInput.click();
    });
    importFileInput.addEventListener("change", () => {
      const file = importFileInput.files && importFileInput.files[0];
      importDataFromFile(file);
    });
  }

  if (clearDataBtn) {
    clearDataBtn.addEventListener("click", () => {
      clearAllData();
    });
  }

  function handleRecordDelete(key) {
    const records = loadRecords();
    const next = records.filter(r => getRecordKey(r) !== key);
    if (next.length === records.length) return;
    saveRecords(next);
    render();
  }

  function closeDeleteDialog() {
    pendingDeleteKey = null;
    if (deleteDialog) deleteDialog.classList.remove("visible");
  }

  function openDeleteDialog(key) {
    pendingDeleteKey = key;
    if (deleteDialogMessage) deleteDialogMessage.textContent = t("record.deleteConfirm");
    if (deleteDialog) deleteDialog.classList.add("visible");
  }

  function handleRecordEdit(key) {
    const records = loadRecords();
    const target = records.find(r => getRecordKey(r) === key);
    if (!target) return;
    currentEditKey = key;
    if (editStartTimeInput) {
      editStartTimeInput.value = toTimeInputValue(target.startTime);
    }
    if (editEndTimeInput) {
      editEndTimeInput.value = toTimeInputValue(target.endTime);
    }
    if (editTagInput) {
      editTagInput.value = target.tag || "";
    }
    if (editNoteInput) {
      editNoteInput.value = target.note || "";
    }
    if (editDialogTime) {
      const startText = target.startTimeText || "";
      const endText = target.endTimeText || "";
      editDialogTime.textContent =
        startText && endText
          ? t("edit.timeRange", { start: startText, end: endText })
          : "";
    }
    if (editDialog) {
      editDialog.classList.add("visible");
      syncChipWithInput(editTagInput, editTagChip, editTagChipText);
    }
  }

  function delegateRecordActions(tbody) {
    if (!tbody) return;
    tbody.addEventListener("click", event => {
      const target = event.target;
      if (!target) return;
      const deleteBtn =
        target.closest && target.closest("button.record-delete");
      const editBtn =
        target.closest && target.closest("button.record-edit");
      const btn = deleteBtn || editBtn;
      if (!btn) return;
      const key = btn.getAttribute("data-key");
      if (!key) return;
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        openDeleteDialog(key);
      } else if (editBtn) {
        handleRecordEdit(key);
      }
    });
  }

  delegateRecordActions(todayRecordsBody);
  delegateRecordActions(filterDateBody);
  delegateRecordActions(calendarDateBody);

  if (deleteCancelBtn) {
    deleteCancelBtn.addEventListener("click", closeDeleteDialog);
  }

  if (deleteConfirmBtn) {
    deleteConfirmBtn.addEventListener("click", () => {
      if (pendingDeleteKey) handleRecordDelete(pendingDeleteKey);
      closeDeleteDialog();
    });
  }

  if (editCancelBtn && editDialog) {
    editCancelBtn.addEventListener("click", () => {
      currentEditKey = null;
      editDialog.classList.remove("visible");
    });
  }

  if (editSaveBtn && editDialog) {
    editSaveBtn.addEventListener("click", () => {
      if (!currentEditKey) {
        editDialog.classList.remove("visible");
        return;
      }
      const records = loadRecords();
      const target = records.find(r => getRecordKey(r) === currentEditKey);
      if (!target) {
        editDialog.classList.remove("visible");
        return;
      }
      let startIso = target.startTime;
      let endIso = target.endTime;
      if (editStartTimeInput && editStartTimeInput.value) {
        const dStr = target.date || formatDate(new Date(target.startTime));
        startIso = new Date(`${dStr}T${editStartTimeInput.value}:00`).toISOString();
      }
      if (editEndTimeInput && editEndTimeInput.value) {
        const dStr = target.date || formatDate(new Date(target.endTime));
        endIso = new Date(`${dStr}T${editEndTimeInput.value}:00`).toISOString();
      }
      const startDate = new Date(startIso);
      const endDate = new Date(endIso);
      if (endDate <= startDate) {
        alert(t("edit.endBeforeStart"));
        return;
      }
      target.startTime = startIso;
      target.endTime = endIso;
      target.startTimeText = formatTime(startDate);
      target.endTimeText = formatTime(endDate);
      target.durationMs = endDate.getTime() - startDate.getTime();
      if (editTagInput) {
        target.tag = editTagInput.value.trim();
      }
      if (editNoteInput) {
        target.note = editNoteInput.value.trim();
      }
      saveRecords(records);
      currentEditKey = null;
      editDialog.classList.remove("visible");
      render();
    });
  }

  if (tagDateBarBtn && tagDatePieBtn) {
    tagDateBarBtn.addEventListener("click", () => {
      chartModes.tagDateChart = "bar";
      tagDateBarBtn.classList.add("active");
      tagDatePieBtn.classList.remove("active");
      renderFilterByDate();
    });
    tagDatePieBtn.addEventListener("click", () => {
      chartModes.tagDateChart = "pie";
      tagDatePieBtn.classList.add("active");
      tagDateBarBtn.classList.remove("active");
      renderFilterByDate();
    });
  }

  if (tagMonthBarBtn && tagMonthPieBtn) {
    tagMonthBarBtn.addEventListener("click", () => {
      chartModes.tagMonthChart = "bar";
      tagMonthBarBtn.classList.add("active");
      tagMonthPieBtn.classList.remove("active");
      renderFilterByMonth();
    });
    tagMonthPieBtn.addEventListener("click", () => {
      chartModes.tagMonthChart = "pie";
      tagMonthPieBtn.classList.add("active");
      tagMonthBarBtn.classList.remove("active");
      renderFilterByMonth();
    });
  }

  if (monthTagDurationHeader) {
    monthTagDurationHeader.addEventListener("click", () => {
      monthTagSortAsc = !monthTagSortAsc;
      render();
    });
  }

  if (todayStartHeader) {
    todayStartHeader.addEventListener("click", () => {
      if (todaySortField === "start") {
        todaySortAsc = !todaySortAsc;
      } else {
        todaySortField = "start";
        todaySortAsc = true;
      }
      render();
    });
  }

  if (todayEndHeader) {
    todayEndHeader.addEventListener("click", () => {
      if (todaySortField === "end") {
        todaySortAsc = !todaySortAsc;
      } else {
        todaySortField = "end";
        todaySortAsc = true;
      }
      render();
    });
  }

  if (todayDurationHeader) {
    todayDurationHeader.addEventListener("click", () => {
      if (todaySortField === "duration") {
        todaySortAsc = !todaySortAsc;
      } else {
        todaySortField = "duration";
        todaySortAsc = true;
      }
      render();
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  loadWorkspaceMeta();
  loadAiSummaryCache();
  loadModulePrefs();
  loadBgmSettings();
  updateWorkspaceUI();
  const settingsWindowMode = window.location.hash === "#settings-window";
  // 不依赖浏览器把 id 自动暴露为全局变量，避免在 Electron 更新后出现隐式引用错误。
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsPanel = document.getElementById("settingsPanel");
  const settingsCloseBtn = document.getElementById("settingsCloseBtn");
  const aiApiKeyInput = document.getElementById("aiApiKeyInput");
  const aiSaveBtn = document.getElementById("aiSaveBtn");
  const aiGenerateBtn = document.getElementById("aiGenerateBtn");
  const aiCopyBtn = document.getElementById("aiCopyBtn");
  const aiSummaryBox = document.getElementById("aiSummaryBox");
  const pageHomeBtn = document.getElementById("pageHomeBtn");
  const pageStatsBtn = document.getElementById("pageStatsBtn");
  const langToggleBtn = document.getElementById("langToggleBtn");
  const workspaceAddBtn = document.getElementById("workspaceAddBtn");

  const now = new Date();
  const filterDate = document.getElementById("filterDate");
  if (filterDate) {
    filterDate.value = formatDate(now);
  }
  const filterMonth = document.getElementById("filterMonth");
  if (filterMonth) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    filterMonth.value = `${y}-${m}`;
  }
  const workspaceSelect = document.getElementById("workspaceSelect");
  const workspaceNameInput = document.getElementById("workspaceNameInput");

  const modeDefaultBtn = document.getElementById("modeDefaultBtn");
  const modeColorBtn = document.getElementById("modeColorBtn");
  const modeDarkBtn = document.getElementById("modeDarkBtn");

  function setMode(mode) {
    document.body.classList.remove("mode-default", "mode-color", "mode-dark");
    document.body.classList.add(mode);
    if (modeDefaultBtn) modeDefaultBtn.classList.toggle("active", mode === "mode-default");
    if (modeColorBtn) modeColorBtn.classList.toggle("active", mode === "mode-color");
    if (modeDarkBtn) modeDarkBtn.classList.toggle("active", mode === "mode-dark");
    localStorage.setItem("fishtime-ui-mode", mode);
    updateSettingsOptions();
  }

  const savedMode = localStorage.getItem("fishtime-ui-mode") || "mode-default";
  setMode(savedMode);

  if (modeDefaultBtn) {
    modeDefaultBtn.addEventListener("click", () => setMode("mode-default"));
  }
  if (modeColorBtn) {
    modeColorBtn.addEventListener("click", () => setMode("mode-color"));
  }
  if (modeDarkBtn) {
    modeDarkBtn.addEventListener("click", () => setMode("mode-dark"));
  }

  const savedLang = localStorage.getItem(STORAGE_KEY_LANG) || DEFAULT_LANG;
  applyLocale(savedLang);

  loadAiSettings();

  if (aiApiKeyInput) {
    aiApiKeyInput.value = "";
  }
  loadSecureApiKey(aiSettings.provider).then(apiKey => {
    aiSettings.apiKey = apiKey;
    if (aiApiKeyInput) aiApiKeyInput.value = apiKey;
    updateAiStatus(t(apiKey ? "ai.statusReady" : "ai.statusNoKey"));
  });

  const savedPage = localStorage.getItem(STORAGE_KEY_PAGE) || "home";
  setPage(savedPage);

  function openSettings() {
    if (settingsPanel) {
      document.body.classList.add("settings-only");
      settingsPanel.classList.add("visible");
    }
  }
  function closeSettings() {
    if (settingsPanel) {
      settingsPanel.classList.remove("visible");
    }
    document.body.classList.remove("settings-only");
  }

  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener("click", () => {
      openSettings();
    });
  }
  if (settingsCloseBtn && settingsPanel) {
    settingsCloseBtn.addEventListener("click", () => {
      if (settingsWindowMode) {
        window.close();
      } else {
        closeSettings();
      }
    });
  }
  if (settingsPanel && !settingsWindowMode) {
    settingsPanel.addEventListener("click", event => {
      if (event.target === settingsPanel) {
        closeSettings();
      }
    });
  }

  document.addEventListener("keydown", event => {
    const isCmdOrCtrl = event.metaKey || event.ctrlKey;
    if (isCmdOrCtrl && event.key === ",") {
      event.preventDefault();
      openSettings();
    }
  });

  const tauriEvent = window.__TAURI__ && window.__TAURI__.event;
  if (tauriEvent) {
    tauriEvent.listen("workspace:new", () => {
      openSettings();
      if (workspaceNameInput) workspaceNameInput.focus();
    });
    tauriEvent.listen("workspace:switch", () => {
      openSettings();
      if (workspaceSelect) workspaceSelect.focus();
    });
    tauriEvent.listen("settings:open", () => {
      openSettings();
    });
  }

  const moduleCheckboxes = Array.from(document.querySelectorAll("input[data-module-key]"));
  moduleCheckboxes.forEach(box => {
    box.addEventListener("change", () => {
      const key = box.dataset.moduleKey;
      if (!key) return;
      modulePrefs[key] = box.checked;
      saveModulePrefs();
      render();
    });
  });

  // BGM setup
  bgmAudio = document.getElementById("bgmPlayer");
  const bgmToggle = document.getElementById("bgmToggle");
  const bgmPrev = document.getElementById("bgmPrev");
  const bgmNext = document.getElementById("bgmNext");
  const bgmMuteBtn = document.getElementById("bgmMute");
  const bgmVolume = document.getElementById("bgmVolume");
  const bgmFileInput = document.getElementById("bgmFileInput");

  if (bgmAudio) {
    bgmAudio.volume = bgmSettings.volume ?? 0.5;
    bgmAudio.muted = !!bgmSettings.muted;
    bgmState.index = bgmSettings.index || 0;
    setBgmSource(bgmState.index);
    bgmAudio.addEventListener("play", () => {
      bgmState.playing = true;
      updateBgmUI();
    });
    bgmAudio.addEventListener("pause", () => {
      bgmState.playing = false;
      updateBgmUI();
    });
    bgmAudio.addEventListener("ended", () => {
      setBgmSource(bgmState.index + 1);
      bgmAudio.play().catch(() => {});
    });
  }

  if (bgmToggle) {
    bgmToggle.addEventListener("click", () => {
      if (!bgmAudio) return;
      if (bgmAudio.paused) {
        bgmAudio.play().catch(() => {});
      } else {
        bgmAudio.pause();
      }
    });
  }

  if (bgmPrev) {
    bgmPrev.addEventListener("click", () => {
      setBgmSource(bgmState.index - 1);
      if (bgmState.playing) bgmAudio.play().catch(() => {});
    });
  }

  if (bgmNext) {
    bgmNext.addEventListener("click", () => {
      setBgmSource(bgmState.index + 1);
      if (bgmState.playing) bgmAudio.play().catch(() => {});
    });
  }

  if (bgmMuteBtn) {
    bgmMuteBtn.addEventListener("click", () => {
      if (!bgmAudio || !bgmSettings) return;
      bgmSettings.muted = !bgmSettings.muted;
      bgmAudio.muted = bgmSettings.muted;
      saveBgmSettings();
      updateBgmUI();
    });
  }

  if (bgmVolume) {
    bgmVolume.addEventListener("input", () => {
      if (!bgmAudio || !bgmSettings) return;
      const v = Number(bgmVolume.value);
      bgmSettings.volume = isNaN(v) ? 0.5 : v;
      bgmAudio.volume = bgmSettings.volume;
      saveBgmSettings();
    });
  }

  if (bgmFileInput) {
    bgmFileInput.addEventListener("change", () => {
      const file = bgmFileInput.files && bgmFileInput.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const name = file.name || "自定义曲目";
      bgmSources.push({ name, url, builtIn: false });
      setBgmSource(bgmSources.length - 1);
      saveBgmSettings();
      bgmFileInput.value = "";
    });
  }

  langOptionButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const lang = btn.dataset.langOption;
      applyLocale(lang);
      render();
    });
  });

  themeOptionButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.themeOption;
      if (mode) {
        setMode(mode);
      }
    });
  });

  pageOptionButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.pageOption;
      setPage(page);
      render();
    });
  });

  aiProviderButtons.forEach(btn => {
    btn.addEventListener("click", async () => {
      const provider = btn.dataset.aiProvider || "gemini";
      saveAiSettings({ provider });
      aiSettings.apiKey = await loadSecureApiKey(provider);
      if (aiApiKeyInput) aiApiKeyInput.value = aiSettings.apiKey;
      updateSettingsOptions();
      updateAiStatus(t(aiSettings.apiKey ? "ai.statusReady" : "ai.statusNoKey"));
    });
  });

  if (aiSaveBtn) {
    aiSaveBtn.addEventListener("click", async () => {
      const key = aiApiKeyInput ? aiApiKeyInput.value.trim() : "";
      try {
        await saveSecureApiKey(aiSettings.provider, key);
      } catch (error) {
        console.error(error);
        updateAiStatus(t("ai.statusError"));
        return;
      }
      saveAiSettings({ apiKey: key });
      updateAiStatus(t(key ? "ai.statusReady" : "ai.statusNoKey"));
    });
  }

  if (aiGenerateBtn) {
    aiGenerateBtn.addEventListener("click", async () => {
      await handleAiGenerate();
    });
  }

  if (aiCopyBtn) {
    aiCopyBtn.addEventListener("click", async () => {
      const text = aiSummaryBox ? aiSummaryBox.textContent || "" : "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        updateAiStatus(currentLang === "en" ? "Copied." : "已复制。");
      } catch (e) {
        console.error(e);
      }
    });
  }

  if (pageHomeBtn) {
    pageHomeBtn.addEventListener("click", () => {
      setPage("home");
      render();
    });
  }
  if (pageStatsBtn) {
    pageStatsBtn.addEventListener("click", () => {
      setPage("stats");
      render();
    });
  }

  if (langToggleBtn) {
    langToggleBtn.addEventListener("click", () => {
      const next = currentLang === "zh" ? "en" : "zh";
      applyLocale(next);
      render();
    });
  }

  function handleWorkspaceAdd() {
    if (!workspaceNameInput) return;
    const name = workspaceNameInput.value.trim();
    if (!name) return;
    setWorkspace(name);
    workspaceNameInput.value = "";
  }

  if (workspaceSelect) {
    workspaceSelect.addEventListener("change", () => {
      const val = workspaceSelect.value;
      if (val) setWorkspace(val);
    });
  }
  if (workspaceAddBtn) {
    workspaceAddBtn.addEventListener("click", handleWorkspaceAdd);
  }
  if (workspaceNameInput) {
    workspaceNameInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleWorkspaceAdd();
      }
    });
  }

  const calRangeMonth = document.getElementById("calRangeMonth");
  const calRange30 = document.getElementById("calRange30");
  const calRangeCustom = document.getElementById("calRangeCustom");
  const calStart = document.getElementById("calStart");
  const calEnd = document.getElementById("calEnd");
  const calApply = document.getElementById("calApply");

  const calRangeBtns = [calRangeMonth, calRange30, calRangeCustom];
  calRangeBtns.forEach(btn => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      const mode = btn.dataset.range || "month";
      calendarRangeMode = mode;
      renderCalendarView();
    });
  });

  if (calStart && !calStart.value) {
    calStart.value = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
  }
  if (calEnd && !calEnd.value) {
    calEnd.value = formatDate(now);
  }

  if (calApply) {
    calApply.addEventListener("click", () => {
      const todayStr = formatDate(new Date());
      calendarCustomStart =
        (calStart && calStart.value) ? calStart.value : todayStr;
      calendarCustomEnd =
        (calEnd && calEnd.value) ? calEnd.value : calendarCustomStart;
      calendarRangeMode = "custom";
      renderCalendarView();
    });
  }

  render();
  setupEvents();
  setupTimers();

  let resizeRenderTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeRenderTimer);
    resizeRenderTimer = window.setTimeout(render, 150);
  });

  if (settingsWindowMode) {
    document.body.classList.add("settings-window-mode");
    document.body.classList.add("settings-only");
    if (settingsPanel) {
      settingsPanel.classList.add("visible");
    }
  }

  function getChartHit(canvasId, x, y) {
    const items = chartHitboxes[canvasId] || [];
    for (const item of items) {
      if (item.type === "bar") {
        if (
          x >= item.x &&
          x <= item.x + item.width &&
          y >= item.y &&
          y <= item.y + item.height
        ) {
          return item;
        }
      } else if (item.type === "square") {
        if (
          x >= item.x &&
          x <= item.x + item.width &&
          y >= item.y &&
          y <= item.y + item.height
        ) {
          return item;
        }
      } else if (item.type === "slice") {
        const dx = x - item.cx;
        const dy = y - item.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > item.radius) continue;
        let angle = Math.atan2(dy, dx);
        if (angle < -Math.PI / 2) {
          angle += Math.PI * 2;
        }
        if (angle >= item.startAngle && angle <= item.endAngle) {
          return item;
        }
      }
    }
    return null;
  }

  function attachTooltip(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.addEventListener("mousemove", event => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = getChartHit(canvasId, x, y);
      if (hit) {
        const valueText = formatValueWithUnit(
          hit.value,
          hit.useMinutes,
          hit.useMinutes ? 0 : 2
        );
        const text =
          currentLang === "en"
            ? `${hit.label}: ${valueText}`
            : `${hit.label}：${valueText}`;
        showChartTooltip(text, event.clientX, event.clientY);
      } else {
        hideChartTooltip();
      }
    });
    canvas.addEventListener("mouseleave", () => {
      hideChartTooltip();
    });
  }

  attachTooltip("monthChart");
  attachTooltip("tagDateChart");
  attachTooltip("tagMonthChart");

  const forecastCanvas = document.getElementById("forecastChart");
  if (forecastCanvas) {
    forecastCanvas.addEventListener("mousemove", event => {
      const rect = forecastCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const points = chartHitboxes.forecastChart || [];
      let hit = null;
      let minDist = 9999;
      for (const p of points) {
        const dx = p.x - x;
        const dy = p.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 8 && dist < minDist) {
          minDist = dist;
          hit = p;
        }
      }
      if (hit) {
        const label = hit.predicted
          ? t("chart.tooltip.predicted")
          : t("chart.tooltip.cumulative");
        const valueText = formatValueWithUnit(
          hit.value,
          hit.useMinutes,
          hit.useMinutes ? 0 : 2
        );
        const text =
          currentLang === "en"
            ? `${hit.label}: ${label} ${valueText}`
            : `${hit.label}：${label} ${valueText}`;
        showChartTooltip(text, event.clientX, event.clientY);
      } else {
        hideChartTooltip();
      }
    });
    forecastCanvas.addEventListener("mouseleave", () => {
      hideChartTooltip();
    });
  }
});
