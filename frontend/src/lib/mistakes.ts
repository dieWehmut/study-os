export type MistakeCause = "recall" | "misread" | "careless" | "method" | "time" | "unknown"

export interface MistakeRecord {
  id: string
  subject: string
  question: string
  cause: MistakeCause
  note?: string
  /**
   * The library entry this question became, absent until it became one.
   *
   * A link rather than a "scheduled" flag, matching the column behind it: the
   * page needs to know *which* item to stop offering the button for, and two
   * fields answering "was it filed" and "into what" can disagree.
   */
  knowledgeItemId?: string
  createdAt: string
}

export interface MistakeCauseSpec {
  cause: MistakeCause
  label: string
  /**
   * Whether putting this back in the spaced-review queue would fix it.
   *
   * This is the load-bearing field. The rest of the app is review machinery,
   * so its answer to every wrong answer is "see it again sooner". That answer
   * is right for exactly one of these causes. For the others, rescheduling a
   * card reshuffles something that was never the problem, and the mistake
   * comes back looking like a memory failure it never was.
   */
  reviewFixes: boolean
  action: string
}

export interface MistakeCauseCount {
  spec: MistakeCauseSpec
  count: number
  percent: number
}

export interface MistakeSummary {
  total: number
  byCause: MistakeCauseCount[]
  reviewFixable: number
  needsOtherFix: number
}

/**
 * The taxonomy, in a fixed order.
 *
 * Deliberately short. A list long enough to describe every mistake precisely
 * is a list nobody finishes reading at the moment they most want to move on --
 * right after getting something wrong. Six choices fit in one glance.
 */
export const MISTAKE_CAUSES: MistakeCauseSpec[] = [
  {
    cause: "recall",
    label: "想不起来",
    reviewFixes: true,
    action: "回到记忆检测，让它排进复习队列",
  },
  {
    cause: "misread",
    label: "看错题",
    reviewFixes: false,
    action: "读题时先圈出条件和问的是什么，再动笔",
  },
  {
    cause: "careless",
    label: "算错 / 手滑",
    reviewFixes: false,
    action: "留出检查这一步的时间，别靠再记一遍",
  },
  {
    cause: "method",
    label: "思路不对",
    reviewFixes: false,
    action: "补的是方法，不是这道题：找同类题再做两道",
  },
  {
    cause: "time",
    label: "没时间做",
    reviewFixes: false,
    action: "问题在配速，不在这道题本身",
  },
  {
    cause: "unknown",
    label: "还没想清楚",
    reviewFixes: false,
    action: "先记下来，等想清楚再归类",
  },
]

/**
 * What to do about a cause, when one subject can say it better than in general.
 *
 * The six causes above are cognitive layers -- where in your head the failure
 * happened -- and they hold for every subject by construction. What does not
 * hold is the advice. 思路不对 in 物理 is almost always the wrong model picked,
 * and the fix is a drawing; the generic 找同类题再做两道 sends you to do more of
 * the thing that just failed.
 *
 * Only the pairs that genuinely differ appear here. Filling in all six causes
 * for all six subjects would be thirty-six sentences nobody wrote carefully and
 * nobody reads. A missing pair is not a gap -- it means the shared sentence was
 * already the right one.
 */
export const SUBJECT_CAUSE_ACTIONS: Record<string, Partial<Record<MistakeCause, string>>> = {
  physics: {
    method: "多半是模型选错了：重画受力图，先标接触面再标场力",
    misread: "先把过程分段，写出每段的初末状态，再回头看问的是哪一段",
    careless: "方向和单位各查一遍 —— 物理的手滑有一半是漏了负号",
  },
  chemistry: {
    method: "先认题型：这道考的是守恒、过量判断，还是平衡移动？认错型比算错更常见",
    careless: "配平系数和状态符号回查一遍，分数多半丢在这两处",
  },
  math: {
    method: "定位到出错的那一步，而不是整题重做：从哪一行开始和标准解法分岔",
    careless: "把中间步骤写全 —— 跳步省下的时间都赔在这里了",
  },
  geography: {
    method: "把因果链一环一环写出来，从成因到表现，缺哪一环就是丢分点",
    misread: "先看图例和比例尺，再回题干圈出限定词：时间、范围、程度",
  },
  chinese: {
    method: "对着得分点拆答案：踩到几个点，缺的是哪一类",
    unknown: "先照着范文标出得分点，再回头看自己缺的是哪一句",
  },
  english: {
    recall: "排进复习队列；同词族的其他词一起过，比单背这一个划算",
    method: "语法题看结构不看词义：先找主谓，再定从句",
  },
}

/**
 * The sentence to show under one cause, for the subject in hand.
 *
 * Falls back to the shared advice for a subject that says nothing of its own,
 * for 全部学科 (where a sentence naming 受力图 could land next to a 语文 row),
 * and for a subject id this table has never heard of -- subjects come from the
 * database, which is older than this table and will outlive it. An unknown id
 * should cost you the tailored sentence, not the row.
 */
export function causeActionFor(subject: string, cause: MistakeCause): string {
  const tailored = SUBJECT_CAUSE_ACTIONS[subject]?.[cause]
  if (tailored) return tailored
  return MISTAKE_CAUSES.find((spec) => spec.cause === cause)?.action ?? ""
}

/**
 * Count the log, ranked by how often each cause bit you.
 *
 * Causes you have never hit are left out entirely: six rows of zero bury the
 * two that matter. Ties keep the taxonomy's own order rather than whatever the
 * input happened to be in, so the same log always renders the same list.
 */
export function summarizeMistakes(records: MistakeRecord[]): MistakeSummary {
  const total = records.length
  const counts = new Map<MistakeCause, number>()
  for (const item of records) {
    counts.set(item.cause, (counts.get(item.cause) ?? 0) + 1)
  }

  const byCause = MISTAKE_CAUSES.flatMap((spec) => {
    const count = counts.get(spec.cause) ?? 0
    if (count === 0) return []
    return [{ spec, count, percent: Math.round((count / total) * 100) }]
  }).sort((a, b) => b.count - a.count)

  const reviewFixable = byCause.reduce(
    (sum, entry) => (entry.spec.reviewFixes ? sum + entry.count : sum),
    0,
  )

  return { total, byCause, reviewFixable, needsOtherFix: total - reviewFixable }
}

export const mistakesStorageKey = "study-os.mistakes"

let filedThisSession = 0

/**
 * Build a record of one mistake.
 *
 * Lives here rather than in the page because ids now outlive the session that
 * made them: two rows filed in the same millisecond, or one filed today and
 * one after a reload, still have to be told apart, or a 删除 could take the
 * row next to the one you meant.
 */
export function createMistake(filed: {
  subject: string
  question: string
  cause: MistakeCause
  note?: string
}): MistakeRecord {
  filedThisSession += 1
  const record: MistakeRecord = {
    id: `${Date.now().toString(36)}-${filedThisSession.toString(36)}`,
    subject: filed.subject,
    question: filed.question,
    cause: filed.cause,
    createdAt: new Date().toISOString(),
  }
  return filed.note ? { ...record, note: filed.note } : record
}

function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/**
 * Take a stored row only if it is a whole record.
 *
 * Everything downstream looks a row's cause up in the taxonomy to draw its
 * label, so a row naming a cause we have since renamed would render a blank
 * badge and count toward a total it belongs to nowhere in. Better to lose the
 * row than to show a mistake the page cannot describe.
 */
function toRecord(value: unknown): MistakeRecord | null {
  if (typeof value !== "object" || value === null) return null
  const row = value as Record<string, unknown>
  if (!isFilled(row.id) || !isFilled(row.question) || !isFilled(row.createdAt)) return null
  if (!MISTAKE_CAUSES.some((spec) => spec.cause === row.cause)) return null

  const record: MistakeRecord = {
    id: row.id,
    subject: isFilled(row.subject) ? row.subject : "all",
    question: row.question,
    cause: row.cause as MistakeCause,
    createdAt: row.createdAt,
  }
  return isFilled(row.note) ? { ...record, note: row.note } : record
}

export function readMistakes(): MistakeRecord[] {
  if (typeof localStorage === "undefined") return []

  try {
    const raw = localStorage.getItem(mistakesStorageKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      const record = toRecord(entry)
      return record ? [record] : []
    })
  } catch {
    return []
  }
}

export function writeMistakes(records: MistakeRecord[]): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(mistakesStorageKey, JSON.stringify(records))
  } catch {
    // Best-effort: a full or blocked store must not cost you the row you just
    // filed, which is still in memory and on screen.
  }
}

/**
 * Forget the browser-local log entirely.
 *
 * Removing the key rather than storing an empty array is what makes the
 * migration into the database a one-time event: an empty array is still an
 * answer, and readMistakes cannot tell "already carried over" from "nothing
 * was ever filed here".
 */
export function clearStoredMistakes(): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.removeItem(mistakesStorageKey)
  } catch {
    // A blocked store just means the carry-over is attempted again next time.
  }
}
