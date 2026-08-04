import { Atom, BookOpenText, FlaskConical, Languages, Map, Sigma } from "lucide-react"

import { SUBJECTS, subjectMeta } from "@/lib/subjects"
import { cn } from "@/lib/utils"

const subjectIcons: Record<string, typeof Languages> = {
  chinese: BookOpenText,
  math: Sigma,
  english: Languages,
  physics: Atom,
  chemistry: FlaskConical,
  geography: Map,
}

interface SubjectPickerProps {
  subject: string
  onSelect: (subject: string) => void
  dueCounts?: Record<string, number>
}

export function SubjectPicker({ subject, onSelect, dueCounts }: SubjectPickerProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="选择学科">
      {SUBJECTS.map(({ id }) => {
        const meta = subjectMeta(id)
        const Icon = subjectIcons[id]
        const active = subject === id
        if (!meta) return null
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            aria-label={meta.name}
            onClick={() => onSelect(id)}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-transparent shadow-sm" : "border-border bg-card hover:bg-muted/50",
            )}
            style={active ? { borderColor: meta.color, backgroundColor: `${meta.color}14` } : undefined}
          >
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg"
              style={{ color: meta.color, backgroundColor: `${meta.color}18` }}
            >
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium" style={active ? { color: meta.color } : undefined}>{meta.name}</span>
              <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                {meta.tagline}
                {dueCounts?.[id] ? (
                  <span className="rounded-full px-1.5 text-[0.68rem] font-medium" style={{ color: meta.color, backgroundColor: `${meta.color}18` }}>
                    {dueCounts[id]} 待复习
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
