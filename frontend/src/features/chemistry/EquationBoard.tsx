import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { checkEquation, type Species } from "@/lib/equation"

import { Formula } from "./Formula"

export interface EquationBoardValue {
  equation: string
}

interface EquationBoardProps {
  initialValue?: EquationBoardValue
  onChange?: (value: EquationBoardValue) => void
}

/**
 * A written equation, read back as chemistry rather than as a line of text.
 *
 * 配平系数和状态符号回查一遍 is advice you cannot act on by re-reading your own
 * handwriting -- the whole failure is that it looked right the first time. So
 * the board counts the atoms itself and names what disagrees.
 */
export function EquationBoard({ initialValue, onChange }: EquationBoardProps = {}) {
  const [equation, setEquation] = useState(() => initialValue?.equation ?? "")

  const written = equation.trim() !== ""
  const checked = checkEquation(equation)
  const problems = written && checked.error === null
    ? [
        ...checked.differences.map((entry) => `${entry.element}：左 ${entry.left}，右 ${entry.right}`),
        ...(checked.missingStates.length > 0
          ? [`没写状态符号：${checked.missingStates.join("、")}`]
          : []),
      ]
    : []

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <Input
        aria-label="化学方程式"
        value={equation}
        onChange={(event) => {
          const next = event.target.value
          setEquation(next)
          onChange?.({ equation: next })
        }}
        placeholder="例如 2H2 + O2 = 2H2O"
      />

      {written && checked.error === null ? (
        <>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border bg-muted/25 px-3 py-2">
            <Side species={checked.left} />
            <span className="px-1 text-muted-foreground">=</span>
            <Side species={checked.right} />
          </div>
          {checked.balanced ? (
            <Badge variant="secondary" className="self-start">配平了</Badge>
          ) : (
            <Badge variant="destructive" className="self-start">还没配平</Badge>
          )}
        </>
      ) : null}

      {/* An empty box is not a mistake, so "还没有写方程式" is never shown --
          being told you have not started is the one message with no next step. */}
      {written && checked.error !== null ? (
        <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
          {checked.error}
        </p>
      ) : null}

      {problems.length > 0 ? (
        <ul role="alert" className="flex flex-col gap-1">
          {problems.map((problem) => (
            <li key={problem} className="text-xs text-amber-600 dark:text-amber-400">
              {problem}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Side({ species }: { species: Species[] }) {
  return (
    <>
      {species.map((entry, index) => (
        <span key={`${entry.formula}-${index}`} className="flex items-center gap-0.5">
          {index > 0 ? <span className="px-1 text-muted-foreground">+</span> : null}
          {/* A coefficient of 1 is never printed -- H2O, not 1H2O -- and
              printing it here would put a digit on the line that is not in the
              equation being checked. */}
          <Formula value={entry.coefficient === 1 ? entry.formula : `${entry.coefficient}${entry.formula}`} />
          {entry.state !== null ? (
            <span className="text-xs text-muted-foreground">({entry.state})</span>
          ) : null}
        </span>
      ))}
    </>
  )
}
