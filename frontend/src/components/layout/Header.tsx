import { Select } from "@/components/ui/select"
import { SUBJECTS } from "@/lib/subjects"
import { useSubjectStore } from "@/store/useSubjectStore"
import { ThemeToggle } from "./ThemeToggle"

export function Header() {
  const subject = useSubjectStore((state) => state.subject)
  const setSubject = useSubjectStore((state) => state.setSubject)
  return (
    <header className="sticky top-0 border-b border-border/80 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Select
            ariaLabel="切换学科"
            value={subject}
            onValueChange={setSubject}
            placeholder="学科"
            options={[
              { value: "all", label: "全部学科" },
              ...SUBJECTS.map((item) => ({ value: item.id, label: item.name })),
            ]}
            className="min-w-28"
          />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
