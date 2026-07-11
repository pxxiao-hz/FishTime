# FishTime

> 时间，留在你的设备里。

FishTime 是一款轻量的本地计时与统计工具。它用工作分区整理不同项目，通过标签、图表、日历和预测把投入时间变得清晰可见；需要时也可以使用 AI 将当天的记录整理成摘要。

FishTime 坚持“本地优先”：计时记录默认只保存在电脑上，支持自行导入和导出备份。

## 功能一览

- **专注计时**：开始、暂停、结束计时；支持标签、备注及超时提醒。
- **多工作分区**：为不同工作或生活主题建立独立分区，数据互不混杂。
- **记录与统计**：按日、月和日历查看投入时长，支持记录编辑、删除、排序与筛选。
- **可视化洞察**：标签柱状图、饼图、时长色阶日历及当月投入预测。
- **AI 总结（可选）**：支持 Gemini 和硅基流动，按需总结当天记录；结果按日缓存。
- **数据掌握在自己手中**：可导出或导入 JSON 备份；v4 完整备份包含全部工作分区与设置。
- **舒适界面**：中英文、浅色/色块/深色主题，以及可选的背景音乐。

## macOS 使用方法

当前发布包面向 **Apple Silicon（M 系列）Mac**，需要 **macOS 10.15 或更高版本**。

1. 前往 [Releases](https://github.com/pxxiao-hz/FishTime/releases/latest)，下载最新版本的 Apple Silicon DMG。
2. 双击打开 DMG，把 `FishTime.app` 拖到“应用程序（Applications）”文件夹。
3. 首次打开时，因当前版本没有 Apple Developer 证书和公证，macOS 可能提示“无法验证开发者”。请在“应用程序”中**按住 Control 点击（或右键点击）FishTime → 打开 → 打开**；如仍被阻止，请前往“系统设置 → 隐私与安全性”，选择“仍要打开”。
4. 从旧版迁移时：先在旧版 FishTime 中“导出数据”，再在新版本的设置中选择“导入数据”并选取 JSON 文件。

> 安装包为 ad-hoc 签名，尚未公证；这会触发首次运行的 Gatekeeper 提示，但不影响本地功能。无需 Apple ID，也不会要求登录。

## 数据与隐私

- 计时数据、分区和界面设置默认存放在本机的系统 WebView 数据库中；FishTime 不提供账号、云同步或遥测上传。
- 可以随时从设置中导出 JSON 备份。完整备份不包含 AI API Key。
- 在 macOS 桌面版中，AI API Key 保存到 macOS 钥匙串（Keychain），不会写入本地数据备份或 GitHub 源码。
- AI 功能完全可选。只有在你主动生成 AI 总结时，相关记录内容才会发送给你选择的 AI 服务商；请在使用前阅读该服务商的隐私政策。

## 备份与兼容性

- v4 可以导入旧 Electron 版导出的 `records + activeSession` JSON。
- v4 导出的完整备份会包含所有工作分区、模块设置和 AI 总结缓存，同时保留旧版兼容字段。
- 建议升级前先导出一次旧数据，并妥善保存 JSON 文件；它是跨版本迁移的可靠方式。

## 开发

```bash
npm install
npm start        # Tauri 开发/调试
npm run dist     # 构建 macOS App 和 DMG
```

首次开发前还需要安装 [Rust](https://www.rust-lang.org/tools/install)。构建出的 DMG 位于：

```text
src-tauri/target/release/bundle/dmg/
```

## 项目结构

- `index.html`、`style.css`、`main.js`：界面和核心逻辑
- `src-tauri/`：Tauri/Rust 桌面壳、原生菜单、权限和打包配置
- `scripts/prepare-web.js`：生成最小化的 Tauri 前端资源目录

## 更新日志

### 4.0.1

- 恢复旧版 FishTime 的 macOS 应用图标，并在 Tauri 打包配置中显式声明图标资源。

### 4.0.0

- 从 Electron 迁移至 Tauri 2，使用 macOS 系统 WKWebView，发布包显著缩小。
- 保留计时、统计、分区、AI 总结和背景音乐能力，并优化深色主题、图表空状态和窄窗口布局。
- 新增全分区 v2 备份格式，兼容旧版 JSON 导入；跨午夜计时会拆分为正确的日期记录。
- AI Key 改存 macOS 钥匙串；原生菜单改为 Tauri Rust 实现，并收紧权限和内容安全策略。

## 许可证

[ISC](LICENSE)
