# PWA 启动探测与本机安装修复设计

## 背景

Windows PWA 安装后，桌面快捷方式会执行安装目录中的 `start.vbs`。该脚本启动后端后轮询首页，确认服务可用时再打开浏览器；轮询失败则显示“学习系统启动失败”的弹窗。

当前生成脚本创建 `MSXML2.XMLHTTP`，随后调用该对象不支持的 `setTimeouts`。`On Error Resume Next` 隐藏了 COM 错误，但 `Err.Number` 保持非零，因此即使后端已经在 `127.0.0.1:8422` 返回 HTTP 200，`ServesApp` 仍始终返回 `False`。实机已复现该状态。

## 目标

- 修复 `scripts/package-pwa-release.ps1` 生成的启动探测。
- 添加先失败、修复后通过的自动化回归测试。
- 重新生成并替换本机安装目录中的 `start.vbs`。
- 保持现有学习数据、数据库、快捷方式和后端可执行文件不变。
- 将测试、源代码修复和本机部署分步验证；仓库内每个逻辑步骤单独提交。

## 非目标

- 不重写 Go 后端启动流程。
- 不改变端口选择、地址文件或浏览器打开策略。
- 不借机修复与本次弹窗无关的旧桌面安装器问题。
- 不发布 GitHub Release，也不覆盖远程安装包。

## 方案选择

采用 `MSXML2.ServerXMLHTTP.6.0` 替代 `MSXML2.XMLHTTP`。前者支持当前脚本需要的四段式 `setTimeouts`，因此可以保留有限时的同步首页探测，并以最小改动修复根因。

未采用的方案：

- 删除 `setTimeouts`：虽然少改一行，但异常网络状态可能让启动器无限等待。
- 将浏览器启动迁移到 Go 后端：会扩大跨组件改动和回归范围，不符合本次最小修复目标。

## 组件与数据流

1. `scripts/package-pwa-release.ps1` 生成 UTF-16LE（带 BOM）的 `start.vbs`。
2. `start.vbs` 从 `data/launcher-address` 读取后端实际监听地址。
3. `ServesApp` 使用 `MSXML2.ServerXMLHTTP.6.0`，设置 1.5 秒连接及收发超时，并请求该地址的 `/`。
4. 仅当 COM 调用无错误且响应状态为 200 时，启动器判定应用可用并打开浏览器。
5. 若现有地址不可用，启动器按现有逻辑启动 `study-os-server.exe`，最多轮询 40 次；仍失败时才显示错误弹窗。

本机修复使用已修正的打包脚本重新生成 `start.vbs`，再仅替换 `C:\Users\30119\Desktop\学习系统\start.vbs`。安装目录中的 `data`、`backups`、`web` 和 `study-os-server.exe` 均不修改。

## 错误处理

- 保留现有 `On Error Resume Next` 边界，让单次 HTTP 探测失败返回 `False`，而不是终止整个启动脚本。
- 保留明确超时，避免无响应端点阻塞桌面启动。
- 生成阶段继续校验中文标记和 UTF-16LE 输出，避免编码回归。
- 本机替换前确认目标是桌面快捷方式实际引用的 `start.vbs`；替换后重新读取文件，校验 COM ProgID 和 BOM。

## 测试与验证

按测试驱动顺序执行：

1. 新增 Pester 回归测试，从发布脚本的启动器模板中取得 COM ProgID，并验证该 COM 客户端支持 `setTimeouts` 和本机回环 HTTP 200 探测。测试必须先在当前 `MSXML2.XMLHTTP` 实现上以预期原因失败。
2. 将模板改为 `MSXML2.ServerXMLHTTP.6.0`，确认新增测试转绿。
3. 运行全部 PowerShell 安装器测试，确认安全校验、备份及编码约束没有回归。
4. 使用 `-SkipBuild` 重新生成 PWA 包，检查归档内 `start.vbs` 的编码及客户端类型。
5. 替换本机 `start.vbs` 后，确认 `http://127.0.0.1:8422/` 返回 200，并从桌面启动入口执行一次，确认不再进入失败弹窗路径。

## 任务与提交边界

1. `docs: design PWA launcher startup fix`：本设计文档。
2. `test: reproduce PWA launcher timeout client failure`：只添加能够复现根因的回归测试。
3. `fix: use timeout-capable HTTP client in PWA launcher`：只修改发布脚本模板并使测试通过。
4. 本机安装修复属于部署操作，不提交安装目录或生成的发布产物；在交付说明中记录验证证据。
