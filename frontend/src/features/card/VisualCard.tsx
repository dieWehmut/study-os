/**
 * A wiki, drawn as a shape.
 *
 * Zero logic. Everything on screen was decided by `card-layout`, which is a
 * pure function a test can check without a browser; this file turns its numbers
 * into elements and nothing else. That split is the point -- what these cards
 * have to get right is that nothing overflows, and jsdom has no layout engine,
 * so any geometry decided in CSS would be geometry no test could see.
 *
 * SVG rather than HTML for the same reason, and rather than SVG + foreignObject
 * because a foreignObject is silently dropped when the drawing is rasterised to
 * PNG -- the export would lose exactly the text it was exporting.
 */

import { useMemo } from "react"

import { readCard } from "@/lib/card-blocks"
import { layoutCard } from "@/lib/card-layout"
import { classify } from "@/lib/card-structure"
import { parseOutline } from "@/lib/outline"

export interface VisualCardProps {
  markdown: string
  title: string
}

/** Where an arrow's head sits, drawn as a small triangle at the line's end. */
function arrowHead(x1: number, y1: number, x2: number, y2: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const size = 7
  const left = angle + Math.PI * 0.85
  const right = angle - Math.PI * 0.85
  return [
    `${x2},${y2}`,
    `${x2 + Math.cos(left) * size},${y2 + Math.sin(left) * size}`,
    `${x2 + Math.cos(right) * size},${y2 + Math.sin(right) * size}`,
  ].join(" ")
}

export function VisualCard({ markdown, title }: VisualCardProps) {
  const drawing = useMemo(() => {
    if (!markdown.trim()) return null
    const { centre, blocks } = readCard(parseOutline(markdown, { title }))
    if (blocks.length < 2) return null
    const structure = classify(blocks, centre)
    return { structure, frame: layoutCard(blocks, structure, centre) }
  }, [markdown, title])

  if (!drawing) {
    return (
      <p className="text-sm text-muted-foreground">
        {markdown.trim() ? "这篇百科只有一段，没有可拆的结构。" : "这个知识点还没有详细百科。"}
      </p>
    )
  }

  const { frame, structure } = drawing

  return (
    <svg
      role="img"
      aria-label={`${title}·${structure}结构信息图`}
      data-structure={structure}
      data-width={frame.w}
      data-height={frame.h}
      viewBox={`0 0 ${frame.w} ${frame.h}`}
      width="100%"
      className="h-auto max-w-full rounded-lg border bg-card"
    >
      {frame.links.map((link) => (
        <g key={link.id} data-link>
          <line
            x1={link.x1}
            y1={link.y1}
            x2={link.x2}
            y2={link.y2}
            className="stroke-border"
            strokeWidth={1.5}
          />
          {link.arrow ? (
            <polygon
              points={arrowHead(link.x1, link.y1, link.x2, link.y2)}
              className="fill-muted-foreground"
            />
          ) : null}
        </g>
      ))}
      {frame.shapes.map((shape) => (
        <rect
          key={shape.id}
          data-block
          data-role={shape.role}
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          rx={10}
          className={
            shape.role === "centre"
              ? "fill-primary/10 stroke-primary"
              : "fill-muted/40 stroke-border"
          }
          strokeWidth={1.5}
        />
      ))}
      {frame.texts.map((text) => (
        <text
          key={text.id}
          x={text.x}
          y={text.y}
          fontSize={text.size}
          className={text.bold ? "fill-foreground font-medium" : "fill-muted-foreground"}
        >
          {text.text}
        </text>
      ))}
    </svg>
  )
}
