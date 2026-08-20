# Lesson Practice History Design

## Goal

让课程即时练习的已保存证据在重新打开课程时可回看，并且不增加学习者的操作负担。

## Scope

本切片只消费已经存在的 `GET /api/lessons/{lessonID}/practice/{sectionID}/attempts`。
不新增表、不改变判定规则、不把课程证据转成 FSRS 卡片，也不要求 Pages 发起后端请求。

## Behavior

- 只有带有 `lessonID` 的课程详情实例加载历史；独立的 `LessonPractice` 组件仍可纯本地运行。
- 组件加载时读取该 section 的历史，按 API 返回顺序取最近一条，并显示“已作答 N 次”。
- 最近一次结果只在尚未提交本次答案时显示；提交后立即显示本次乐观结果，保存成功后用服务端结果替换。
- 历史加载失败静默降级为没有历史，不阻塞选择和提交；保存失败仍保留现有错误提示。
- 静态 Pages 复用内存适配器，因此刷新页面会重置历史，符合其演示模式边界。

## UI Contract

历史状态使用稳定的 `data-practice-history` 属性：`loading`、`ready`、`empty`、`error`。
有历史时显示最近结果、次数和耗时；不显示完整历史列表，避免练习卡变成日志面板。

## Verification

- Vitest 覆盖历史加载、最近结果、失败降级和提交后更新。
- Static Pages Playwright 提交后重新进入同一课程路由，在同一会话内看到次数提示且无 `/api` 请求。
