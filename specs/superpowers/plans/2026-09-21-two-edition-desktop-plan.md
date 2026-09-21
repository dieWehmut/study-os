# 两版本桌面应用设计（去 PWA + 桌面自更新）

## 背景

仓库目前同时发布三条产物流水线：

1. `StudyOS.exe` 桌面版（Wails v2），按 `windows-x64` 与 `windows-arm64` 打包；
2. `study-os-pwa-windows-x64.zip` PWA 启动器包（`study-os-server.exe` + `web/` + `start.vbs`）；
3. GitHub Pages 纯前端静态展示（无后端）。

`scripts/install-pwa.ps1` 一键安装第 2 条并把桌面快捷方式指向 `start.vbs`，双击后启动本地 Go 服务并以浏览器作为界面。

用户要求：**不再要 PWA 应用，改成真正的桌面应用，只保留两个版本——x86 Windows 与 arm64 Windows。**

## 目标

- 推翻 PWA 分发路线：删除 PWA 运行时（启动器服务、服务程序包、一键安装脚本、Service Worker、Web App Manifest、`/api/launcher/close`）。
- 只发布两个 Windows 桌面版本：
  - `windows-x64`：Intel/AMD 版（x86 家族 64 位，覆盖绝大多数 Windows 机器）；
  - `windows-arm64`：ARM64 版。
- 桌面版必须能自己完成更新：更新检查与下载解包原本挂在 PWA 启动器上，删掉启动器后要迁移到桌面应用自己身上，否则设置页与启动弹窗的「更新」入口会变成不可用。

## 非目标

- 不改为 32 位（`windows/386`）构建。Wails 支持 `windows/386`，但本仓库既有流水线、安装器与用户约定都用 `x64`/`arm64` 表示 "Intel/AMD 版 / ARM 版"；`x86` 指 x86 家族（Intel/AMD）而非 16/32 位指令集。
- 不改动学习功能、数据库 schema、API 契约与前端页面行为。
- 不删除 GitHub Pages 静态展示（它不启动后端，不是 PWA）。

## 方案

### 1. 抽出独立的 `backend/selfupdate` 包

把 `backend/launcher` 里的更新能力（版本比较、GitHub Releases 检查、SHA-256 校验、解压暂存、重启脚本）整体搬到新包 `backend/selfupdate`，并改造为桌面形态：

- 资产名从 `study-os-pwa-windows-<arch>.zip` 改为 `study-os-<version>-windows-<arch>.zip`（与 `scripts/package-release.ps1` 现有产物一致）。
- 包内校验从「存在 `study-os-server.exe` 与 `web/index.html`」改为「存在 `StudyOS.exe`」，与桌面版归档实际内容一致。
- 因为 Windows 上正在运行的可执行文件不能就地覆盖，更新仍通过生成 `restart.cmd` 完成：等待旧进程退出 → 用暂存目录覆盖 `StudyOS.exe` → 重新启动。

### 2. 桌面应用持有更新服务

`backend/app` 增加 `Updater` 字段，注册信息为「当前版本 + 数据目录 + 仓库 + 资产架构 + 下载基址」。`app.go`（Wails 入口）在 `Shutdown` 时关闭服务，并在应用退出前把 `restart.cmd` 与 `StudyOS.exe` 解包位置对齐。

### 3. HTTP 路由收敛

`/api/update/status` 与 `/api/update/apply` 改为对桌面与启动器都可用（由 `application.Updater != nil` 判定），删除 `/api/launcher/close` 与 SPA 兜底路由。

### 4. 前端

- 删除 `src/lib/pwa.ts` 与 Service Worker 注册；`main.tsx` 不再注册 SW。
- 删除 `public/sw.js`、`public/manifest.webmanifest`、`App.tsx` 的 `pagehide` 关闭钩子。
- 保留 `icon-192.svg`（`api/speech.ts` 与 `index.html` 仍引用）。
- 更新弹窗保留：它现在走 `/api/update/*`，桌面模式下由 `Updater` 提供服务。

### 5. 发布与安装

- `.github/workflows/release.yml` 删除 `build-pwa` job；`publish` 只依赖两个桌面归档。
- 删除 `scripts/install-pwa.ps1`、`scripts/package-pwa-release.ps1` 及其 Pester 测试。
- 保留 `install.ps1` / `scripts/update.ps1` / `scripts/package-release.ps1`（桌面版安装与更新链路）。
- README 删除「一键安装（PWA 版）」段落，改为桌面版说明。

## 验证

- `go test ./...`
- `pnpm --dir frontend test -- --run`、`pnpm --dir frontend lint`、`pnpm --dir frontend build`
- Pester：`install.Tests.ps1`、`encoding.Tests.ps1`（删除 PWA 相关用例后）
- 本地 `wails build -platform windows/amd64` 与 `windows/arm64` 各出一次可执行文件，校验 PE 机器码（`0x8664` / `0xAA64`）。
- 新包 `go test ./backend/selfupdate/...` 覆盖版本比较、检查到新版本、校验失败拒绝、解包暂存内容。

## 提交边界

1. `feat(selfupdate)`：新包 + 桌面接线 + 路由收敛 + 前端去掉 SW/launcher 钩子。
2. `refactor(pwa)`：删除 PWA 运行时与脚本、测试、文档段落。
3. `release(desktop)`：发布矩阵收敛为两个桌面版本 + 文档。
