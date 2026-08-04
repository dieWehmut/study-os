export interface SubjectInfo {
  id: string
  name: string
}

export const SUBJECTS: SubjectInfo[] = [
  { id: "chinese", name: "语文" },
  { id: "math", name: "数学" },
  { id: "english", name: "英语" },
  { id: "physics", name: "物理" },
  { id: "chemistry", name: "化学" },
  { id: "geography", name: "地理" },
]

export interface SubjectMeta extends SubjectInfo {
  color: string
  tagline: string
}

export const SUBJECT_META: Record<string, SubjectMeta> = {
  chinese: { id: "chinese", name: "语文", color: "#b45309", tagline: "背诵 · 文言 · 作文" },
  math: { id: "math", name: "数学", color: "#2563eb", tagline: "公式 · 二级结论 · 题型" },
  english: { id: "english", name: "英语", color: "#16a34a", tagline: "单词 · 短语 · 句型" },
  physics: { id: "physics", name: "物理", color: "#7c3aed", tagline: "公式 · 实验 · 模型" },
  chemistry: { id: "chemistry", name: "化学", color: "#dc2626", tagline: "方程式 · 性质 · 规律" },
  geography: { id: "geography", name: "地理", color: "#0d9488", tagline: "概念 · 地图 · 区位" },
}

export function subjectName(id: string): string {
  return SUBJECTS.find((subject) => subject.id === id)?.name ?? id
}

export function subjectMeta(id: string): SubjectMeta | undefined {
  return SUBJECT_META[id]
}
