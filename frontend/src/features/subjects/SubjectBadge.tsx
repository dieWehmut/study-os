import { subjectMeta } from "@/lib/subjects"

export function SubjectBadge({ subject, className }: { subject: string; className?: string }) {
  const meta = subjectMeta(subject)
  if (!meta) return null
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${className ?? ""}`}
      style={{ color: meta.color, borderColor: `${meta.color}40`, backgroundColor: `${meta.color}12` }}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.name}
    </span>
  )
}
