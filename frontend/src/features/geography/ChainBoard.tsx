import { useState } from "react"
import { ArrowDown, Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { checkChain, type ChainLink } from "@/lib/causal-chain"

/**
 * A 因果链, written out one 环 at a time.
 *
 * 把因果链一环一环写出来，从成因到表现，缺哪一环就是丢分点 is the advice this
 * carries out. Two boxes rather than one, because a chain typed as free text
 * joins up in your head as you read it -- the gap only becomes visible once
 * each 环 has to name where it starts.
 */
export function ChainBoard() {
  const [links, setLinks] = useState<ChainLink[]>([])
  const [cause, setCause] = useState("")
  const [effect, setEffect] = useState("")

  const checked = checkChain(links)
  const gaps = checked.links.filter((link) => link.verdict === "detached")
  const half = cause.trim() === "" || effect.trim() === ""

  function add() {
    if (half) return
    setLinks((current) => [...current, { cause: cause.trim(), effect: effect.trim() }])
    setCause("")
    setEffect("")
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="grid gap-2">
        <Input
          aria-label="成因"
          value={cause}
          onChange={(event) => setCause(event.target.value)}
          placeholder="因为……"
        />
        <Input
          aria-label="结果"
          value={effect}
          onChange={(event) => setEffect(event.target.value)}
          placeholder="所以……"
        />
        {/* Half a 环 is a line you have not finished, not a gap in the
            reasoning, and letting it in would report it as the wrong thing. */}
        <Button type="button" size="sm" className="self-start" disabled={half} onClick={add}>
          <Plus data-icon="inline-start" />
          加上这一环
        </Button>
      </div>

      {checked.links.length > 0 ? (
        <ol className="flex flex-col gap-1">
          {checked.links.map((link, index) => (
            <li
              key={`${index}-${link.cause}-${link.effect}`}
              className={
                link.verdict === "detached"
                  ? "rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5"
                  : "rounded-lg border px-2.5 py-1.5"
              }
            >
              <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-xs tabular-nums text-muted-foreground">
                  第 {index + 1} 环
                </span>
                <div className="grow">
                  <p className="text-sm">{link.cause}</p>
                  {/* The arrow is the claim: 因为……所以…… collapses into one
                      sentence on the page, and the direction is what a wrong
                      chain usually has backwards. */}
                  <p className="flex items-center gap-1 text-sm">
                    <ArrowDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                    {link.effect}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label={`删掉第 ${index + 1} 环`}
                  onClick={() => setLinks((current) => current.filter((_, at) => at !== index))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {/* One link is not a chain, so 连起来了 said of it is a tick for
          nothing. Two is where a join exists to check. */}
      {checked.links.length >= 2 && checked.joined ? (
        <Badge variant="secondary" className="self-start">因果链连起来了</Badge>
      ) : null}

      {gaps.length > 0 ? (
        <ul role="alert" className="flex flex-col gap-1">
          {gaps.map((link, index) => (
            <li key={`${index}-${link.cause}`} className="text-xs text-amber-600 dark:text-amber-400">
              {link.note}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
