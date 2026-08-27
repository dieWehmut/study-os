import { Atom, BookOpenText, FlaskConical, Languages, Map, Sigma } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SUBJECTS, subjectMeta } from "@/lib/subjects"
import { prescriptionFor, type SubjectPrescription } from "@/lib/subject-prescriptions"
import { cn } from "@/lib/utils"

const subjectIcons: Record<string, typeof Languages> = {
  chinese: BookOpenText,
  math: Sigma,
  english: Languages,
  physics: Atom,
  chemistry: FlaskConical,
  geography: Map,
}

interface SubjectPrescriptionPanelProps {
  subject: string
  onSelectSubject?: (subject: string) => void
}

function SubjectIcon({ subject }: { subject: string }) {
  const Icon = subjectIcons[subject] ?? BookOpenText
  return <Icon aria-hidden="true" className="size-4" />
}

function CompactCard({
  prescription,
  onSelect,
}: {
  prescription: SubjectPrescription
  onSelect?: () => void
}) {
  const meta = subjectMeta(prescription.id)
  const content = (
    <>
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-lg"
        style={meta ? { color: meta.color, backgroundColor: `${meta.color}18` } : undefined}
      >
        <SubjectIcon subject={prescription.id} />
      </span>
      <span className="min-w-0 text-left">
        <span className="block font-medium">{meta?.name ?? prescription.id}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{prescription.focus}</span>
      </span>
    </>
  )

  if (!onSelect) {
    return <div data-testid="subject-prescription-card" className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">{content}</div>
  }

  return (
    <button
      type="button"
      data-testid="subject-prescription-card"
      className="flex min-w-0 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onSelect}
      aria-label={`${meta?.name ?? prescription.id}：${prescription.focus}`}
    >
      {content}
    </button>
  )
}

function DetailedPrescription({ prescription }: { prescription: SubjectPrescription }) {
  const meta = subjectMeta(prescription.id)
  const titleID = `subject-prescription-${prescription.id}`
  return (
    <Card
      data-testid="subject-prescription-detail"
      className="border-primary/25 bg-primary/[.025]"
      role="region"
      aria-labelledby={titleID}
    >
      <CardHeader className="gap-2">
        <div className="flex items-center gap-2">
          <span
            className="grid size-8 place-items-center rounded-lg"
            style={meta ? { color: meta.color, backgroundColor: `${meta.color}18` } : undefined}
          >
            <SubjectIcon subject={prescription.id} />
          </span>
          <CardTitle>
            <h2 id={titleID}>{meta?.name ?? prescription.id}学习处方</h2>
          </CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">先查：{prescription.focus}</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">现在做</h3>
          <ol className="grid gap-1.5 sm:grid-cols-3">
            {prescription.actions.map((action, index) => (
              <li key={action} className="flex gap-2 rounded-lg border bg-card px-2.5 py-2 text-sm">
                <Badge variant="secondary" className="mt-0.5 size-5 justify-center px-0">{index + 1}</Badge>
                <span>{action}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="grid gap-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">留下证据</h3>
          <p className="text-sm">{prescription.evidence}</p>
        </div>
        <div className="grid gap-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">下一次验证</h3>
          <p className="text-sm">{prescription.nextStep}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function SubjectPrescriptionPanel({ subject, onSelectSubject }: SubjectPrescriptionPanelProps) {
  const selected = prescriptionFor(subject)

  if (subject !== "all" && selected) {
    return (
      <section className="grid gap-3">
        <DetailedPrescription prescription={selected} />
      </section>
    )
  }

  if (subject !== "all" && !selected) {
    return (
      <Card data-testid="subject-prescription-fallback" role="region" aria-labelledby="subject-prescription-fallback-title">
        <CardHeader>
          <CardTitle><h2 id="subject-prescription-fallback-title">学习处方</h2></CardTitle>
          <p className="text-sm text-muted-foreground">暂未配置这门学科的专属动作，先记录题目和错因。</p>
        </CardHeader>
      </Card>
    )
  }

  return (
    <section aria-labelledby="subject-prescription-title" className="grid gap-3">
      <div className="grid gap-1">
        <h2 id="subject-prescription-title" className="text-base font-semibold">六科学习处方</h2>
        <p className="text-xs text-muted-foreground">每科先查不同的能力；点进一科查看具体动作。</p>
      </div>
      <div className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-3")} aria-label="六科学习处方">
        {SUBJECTS.map(({ id }) => {
          const prescription = prescriptionFor(id)
          if (!prescription) return null
          return (
            <CompactCard
              key={id}
              prescription={prescription}
              onSelect={onSelectSubject ? () => onSelectSubject(id) : undefined}
            />
          )
        })}
      </div>
    </section>
  )
}
