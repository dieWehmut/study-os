import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { checkStages, solveStage, type Quantity, type SolvedStage } from "@/lib/kinematics"

interface Field {
  key: Quantity
  label: string
  short: string
  unit: string
}

const fields: Field[] = [
  { key: "v0", label: "初速度（m/s）", short: "初速度", unit: "m/s" },
  { key: "v", label: "末速度（m/s）", short: "末速度", unit: "m/s" },
  { key: "a", label: "加速度（m/s²）", short: "加速度", unit: "m/s²" },
  { key: "t", label: "时间（s）", short: "时间", unit: "s" },
  { key: "x", label: "位移（m）", short: "位移", unit: "m" },
]

const empty: Record<Quantity, string> = { v0: "", v: "", a: "", t: "", x: "" }

/**
 * A blank box and a box holding nonsense are the same thing: a quantity you
 * have not given. Neither is an error worth interrupting for -- the stage is
 * simply solved from whatever else is there.
 */
function parse(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === "") return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

// Two decimals is the resolution of a 高中 answer line, and trailing zeros are
// noise: 10.00 m/s reads as a measurement when it is arithmetic.
function show(value: number | null): string {
  return value === null ? "—" : String(Number(value.toFixed(2)))
}

// No unit on a quantity there is no number for: "末速度 — m/s" claims a
// measurement was taken in metres per second and then lost.
function reading(value: number | null, field: Field): string {
  return value === null ? `${field.short} —` : `${field.short} ${show(value)} ${field.unit}`
}

/**
 * How wide to draw a stage on the timeline.
 *
 * Time, not displacement: a 匀速 stage covering most of the distance in a
 * moment and a long slow one are different shapes of the same problem, and
 * 时间 is the axis the stages are actually laid out along.
 */
function span(stage: SolvedStage, total: number): number {
  if (total <= 0 || stage.t === null || stage.t <= 0) return 0
  return (stage.t / total) * 100
}

export function MotionBoard() {
  const [stages, setStages] = useState<SolvedStage[]>([])
  const [name, setName] = useState("")
  const [draft, setDraft] = useState<Record<Quantity, string>>(empty)

  const warnings = checkStages(stages)
  const totalTime = stages.reduce((sum, stage) => sum + (stage.t ?? 0), 0)
  const totalDistance = stages.reduce((sum, stage) => sum + (stage.x ?? 0), 0)

  function add() {
    const trimmed = name.trim()
    if (trimmed === "") return
    setStages((current) => [
      ...current,
      solveStage({
        id: `${trimmed}-${current.length}`,
        name: trimmed,
        v0: parse(draft.v0),
        v: parse(draft.v),
        a: parse(draft.a),
        t: parse(draft.t),
        x: parse(draft.x),
      }),
    ])
    setName("")
    setDraft(empty)
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="grid gap-2">
        <Input
          aria-label="这一段叫什么"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="这一段叫什么？加速、刹车、飞出去……"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {fields.map((field) => (
            <Input
              key={field.key}
              aria-label={field.label}
              value={draft[field.key]}
              inputMode="decimal"
              placeholder={field.short}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [field.key]: event.target.value }))
              }
            />
          ))}
        </div>
        {/* Deliberately not "至少填三个": below three the stage is kept and
            left blank, because a process you have divided but not measured is
            still a division worth seeing. */}
        <Button type="button" size="sm" className="self-start" disabled={name.trim() === ""} onClick={add}>
          <Plus data-icon="inline-start" />
          加上这一段
        </Button>
      </div>

      {stages.length > 0 ? (
        <>
          {/* The timeline is the argument: 分段 means the process has parts
              with different lengths, and a list alone hides that. */}
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
            {stages.map((stage, index) => (
              <div
                key={stage.id}
                className={index % 2 === 0 ? "h-full bg-primary" : "h-full bg-primary/45"}
                style={{ width: `${span(stage, totalTime)}%` }}
              />
            ))}
          </div>

          <ul className="flex flex-col gap-2">
            {stages.map((stage) => (
              <li key={stage.id} className="rounded-lg border bg-muted/25 px-3 py-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">{stage.name}</h4>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    aria-label={`删掉 ${stage.name}`}
                    onClick={() => setStages((current) => current.filter((entry) => entry.id !== stage.id))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                  {fields.map((field) => (
                    <span key={field.key} className="flex items-center gap-1 text-xs">
                      <span
                        className={
                          stage[field.key] === null
                            ? "tabular-nums text-muted-foreground"
                            : "tabular-nums"
                        }
                      >
                        {reading(stage[field.key], field)}
                      </span>
                      {/* Which numbers are yours and which the board supplied
                          has to stay visible: a derived 末速度 that disagrees
                          with the 答案 means the stage was set up wrong, and
                          that is unreadable if it looks like something you
                          wrote. */}
                      {stage.derived.includes(field.key) ? (
                        <Badge variant="outline" className="px-1 py-0 text-[10px] font-normal">
                          算出来的
                        </Badge>
                      ) : null}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted-foreground">
            全程 {show(totalTime)} s · {show(totalDistance)} m
          </p>
        </>
      ) : null}

      {warnings.length > 0 ? (
        <ul role="alert" className="flex flex-col gap-1">
          {warnings.map((warning) => (
            <li key={warning} className="text-xs text-amber-600 dark:text-amber-400">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
