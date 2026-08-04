import { SUBJECTS, subjectMeta } from "@/lib/subjects"
import { cn } from "@/lib/utils"

interface SubjectChipsProps {
  subject: string
  onSelect: (subject: string) => void
  className?: string
}

export function SubjectChips({ subject, onSelect, className }: SubjectChipsProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} aria-label="选择学科">
      <button
        type="button"
        aria-pressed={subject === "all"}
        onClick={() => onSelect("all")}
        className={cn(
          "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          subject === "all"
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card text-muted-foreground hover:bg-muted",
        )}
      >
        全部
      </button>
      {SUBJECTS.map(({ id }) => {
        const meta = subjectMeta(id)
        const active = subject === id
        if (!meta) return null
        return (
          <button
            key={id}
            type="button"
            aria-label={meta.name}
            aria-pressed={active}
            onClick={() => onSelect(id)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-transparent" : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
            style={active ? { borderColor: meta.color, backgroundColor: `${meta.color}14`, color: meta.color } : undefined}
          >
            {meta.name}
          </button>
        )
      })}
    </div>
  )
}
