# Lesson Practice Evidence Design

## Goal

让课程中的即时练习留下可查询的作答证据，同时不把课程练习误当成需要 FSRS 调度的记忆卡。

## Decision

新增独立的 `lesson_attempts` 持久对象。每条记录绑定 `lesson_id` 与 JSON 文档中的
`section_id`，保存答案、判定、耗时、参考答案、反馈和创建时间。课程文档仍是题目内容的
唯一来源；记录表只保存学习者实际输出和当时的评价结果。

后端提供两个接口：

- `POST /api/lessons/{lessonID}/practice/{sectionID}/attempts`：提交答案并根据该段的
  `options` 与 `correct_answer` 做确定性判定；没有标准答案时返回 `ungraded`，但仍保存答案。
- `GET /api/lessons/{lessonID}/practice/{sectionID}/attempts`：按时间倒序查询该段记录。

答案比较先做 Unicode trim 和大小写不敏感比较；服务端不调用 AI，也不改变 FSRS 状态。
非法课程/段落、空答案、负耗时返回 400/404；静态 Pages 适配器继续使用内存 fixture，
不发起后端请求。

## Alternatives

1. 复用 `attempts`/`prompts`：可以少一张表，但课程段落没有稳定 prompt ID，且会错误触发记忆调度。
2. 只在浏览器保存：实现最小，但换设备后证据消失，无法满足课程记录要求。
3. 独立 `lesson_attempts`（采用）：保持课程上下文、查询简单、与记忆调度边界清晰。

## Validation

后端测试覆盖迁移、确定性判定、无标准答案、重复提交、查询顺序和错误映射；前端测试覆盖
本地/Pages 模式下提交后仍可显示即时反馈，且静态模式不产生 `/api` 请求。
