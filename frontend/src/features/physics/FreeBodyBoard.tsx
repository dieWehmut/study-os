import { useState } from "react"
import { Plus, Trash2, Triangle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { checkForces, resolveForces, type Force, type ForceKind } from "@/lib/freebody"

export interface FreeBodyBoardValue {
  forces: Force[]
}

interface FreeBodyBoardProps {
  initialValue?: FreeBodyBoardValue
  onChange?: (value: FreeBodyBoardValue) => void
}

/** Where the body sits on the canvas, and how long a 1 N arrow is drawn. */
const centre = 120
const canvas = 240

/**
 * Scale every arrow against the largest force on the board.
 *
 * Absolute newtons-per-pixel cannot work: the same board has to draw a 0.5 N
 * 摩擦力 and a 600 N 重力. What the picture is for is the *ratio* between the
 * forces and their directions, and both survive rescaling.
 */
function arrowLength(magnitude: number, largest: number): number {
  if (largest <= 0) return 0
  return (magnitude / largest) * (centre - 30)
}

// SVG's y axis points down and physics' points up, so every angle is negated
// on the way to a coordinate. Doing it in one place is what keeps 重力 at 270°
// from being drawn upwards.
function pointAt(angle: number, length: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180
  return { x: centre + length * Math.cos(radians), y: centre - length * Math.sin(radians) }
}

export function FreeBodyBoard({ initialValue, onChange }: FreeBodyBoardProps = {}) {
  const [forces, setForces] = useState<Force[]>(() =>
    initialValue?.forces.map((force) => ({ ...force })) ?? [],
  )
  const [name, setName] = useState("")
  const [magnitude, setMagnitude] = useState("")
  const [angle, setAngle] = useState("")
  const [kind, setKind] = useState<ForceKind>("contact")

  const size = Number(magnitude)
  const direction = Number(angle)
  // A force needs a name to be checkable, and an arrow you cannot check is
  // the one thing this board must not draw. A blank angle reads as 0°, but a
  // blank or non-numeric size would draw nothing at all.
  const ready = name.trim().length > 0 && magnitude.trim().length > 0 && Number.isFinite(size) && Number.isFinite(direction)

  const resultant = resolveForces(forces)
  const warnings = checkForces(forces)
  const largest = forces.reduce((most, force) => Math.max(most, Math.abs(force.magnitude)), 0)

  function add() {
    if (!ready) return
    const next = [
      ...forces,
      { id: `${name.trim()}-${forces.length}`, name: name.trim(), magnitude: size, angle: direction, kind },
    ]
    setForces(next)
    onChange?.({ forces: next })
    setName("")
    setMagnitude("")
    setAngle("")
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
      <svg
        role="img"
        aria-label={`受力图，共 ${forces.length} 个力`}
        viewBox={`0 0 ${canvas} ${canvas}`}
        className="h-60 w-60 rounded-lg border bg-muted/25"
      >
        {/* Axes, faint: the drawing is about directions, and a bare arrow on
            an empty square gives the eye nothing to read an angle against. */}
        <line x1="0" y1={centre} x2={canvas} y2={centre} className="stroke-border" strokeWidth="1" />
        <line x1={centre} y1="0" x2={centre} y2={canvas} className="stroke-border" strokeWidth="1" />
        {forces.map((force) => {
          const tip = pointAt(force.angle, arrowLength(force.magnitude, largest))
          return (
            <line
              key={force.id}
              x1={centre}
              y1={centre}
              x2={tip.x}
              y2={tip.y}
              className={force.kind === "field" ? "stroke-amber-500" : "stroke-primary"}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          )
        })}
        {/* The resultant last, so it is never hidden under a component of
            itself, and dashed so it cannot be mistaken for a force acting. */}
        {resultant.angle !== null ? (
          <line
            x1={centre}
            y1={centre}
            x2={pointAt(resultant.angle, arrowLength(resultant.magnitude, largest)).x}
            y2={pointAt(resultant.angle, arrowLength(resultant.magnitude, largest)).y}
            className="stroke-destructive"
            strokeWidth="2"
            strokeDasharray="5 3"
          />
        ) : null}
        <circle cx={centre} cy={centre} r="5" className="fill-foreground" />
      </svg>

      <div className="grid content-start gap-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem]">
          <label className="grid gap-1 text-xs text-muted-foreground" htmlFor="force-name">
            力的名称
            <Input id="force-name" value={name} placeholder="支持力" onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground" htmlFor="force-magnitude">
            大小（N）
            <Input id="force-magnitude" inputMode="decimal" value={magnitude} onChange={(event) => setMagnitude(event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground" htmlFor="force-angle">
            方向（度）
            <Input id="force-angle" inputMode="decimal" value={angle} placeholder="90" onChange={(event) => setAngle(event.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* The split is the advice itself -- 先标接触面再标场力 -- so it is a
              choice you make per force, not a label applied afterwards. */}
          <Button type="button" size="xs" variant={kind === "contact" ? "default" : "outline"} onClick={() => setKind("contact")}>
            接触力
          </Button>
          <Button type="button" size="xs" variant={kind === "field" ? "default" : "outline"} onClick={() => setKind("field")}>
            场力
          </Button>
          <Button type="button" size="sm" className="ml-auto" disabled={!ready} onClick={add}>
            <Plus data-icon="inline-start" />加上这个力
          </Button>
        </div>

        {forces.length > 0 ? (
          <ul className="grid gap-1">
            {forces.map((force) => (
              <li key={force.id} className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1 text-sm">
                <span className={force.kind === "field" ? "text-amber-600 dark:text-amber-400" : "text-primary"}>
                  <Triangle aria-hidden="true" className="size-3" />
                </span>
                <span>{force.name}</span>
                <span className="tabular-nums text-muted-foreground">{force.magnitude} N · {force.angle}°</span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  className="ml-auto"
                  aria-label={`删掉 ${force.name}`}
                  onClick={() => {
                    const next = forces.filter((entry) => entry.id !== force.id)
                    setForces(next)
                    onChange?.({ forces: next })
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            先标接触面上的力，再标场力。
          </p>
        )}

        {forces.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/25 px-3 py-2 text-sm">
            <span className="text-muted-foreground">合力</span>
            {resultant.balanced ? (
              <Badge variant="secondary">受力平衡</Badge>
            ) : (
              <span className="tabular-nums font-medium">
                {resultant.magnitude.toFixed(1)} N · {Math.round(resultant.angle ?? 0)}°
              </span>
            )}
          </div>
        ) : null}

        {warnings.map((warning) => (
          <p key={warning} className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            {warning}
          </p>
        ))}
      </div>
    </div>
  )
}
