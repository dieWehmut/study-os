# Study OS

Study OS 是一个本地优先、可定制、Agent-native 的自学 Web 应用。v0.1 先交付一条完整的英语记忆闭环：把个人资料导入、整理成知识点 Wiki，再通过他评 + 正负反馈 + FSRS 调度完成长期记忆。

## v0.1 已包含

- 响应式 React 界面：桌面侧栏 / 移动底部导航，亮色 / 暗色主题切换
- 本地 Go 服务 + 纯 Go SQLite，REST API + SSE 事件流
- 通用导入：CSV、JSONL、SQLite，字段映射、原始行保留、完全重复自动合并、近重复进入人工复核
- 知识点 Wiki：可搜索列表，简版定义与详细 Markdown 同源展示
- 三种记忆题型：看英说中、看中说英、语境填空
- 确定性他评（incorrect / partial / correct）+ 简短反馈 + 一键改判
- FSRS 调度（Again / Hard / Good），跨重启持久保存
- 发音：优先已导入音频，其次本地缓存，最后 Windows SAPI 合成
- 默认 Mock AI 提供商，可配置 OpenAI-compatible 提供商；离线任务持久排队
- Wails v2 桌面壳：单实例、关窗即退出、每日自动备份、可验证更新
- 安装器与发布流水线：PowerShell 安装 / 更新、x64/ARM64、SHA-256 校验、失败回滚
- PWA 资源（浏览器构建可安装、离线壳缓存）

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

## 验证命令

```powershell
go test ./...
pnpm --dir frontend test -- --run
pnpm --dir frontend lint
pnpm --dir frontend build
pnpm --dir frontend run e2e   # 需要 8080/5174 端口空闲，自动启动后端与前端
```

## 桌面版

```powershell
pnpm --dir frontend build
wails build -clean
```

安装 / 更新见 [docs/release.md](docs/release.md)，一键安装：

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

## AI 提供商

默认使用本地 Mock 提供商，学习闭环完全离线可用。要启用真实 AI：

1. 复制 `.env.sample` 为 `.env.local`；
2. 设置 `AI_PROVIDER=openai` 与 `OPENAI_API_KEY`；
3. 重启后端。

密钥只从进程环境读取，不会写入 SQLite、返回给前端或写入日志。

## 文档

- [架构](docs/architecture.md)
- [数据模型](docs/data-model.md)
- [发布与安装](docs/release.md)
- [v0.1 设计](docs/superpowers/specs/2026-08-01-study-os-v0.1-design.md)

## v0.1 明确不含

课程生成 Agent、带交互图表的高考课程、字幕/口播课程、图文笔记生成、全科适配器、数位板与 AI 录题批改、阅读 Zone 十万篇文档索引、LAN 手机访问、托盘驻留与插件系统。这些方向在后续版本演进。
