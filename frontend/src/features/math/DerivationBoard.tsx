import { useState } from "react"
import { Check, CircleAlert, CircleHelp, Minus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { checkDerivation, type StepVerdict } from "@/lib/derivation"

export interface DerivationBoardValue {
  lines: string[]
}

interface DerivationBoardProps {
  initialValue?: DerivationBoardValue
  onChange?: (value: DerivationBoardValue) => void
}

function derivationLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter((line) => line !== "")
}

/**
 * A derivation, checked line against line.
 *
 * 定位到出错的那一步，而不是整题重做 is the advice this carries out: it names the
 * first line that does not follow, and deliberately says nothing about the
 * lines below it, since those are downstream of the break.
 */
export function DerivationBoard({ initialValue, onChange }: DerivationBoardProps = {}) {
  const [written, setWritten] = useState(() => initialValue?.lines.join("\n") ?? "")

  // A blank line between two steps is spacing. Numbering it would put the
  // reported line one off, which is the one number this board must get right.
  const lines = derivationLines(written)
  const checked = checkDerivation(lines)
  const broken = checked.steps.findIndex(
    (step) => step.verdict === "diverges" || step.verdict === "unreadable",
  )

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <Textarea
        aria-label="把过程一行一行写下来"
        value={written}
        onChange={(event) => {
          const next = event.target.value
          setWritten(next)
          onChange?.({ lines: derivationLines(next) })
        }}
        placeholder={"一行一步，比如\n2x+4=10\n2x=6\nx=3"}
        rows={5}
      />

      {lines.length >= 2 ? (
        <ol className="flex flex-col gap-1">
          {checked.steps.map((step, index) => (
            <li
              key={`${index}-${step.text}`}
              className={
                step.verdict === "diverges" || step.verdict === "unreadable"
                  ? "flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1.5"
                  : "flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
              }
            >
              <span className="w-8 shrink-0 text-xs tabular-nums text-muted-foreground">
                第 {index + 1} 行
              </span>
              <code className="grow text-sm">{step.text}</code>
              <Mark verdict={step.verdict} />
            </li>
          ))}
        </ol>
      ) : null}

      {/* One line is not a derivation, so 对得上 said of it is a tick for
          nothing. Two is where a step exists to check. */}
      {lines.length >= 2 && broken === -1 ? (
        <Badge variant="secondary" className="self-start">每一步都对得上</Badge>
      ) : null}

      {broken !== -1 ? (
        <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
          第 {broken + 1} 行{checked.steps[broken]?.note ?? ""}
        </p>
      ) : null}
    </div>
  )
}

function Mark({ verdict }: { verdict: StepVerdict }) {
  if (verdict === "diverges" || verdict === "unreadable") {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive">
        <CircleAlert aria-hidden="true" className="size-3.5" />
        {verdict === "diverges" ? "就是这一步" : "读不出来"}
      </span>
    )
  }
  if (verdict === "unchecked") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <CircleHelp aria-hidden="true" className="size-3.5" />
        没往下看
      </span>
    )
  }
  if (verdict === "start") {
    return <Minus aria-hidden="true" className="size-3.5 text-muted-foreground" />
  }
  return <Check aria-hidden="true" className="size-3.5 text-emerald-600 dark:text-emerald-400" />
}
