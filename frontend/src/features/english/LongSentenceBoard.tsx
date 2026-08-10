import { useState } from "react"
import { CornerDownRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { splitSentence, type ClauseRole } from "@/lib/long-sentence"

/**
 * A 长难句, taken apart until its 主谓 sit next to each other.
 *
 * 语法题看结构不看词义：先找主谓，再定从句 is the advice this carries out, and the
 * hard half is the first one. The subject and its verb are rarely adjacent in a
 * sentence like this -- everything hanging off the subject sits between them --
 * so 找主谓 fails not because a word is unknown but because the sentence is too
 * wide to hold at once.
 *
 * Which is why the main clause is shown with an ellipsis standing where each
 * 从句 was lifted from, rather than with the 从句 coloured in place. Highlighting
 * leaves the sentence exactly as wide as it was; subtraction is what makes the
 * 主谓 land together.
 */

const ROLE_NAMES: Record<ClauseRole, string> = {
  main: "主句",
  relative: "定语从句",
  adverbial: "状语从句",
  nominal: "名词性从句",
}

export function LongSentenceBoard() {
  const [sentence, setSentence] = useState("")

  const written = sentence.trim() !== ""
  const split = splitSentence(sentence)
  const subordinate = split.clauses.filter((clause) => clause.role !== "main")
  // Main clauses first, in the order they were written. In sentence order the
  // 主句 lands underneath everything lifted off it -- which is the reading
  // problem this board exists to remove, reproduced in the answer.
  const ordered = [split.clauses.filter((clause) => clause.role === "main"), subordinate].flat()

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <Textarea
        aria-label="这句长难句"
        value={sentence}
        onChange={(event) => setSentence(event.target.value)}
        placeholder="把读不动的那一句抄进来"
        rows={3}
      />

      {written ? (
        <>
          {/* A sentence with nothing to lift is not a failure of the board, and
              reporting it as 拆成 1 个分句 would dress up a plain sentence as a
              hard one. Saying so plainly is the honest answer. */}
          <p role="status" className="text-xs text-muted-foreground">
            {subordinate.length === 0
              ? "这句不是长难句，主谓已经挨在一起了"
              : `拆成 ${split.depth} 个分句`}
          </p>

          <ul className="flex flex-col gap-1">
            {ordered.map((clause, index) => (
              <li
                key={`${index}-${clause.text}`}
                className={
                  clause.role === "main"
                    ? "rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-2.5 py-1.5"
                    : "rounded-lg border px-2.5 py-1.5"
                }
              >
                <div className="flex items-start gap-2">
                  {clause.role === "main" ? null : (
                    <CornerDownRight
                      aria-hidden="true"
                      className="mt-1 size-3.5 shrink-0 text-muted-foreground"
                    />
                  )}
                  <div className="grow">
                    <p className="text-sm">{clause.text}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant={clause.role === "main" ? "secondary" : "outline"}>
                        {ROLE_NAMES[clause.role]}
                      </Badge>
                      {/* The marker is the word that did the work, and naming it
                          is what makes 再定从句 something you can repeat on the
                          next sentence without this board. */}
                      {clause.marker === null ? null : (
                        <span className="text-xs text-muted-foreground">
                          由 {clause.marker} 引导
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
