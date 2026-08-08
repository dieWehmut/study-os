# Study OS

Study OS 是一个本地优先、可定制、Agent-native 的自学 Web 应用。
v0.2 在英语记忆闭环（导入 → 去重 → 记忆 → 他评 → FSRS）之上补上了真实 AI
接入、厂商化配置、词库清洗管线、云端发音与新的记忆题型。

## 一键安装（PWA 版）

在 PowerShell 中运行下面这一行，即可自动下载最新发布、校验并安装，同时在桌面生成「学习系统」图标：

```powershell
irm https://raw.githubusercontent.com/dieWehmut/study-os/main/scripts/install-pwa.ps1 | iex
```

之后双击桌面图标：自动启动后端并打开学习界面；关掉页面后后端空闲 10 分钟自动退出，更新在应用内完成。
端口被占用时会自动向后顺延，图标打开的始终是后端实际监听的地址，不会停在 8080。

安装包在落地之前会先过完这几道检查，任何一道不过就中止，安装目录不会被动过：

- 只接受 https 的安装包与校验文件地址，并强制 TLS 1.2
- 下载到临时目录后先比对 `.sha256`，再检查压缩包内有没有越界路径，才解压
- 覆盖安装前把 `data/` 打包备份到 `<安装目录>\backups\pre-install\`（带校验值，保留最近 5 份）
- 只结束安装目录里正在运行的旧后端，开发用的 `go run ./backend` 不受影响

想装到别的目录、或者不要桌面图标，就把脚本存下来再带参数运行：

```powershell
scripts\install-pwa.ps1 -Folder D:\StudyOS -SkipShortcut
```

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
- 多厂商 AI 配置：DeepSeek / Claude / OpenAI / 通义千问 / 智谱 GLM / 火山豆包
  全部可用，设置页展示各厂商卡片、可切换活跃服务商、测试连通性；密钥永不回显
- AI 生成：词 Wiki、造句、自由文本批改、记忆点抽取、义项压缩
- 云端 TTS（DashScope CosyVoice，带时间轴），未配置时回退 Windows SAPI
- 英语词库清洗管线：按等级/标签过滤、词形还原分组、批量生成 Wiki
- Wails v2 桌面壳：单实例、关窗即退、每日自动备份、可验证更新
- 安装 / 发布流水线：PowerShell 安装与更新、x64/ARM64、SHA-256 校验、失败回滚，
  桌面版与一键 PWA 两条安装路径各有 Pester 覆盖（越界压缩包、非 https 地址、
  覆盖安装前备份学习数据）

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

复制 `.env.sample` 为 `.env.local`，按厂商填写。`AI_ACTIVE_PROVIDER` 可选
`mock`（本地离线）、`deepseek`、`claude`、`openai`、`qwen`、`glm`、`volcengine`；
每个厂商的 `*_BASE_URL` / `*_MODEL` / `*_REASONING_MODEL` 留空即用内置默认值，
所以最少只要填一个密钥：

```dotenv
AI_ACTIVE_PROVIDER=deepseek
DEEPSEEK_API_KEY=
ANTHROPIC_API_KEY=       # Claude 沿用官方惯例的密钥名
OPENAI_API_KEY=
QWEN_API_KEY=
GLM_API_KEY=
VOLCENGINE_API_KEY=
DASHSCOPE_API_KEY=       # 云端 TTS，与对话服务商相互独立
DASHSCOPE_TTS_VOICE=longxiaochun
```

DeepSeek / OpenAI / 通义千问 / GLM / 火山豆包走 OpenAI ChatCompletions 兼容协议，
Claude 走 Anthropic Messages 协议；两条链路都在后端实现，前端无需区分。

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

安装 / 更新一键脚本（两套安装路径都有 Pester 覆盖）：

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
Invoke-Pester -Script scripts\tests\install.Tests.ps1        # 桌面版安装器
Invoke-Pester -Script scripts\tests\install-pwa.Tests.ps1    # 一键 PWA 安装器
Invoke-Pester -Script scripts\tests\encoding.Tests.ps1       # 脚本编码约定（BOM）
```

脚本的编码是有讲究的，改动前先看 `scripts\tests\encoding.Tests.ps1` 里的说明：
`install-pwa.ps1` 必须**不带** BOM（否则 `irm | iex` 会把 U+FEFF 粘到第一条命令上），
而带中文的 `package-pwa-release.ps1` 必须**带** BOM（否则 PowerShell 5.1 按 GBK 解码，
中文在写进 start.vbs 之前就已经乱码）。这两条都不会在 diff 里显示出来。

## PWA 启动器（一键安装 + 自动更新）

也可以把学习系统装成“浏览器里的 PWA”：

1. 打包发布包（需要 Go 与 pnpm）：
   ```powershell
   scripts\package-pwa-release.ps1 -Version 0.2.0
   ```
   生成 `release/study-os-pwa-windows-x64.zip`（含服务程序、网页与启动脚本）和校验文件。
2. 用户侧一键安装见上面的「一键安装（PWA 版）」；本地调试安装器时可直接指定目录：
   ```powershell
   scripts\install-pwa.ps1 -Folder D:\StudyOS
   ```
   之后双击桌面「学习系统」：自动启动本地后端并打开 PWA 界面；关掉页面后后端空闲 10 分钟自动退出，不常驻占用资源。
3. 自动更新：后端启动后定期检查 GitHub Releases，发现新版本时前端弹出更新说明与「立即更新」；设置页也有「检查更新」按钮。更新仓库可用 `STUDY_OS_UPDATE_REPO` 配置（默认 `dieWehmut/study-os`）。

## v0.2 明确不含

课程生成 Agent、带交互图表的课程 HTML、字幕联动听课、图文笔记生成、全科目
适配器、数位板书写与 AI 录题批改、阅读 Zone（十万篇语料索引）、局域网/手机
访问、网课转写导入、运行时插件系统。这些方向在后续版本演进。
