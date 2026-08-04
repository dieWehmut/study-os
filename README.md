# Study OS

Study OS 是一个本地优先、可定制、Agent-native 的自学 Web 应用。
v0.2 在英语记忆闭环（导入 → 去重 → 记忆 → 他评 → FSRS）之上补上了真实 AI
接入、厂商化配置、词库清洗管线、云端发音与新的记忆题型。

## 一键安装（PWA 版）

在 PowerShell 中运行下面这一行，即可自动下载最新发布、校验并安装，同时在桌面生成「学习系统」图标：

```powershell
irm https://raw.githubusercontent.com/dieWehmut/study-os/main/scripts/install-pwa.ps1 | iex
```

之后双击桌面图标：自动启动后端并打开学习界面；关闭窗口即释放资源，更新也会在应用内自动完成。

## v0.2 已包含

- 响应式 React 界面：桌面侧栏 / 移动底部导航，亮色 / 暗色主题切换
- 本地 Go 服务 + 纯 Go SQLite，REST API + SSE 事件流
- 通用导入：CSV / JSONL / SQLite，字段映射、原始行保留、重复检测与人工复核
- 知识 Wiki：可搜索列表、简明 / 详细双视图、词族分组（`knowledge_groups`）
- 六学科体系：语文 / 数学 / 英语 / 物理 / 化学 / 地理，侧栏切换学科，
  知识库与记忆队列按学科过滤，导入时可映射学科字段
- 记忆题型：看英说中、看中说英、语境填空、造句（AI 他评，离线降级为部分掌握）
- 确定性他评（incorrect / partial / correct）+ 正负反馈 + 一键改判
- FSRS 调度（Again / Hard / Good），跨重启持久保存
- 厂商化 AI 配置：`.env.local` 按厂商分组（DeepSeek 已接入，其余占位），
  设置页展示各厂商卡片、可切换活跃服务商、测试连通性；密钥永不回显
- DeepSeek 生成：词 Wiki、造句、自由文本批改、记忆点抽取、义项压缩
- 云端 TTS（DashScope CosyVoice，带时间轴），未配置时回退 Windows SAPI
- 英语词库清洗管线：按等级/标签过滤、词形还原分组、批量生成 Wiki
- Wails v2 桌面壳：单实例、关窗即退、每日自动备份、可验证更新
- 安装 / 发布流水线：PowerShell 安装与更新、x64/ARM64、SHA-256 校验、失败回滚

## 快速开始（浏览器开发）

后端（默认监听 `127.0.0.1:8080`）：

```powershell
go run ./backend
```

前端（默认代理 `/api` 到 8080）：

```powershell
pnpm --dir frontend dev -- --host 127.0.0.1 --port 5173 --strictPort
```

打开 http://127.0.0.1:5173 。

## AI 配置

复制 `.env.sample` 为 `.env.local`，按厂商填写：

```dotenv
AI_ACTIVE_PROVIDER=mock
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_REASONING_MODEL=deepseek-v4-pro
DASHSCOPE_API_KEY=
DASHSCOPE_TTS_VOICE=longxiaochun
```

设置页的「AI 服务商」卡片会显示每个厂商的配置状态，可切换
`AI_ACTIVE_PROVIDER`、填写/清除 API Key、选择模型并保存到 `.env.local`
（带备份）。密钥是只写不回显的：界面只显示“已配置/未配置”，绝不显示密钥值。

## 验证命令

```powershell
go test ./...
go vet ./...
pnpm --dir frontend test -- --run
pnpm --dir frontend lint
pnpm --dir frontend build
pnpm --dir frontend run e2e   # 需要 8080/5174 端口空闲，自动启动后端与前端
```

桌面版：

```powershell
pnpm --dir frontend build
wails build -clean
```

安装 / 更新一键脚本：

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

## PWA 启动器（一键安装 + 自动更新）

也可以把学习系统装成“浏览器里的 PWA”：

1. 打包发布包（需要 Go 与 pnpm）：
   ```powershell
   scripts\package-pwa-release.ps1 -Version 0.2.0
   ```
   生成 `release/study-os-pwa-windows-x64.zip`（含服务程序、网页与启动脚本）和校验文件。
2. 用户侧一键安装（自动下载 GitHub 最新发布、校验、解压并生成桌面图标）：
   ```powershell
   scripts\install-pwa.ps1 -Folder D:\StudyOS
   ```
   之后双击桌面「学习系统」：自动启动本地后端并打开 PWA 界面；关闭浏览器窗口后后端会自动退出，不占资源。
3. 自动更新：后端启动后定期检查 GitHub Releases，发现新版本时前端弹出更新说明与「立即更新」；设置页也有「检查更新」按钮。更新仓库可用 `STUDY_OS_UPDATE_REPO` 配置（默认 `dieWehmut/study-os`）。

## v0.2 明确不含

课程生成 Agent、带交互图表的课程 HTML、字幕联动听课、图文笔记生成、全科目
适配器、数位板书写与 AI 录题批改、阅读 Zone（十万篇语料索引）、局域网/手机
访问、网课转写导入、运行时插件系统。这些方向在后续版本演进。
