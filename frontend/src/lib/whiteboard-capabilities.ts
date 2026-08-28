export const WHITEBOARD_TIERS = ["foundation", "polish", "frontier"] as const
export type WhiteboardTier = (typeof WHITEBOARD_TIERS)[number]

export interface WhiteboardCapability {
  id: string
  tier: WhiteboardTier
  name: string
  summary: string
  products: string[]
  learningValue: string
  evidence: string
}

/**
 * A traceable research backlog for the whiteboard/workbench direction.
 * Product names are leads, not endorsements; each row keeps its evidence
 * status explicit until imported subtitles or a primary source are attached.
 */
export const WHITEBOARD_CAPABILITIES: WhiteboardCapability[] = [
  {
    id: "infinite-canvas",
    tier: "foundation",
    name: "无限画布与快速移动",
    summary: "拖拽、缩放、框选和空白处落笔都不打断记录。",
    products: ["Heptabase", "FlexNote"],
    learningValue: "把讲义、错题和自己的推导放在同一视野，减少来回翻页。",
    evidence: "产品线索；待导入推荐视频字幕核验。",
  },
  {
    id: "capture-shortcuts",
    tier: "foundation",
    name: "快捷捕捉与键盘流",
    summary: "用快捷键新建卡片、移动焦点和快速标记。",
    products: ["FlexNote", "Project graph"],
    learningValue: "想到就记，保留解题过程而不是只留下最终答案。",
    evidence: "产品线索；待字幕逐项核验快捷键覆盖范围。",
  },
  {
    id: "structured-blocks",
    tier: "foundation",
    name: "结构化卡片与 Markdown",
    summary: "标题、列表、公式和代码保持可编辑的结构。",
    products: ["Heptabase", "Project graph"],
    learningValue: "同一份笔记既能阅读，也能生成导图、卡片和复习提示。",
    evidence: "项目现有 Markdown 管线；外部产品细节待字幕核验。",
  },
  {
    id: "search-filter",
    tier: "foundation",
    name: "全文搜索与筛选",
    summary: "按学科、标签、来源和复习状态快速缩小画布。",
    products: ["Heptabase", "FlexNote"],
    learningValue: "找到同类错因，而不是只搜索某一道题。",
    evidence: "项目知识库已有筛选契约；外部能力待来源核验。",
  },
  {
    id: "backlinks",
    tier: "polish",
    name: "双向链接与反向引用",
    summary: "从概念跳到证据，也能看到哪些题目引用了它。",
    products: ["Heptabase", "Project graph"],
    learningValue: "把‘会做一道题’连接到可迁移的规律和前置知识。",
    evidence: "产品线索；待导入推荐视频字幕核验。",
  },
  {
    id: "spatial-groups",
    tier: "polish",
    name: "空间分组与语义区域",
    summary: "用框、颜色和区域表达章节、题型或因果链。",
    products: ["Heptabase", "FlexNote"],
    learningValue: "让六科处方的‘条件—证据—验证’关系一眼可见。",
    evidence: "产品线索；视觉交互细节待字幕核验。",
  },
  {
    id: "templates",
    tier: "polish",
    name: "学科模板与重复布局",
    summary: "一键套用语文得分点、物理受力图、地理因果链等布局。",
    products: ["FlexNote", "Project graph"],
    learningValue: "把方法固化成动作，降低每次整理的启动成本。",
    evidence: "本项目六科处方已定义模板语义；外部产品待核验。",
  },
  {
    id: "minimap-navigation",
    tier: "polish",
    name: "缩略图与视野导航",
    summary: "长笔记保持全局定位，点击缩略图回到局部。",
    products: ["Heptabase", "Project graph"],
    learningValue: "先看结构再读细节，降低长文阅读的工作记忆负担。",
    evidence: "产品线索；待字幕核验交互细节。",
  },
  {
    id: "safe-export",
    tier: "polish",
    name: "可追溯导出",
    summary: "导出 Markdown、图片或 Mermaid，并保留原始来源。",
    products: ["Heptabase", "FlexNote", "Project graph"],
    learningValue: "复习材料可带走，且不会丢掉证据出处。",
    evidence: "项目已有 Markdown/Mermaid 导出；外部格式待核验。",
  },
  {
    id: "graph-view",
    tier: "frontier",
    name: "知识图谱与路径回放",
    summary: "按引用、前置关系和错因生成可探索的图。",
    products: ["Project graph", "Heptabase"],
    learningValue: "发现跨章节、跨学科的迁移路径，而不是孤立背诵。",
    evidence: "研究方向线索；需要字幕与可复现样例。",
  },
  {
    id: "ai-clustering",
    tier: "frontier",
    name: "AI 聚类与关系建议",
    summary: "对材料提出候选分组、链接和摘要，但必须可回溯原文。",
    products: ["Heptabase", "FlexNote"],
    learningValue: "把大量错题先粗分，再由学习者确认真正的因果关系。",
    evidence: "概念验证方向；不能替代人工确认，待来源核验。",
  },
  {
    id: "timeline-replay",
    tier: "frontier",
    name: "过程时间线与回放",
    summary: "记录从草稿到修订的变化，重放思路如何分岔。",
    products: ["Project graph", "FlexNote"],
    learningValue: "定位‘哪一步开始偏离’，比只看最终错题更适合方法纠错。",
    evidence: "研究方向线索；需要视频字幕和交互原型验证。",
  },
  {
    id: "multimodal-evidence",
    tier: "frontier",
    name: "多模态证据锚点",
    summary: "把截图、音频、视频时间点和文字节点绑定在一起。",
    products: ["Heptabase", "FlexNote"],
    learningValue: "英语听辨、物理实验和地理图表都能保留原始证据。",
    evidence: "研究方向线索；待字幕与隐私边界核验。",
  },
]

export function capabilitiesForTier(tier: WhiteboardTier): WhiteboardCapability[] {
  return WHITEBOARD_CAPABILITIES.filter((entry) => entry.tier === tier)
}
