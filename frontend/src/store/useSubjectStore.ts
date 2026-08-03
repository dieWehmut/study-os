import { create } from "zustand"

import { SUBJECTS } from "@/lib/subjects"

const SUBJECT_STORAGE_KEY = "study-os.subject"

export function readSavedSubject(): string {
  const saved = localStorage.getItem(SUBJECT_STORAGE_KEY)
  return SUBJECTS.some((subject) => subject.id === saved) ? (saved as string) : "all"
}

interface SubjectStore {
  subject: string
  setSubject: (subject: string) => void
}

export const useSubjectStore = create<SubjectStore>((set) => ({
  subject: readSavedSubject(),
  setSubject: (subject) => {
    localStorage.setItem(SUBJECT_STORAGE_KEY, subject)
    set({ subject })
  },
}))
