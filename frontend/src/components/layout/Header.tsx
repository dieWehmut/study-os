import { SubjectBadge } from "@/features/subjects/SubjectBadge"
import { useSubjectStore } from "@/store/useSubjectStore"
import { ThemeToggle } from "./ThemeToggle"

export function Header() {
  const subject = useSubjectStore((state) => state.subject)
  return (
    <header className="sticky top-0 border-b border-border/80 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <ThemeToggle />
        {subject !== "all" ? <SubjectBadge subject={subject} /> : null}
      </div>
    </header>
  )
}
