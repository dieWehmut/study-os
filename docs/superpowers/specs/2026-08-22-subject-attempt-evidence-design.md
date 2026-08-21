# 六科作答证据闭环设计

## 目标

把现有六个专属诊断板从练习页的临时工具升级为错题作答证据：语文记录得分点命中，数学记录首个分岔步骤，英语记录长难句拆分，物理记录受力图或运动分段，化学记录方程式检查，地理记录因果链断点。证据必须随 `question_attempt` 持久化，并能在本地后端和 GitHub Pages 演示中读回。

## 统一契约

`question_attempts.evidence_json` 保存一个可选 JSON 外壳：

```json
{
  "version": 1,
  "subject": "math",
  "tool": "derivation",
  "data": { "lines": ["2x+4=10", "2x=6", "x=3"] }
}
```

- 空对象 `{}` 表示尚未补充证据，不改变旧数据语义。
- `subject` 必须与题目科目一致；`tool` 只能使用该科允许的诊断板。
- 允许的工具为：`chinese/scoring_points`、`math/derivation`、`english/long_sentence`、`physics/free_body`、`physics/motion`、`chemistry/equation`、`geography/causal_chain`。
- `data` 的关键字段按工具校验，字符串数组/对象不能静默接受错误类型。
- 写入接口为 `PATCH /api/mistakes/{attemptID}/evidence`，请求体 `{ "evidence": <envelope> }`；创建错题时也可在 POST 中带同一字段。
- 返回的错题列表、单条错题和订正结果都携带 `attempt.evidence`。
- Pages 静态适配器实现相同的路径、状态码和校验。

## 组件接入

第一阶段只改造数据边界，不重写诊断算法。每个板增加可选的初始值和 `onChange`，由 `Practice` 在错题行中打开对应板；点击保存调用证据 PATCH，重新加载后恢复同一输入。物理按错因分别选择受力图或运动分段，其余学科一一对应。

## 非目标

- 不在这一切片中增加新的题目生成器、FSRS 调度规则或完整 Task 对象。
- 不把所有科目压成同一组字段；统一的是外壳、校验和传输，`data` 仍保留学科语义。
- 不自动把诊断结果判定为正确；证据只是可追溯输入，订正仍沿用现有流程。

## 验证

- Go 模型、迁移、Store 和 HTTP 测试覆盖六种工具、非法工具/科目、持久化和更新。
- TypeScript API 与 static-demo 测试覆盖序列化、读回和错误状态。
- Practice/板测试至少覆盖每种工具能恢复初始值并发出一次保存回调。
