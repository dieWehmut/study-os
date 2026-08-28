/**
 * The diagnostic tool IDs accepted by the versioned mistake-evidence contract.
 *
 * Keep this list independent from React components: prescriptions describe the
 * learning action, while the mistake editor decides how to render its tool.
 */
export const SUBJECT_EVIDENCE_TOOL_IDS = [
  "scoring_points",
  "derivation",
  "long_sentence",
  "free_body",
  "motion",
  "equation",
  "causal_chain",
] as const

export type SubjectEvidenceToolId = (typeof SUBJECT_EVIDENCE_TOOL_IDS)[number]

export interface SubjectCauseGuidance {
  cause: string
  action: string
  tool?: SubjectEvidenceToolId
  toolLabel?: string
}

export interface SubjectPrescription {
  id: string
  focus: string
  actions: string[]
  evidence: string
  nextStep: string
  guidance: SubjectCauseGuidance[]
}

/**
 * Six subjects share a record -> diagnose -> repair -> verify loop, but they
 * do not share the same cognitive task. This is the one durable place that
 * names the difference, so screens and diagnostic tools cannot quietly drift.
 */
export const SUBJECT_PRESCRIPTIONS: Record<string, SubjectPrescription> = {
  chinese: {
    id: "chinese",
    focus: "文本证据、得分点与表达结构",
    actions: ["圈出题干与原文依据", "按得分点拆开答案", "补写缺失的表达"],
    evidence: "保留原文依据、命中的得分点和修改前后的答案。",
    nextStep: "换一段同题型材料，检验能否用证据组织答案。",
    guidance: [
      {
        cause: "method",
        action: "对着得分点拆答案：踩到几个点，缺的是哪一类",
        tool: "scoring_points",
        toolLabel: "对得分点",
      },
      {
        cause: "unknown",
        action: "先照着范文标出得分点，再回头看自己缺的是哪一句",
      },
    ],
  },
  math: {
    id: "math",
    focus: "题目条件、图形关系与首个推导断点",
    actions: ["列出已知、所求和限制", "把条件翻成图形或代数关系", "逐行定位首次分岔"],
    evidence: "保留条件清单、关键图形关系和首个错误步骤。",
    nextStep: "只针对断点做一题变式，再验证策略是否迁移。",
    guidance: [
      {
        cause: "method",
        action: "定位到出错的那一步，而不是整题重做：从哪一行开始和标准解法分岔",
        tool: "derivation",
        toolLabel: "逐行核对",
      },
      {
        cause: "careless",
        action: "把中间步骤写全：跳步省下的时间都赔在这里了",
        tool: "derivation",
        toolLabel: "补全中间步骤",
      },
    ],
  },
  english: {
    id: "english",
    focus: "单词和短语在识别、理解、提取与使用上的差异",
    actions: ["先确定薄弱维度", "放回真实语境辨义", "用搭配或造句输出"],
    evidence: "保留题型、独立作答和语境中的词块/句子。",
    nextStep: "换一种题型复测薄弱维度，避免只重复会做的选择题。",
    guidance: [
      {
        cause: "recall",
        action: "排进复习队列；同词族的其他词一起过，比单背这一个划算",
      },
      {
        cause: "method",
        action: "语法题看结构不看词义：先找主谓，再定从句",
        tool: "long_sentence",
        toolLabel: "拆长难句",
      },
    ],
  },
  physics: {
    id: "physics",
    focus: "研究对象、过程模型、方向与单位",
    actions: ["先定研究对象和过程分段", "画出受力或状态变化", "逐项检查方向和单位"],
    evidence: "保留受力图、阶段状态量和单位/方向检查结果。",
    nextStep: "用相邻情境重新建模，验证不是只记住这一题。",
    guidance: [
      {
        cause: "method",
        action: "多半是模型选错了：重画受力图，先标接触面再标场力",
        tool: "free_body",
        toolLabel: "画受力图",
      },
      {
        cause: "misread",
        action: "先把过程分段，写出每段的初末状态，再回头看问的是哪一段",
        tool: "motion",
        toolLabel: "把过程分段",
      },
      {
        cause: "careless",
        action: "方向和单位各查一遍：物理的手滑有一半是漏了负号",
      },
    ],
  },
  chemistry: {
    id: "chemistry",
    focus: "反应条件、微粒变化、守恒与实验现象",
    actions: ["先认反应和题型", "核对条件与微粒变化", "回查守恒和状态符号"],
    evidence: "保留方程式、守恒检查、条件和现象的对应关系。",
    nextStep: "明确是守恒、条件、过量还是实验步骤后，再做同类反应。",
    guidance: [
      {
        cause: "method",
        action: "先认题型：这道考的是守恒、过量判断，还是平衡移动？认错型比算错更常见",
      },
      {
        cause: "careless",
        action: "配平系数和状态符号回查一遍，分数多半丢在这两处",
        tool: "equation",
        toolLabel: "核对配平",
      },
    ],
  },
  geography: {
    id: "geography",
    focus: "时空范围、图表信息、因果链与区位",
    actions: ["圈出时间、范围和程度限定词", "先读图例和尺度", "把因果与区位一环一环写出"],
    evidence: "保留图例/尺度引用、因果链和区位要素表。",
    nextStep: "换一个区域或尺度复查，确认因果关系没有倒置。",
    guidance: [
      {
        cause: "method",
        action: "把因果链一环一环写出来，从成因到表现，缺哪一环就是丢分点",
        tool: "causal_chain",
        toolLabel: "串因果链",
      },
      {
        cause: "misread",
        action: "先看图例和比例尺，再回题干圈出限定词：时间、范围、程度",
      },
    ],
  },
}

function canonical(value: string): string {
  return value.trim().toLowerCase()
}

export function prescriptionFor(subject: string): SubjectPrescription | undefined {
  return SUBJECT_PRESCRIPTIONS[canonical(subject)]
}

export function guidanceFor(subject: string, cause: string): SubjectCauseGuidance | undefined {
  return prescriptionFor(subject)?.guidance.find((item) => item.cause === canonical(cause))
}
