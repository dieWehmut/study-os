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

export function subjectName(id: string): string {
  return SUBJECTS.find((subject) => subject.id === id)?.name ?? id
}
