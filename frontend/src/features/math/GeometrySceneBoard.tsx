import { useMemo, useState } from "react"
import { RotateCcw, Triangle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  validateGeometryScene,
  type GeometryPoint,
  type GeometryScene,
} from "@/lib/geometry-scene"

interface GeometrySceneBoardProps {
  scene: GeometryScene
}

function pointMap(points: GeometryPoint[]) {
  return new Map(points.map((point) => [point.id, point]))
}

function lineCoordinates(points: GeometryPoint[], from: string, to: string) {
  const byID = pointMap(points)
  const start = byID.get(from)
  const end = byID.get(to)
  return start && end ? { start, end } : null
}

/** Render only validated primitives from a GeometryScene; no model code is executed. */
export function GeometrySceneBoard({ scene }: GeometrySceneBoardProps) {
  const validation = useMemo(() => validateGeometryScene(scene), [scene])
  const draggable = scene.points.find((point) => point.draggable)
  const fixedPoints = scene.points.filter((point) => point.id !== draggable?.id)
  const baselineY = draggable
    ? fixedPoints.length > 0
      ? Math.max(...fixedPoints.map((point) => point.y))
      : scene.viewBox.height - 20
    : 0
  const initialHeight = draggable ? Math.max(20, Math.round(baselineY - draggable.y)) : 0
  const [height, setHeight] = useState(initialHeight)
  const points = useMemo(() => {
    if (!draggable) return scene.points
    return scene.points.map((point) =>
      point.id === draggable.id ? { ...point, y: baselineY - height } : point,
    )
  }, [baselineY, draggable, height, scene.points])

  if (!validation.ok) {
    return (
      <div data-testid="geometry-scene-board" className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
        <p className="text-sm font-medium">图形条件无法绘制</p>
        <ul role="alert" className="grid gap-1 text-xs text-destructive">
          {validation.errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      </div>
    )
  }

  const byID = pointMap(points)
  return (
    <div data-testid="geometry-scene-board" className="grid gap-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Triangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="grid gap-1">
            <h3 className="text-sm font-semibold">{scene.title}</h3>
            <p className="text-xs text-muted-foreground">先把已知条件放进图里，再决定使用哪条定理。</p>
          </div>
        </div>
        <Button size="xs" variant="outline" onClick={() => setHeight(initialHeight)} disabled={!draggable}>
          <RotateCcw data-icon="inline-start" />恢复初始图形
        </Button>
      </div>

      <svg
        data-testid="geometry-scene-svg"
        role="img"
        aria-label={scene.title}
        viewBox={`0 0 ${scene.viewBox.width} ${scene.viewBox.height}`}
        className="h-auto max-h-64 w-full rounded-lg bg-muted/20"
      >
        <g stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {scene.segments.map((segment) => {
            const coordinates = lineCoordinates(points, segment.from, segment.to)
            return coordinates ? (
              <line
                key={segment.id}
                data-testid={`geometry-segment-${segment.id}`}
                x1={coordinates.start.x}
                y1={coordinates.start.y}
                x2={coordinates.end.x}
                y2={coordinates.end.y}
                strokeDasharray={segment.dashed ? "5 4" : undefined}
              />
            ) : null
          })}
          {scene.circles.map((circle) => {
            const center = byID.get(circle.center)
            return center ? <circle key={circle.id} cx={center.x} cy={center.y} r={circle.radius} /> : null
          })}
          {scene.graphs.map((graph) => (
            <polyline
              key={graph.id}
              data-testid={`geometry-graph-${graph.id}`}
              points={graph.samples.map((sample) => `${sample.x},${sample.y}`).join(" ")}
              className="stroke-primary"
            />
          ))}
        </g>
        {points.map((point) => (
          <g key={point.id}>
            <circle cx={point.x} cy={point.y} r="4" className="fill-primary" />
            {point.label ? <text x={point.x + 7} y={point.y - 7} className="fill-foreground text-[11px]">{point.label}</text> : null}
          </g>
        ))}
      </svg>

      {draggable ? (
        <label className="grid gap-1 text-xs" htmlFor="geometry-height">
          <span className="flex items-center justify-between gap-2">
            <span>顶点 {draggable.label ?? draggable.id} 高度</span>
            <span className="tabular-nums text-muted-foreground">三角形高度：{height}</span>
          </span>
          <input
            id="geometry-height"
            aria-label={`顶点 ${draggable.label ?? draggable.id} 高度`}
            type="range"
            min={20}
            max={Math.max(20, Math.round(baselineY))}
            value={height}
            onChange={(event) => setHeight(Number(event.target.value))}
            className="accent-primary"
          />
        </label>
      ) : null}

      <div className="flex flex-wrap gap-1.5" aria-label="图形条件">
        {scene.conditions.map((condition) => <Badge key={condition.id} variant="secondary">{condition.label}</Badge>)}
      </div>
    </div>
  )
}
