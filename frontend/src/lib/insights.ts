/**
 * The insight types that hold whatever you are studying.
 *
 * 二级结论 (what the textbook did not print but the problems assume), 解题策略
 * (what to reach for), 易错信号 (what to distrust). These are the fallback, not
 * the default: a subject that has worked out its own sort uses that instead.
 */
export const SHARED_INSIGHT_TAGS = ["二级结论", "解题策略", "易错信号"] as const

/**
 * The types one subject sorts its own conclusions by.
 *
 * 0801: 「以后你独立总结出的『地理六类错因』，就可以作为地理学科的专属分类体系」.
 * The same argument applies here. 化学 does not think in 二级结论; it thinks in
 * 考点 / 题型 / 易错点, and flattening those three into one generic word loses
 * exactly the distinction that makes the tag worth applying.
 *
 * A subject's vocabulary *replaces* the shared one rather than adding to it.
 * The union would put 易错信号 next to 易错点 -- two buttons for one idea, and
 * an item tagged with whichever you happened to press first.
 *
 * Unlike the cause taxonomy, these are free-form TEXT in tags_json; the backend
 * filters by exact string and holds no closed set, so a subject may name its
 * own types without the server having to learn them.
 */
export const SUBJECT_INSIGHT_TAGS: Record<string, readonly string[]> = {
  english: ["词族", "固定搭配", "语法点"],
  physics: ["模型选择", "临界条件", "图像结论"],
  chemistry: ["考点", "题型", "易错点"],
  math: ["通法", "易错步骤", "反例"],
  geography: ["因果链", "区域对比", "分布规律"],
  chinese: ["得分点", "表达模板", "素材"],
}

/**
 * The insight types to offer for a subject.
 *
 * Falls back to the shared three for 全部学科 -- where a button reading 受力图
 * could land beside a 语文 item -- and for a subject id this table has never
 * heard of. Subjects come from the database, which is older than this table and
 * will outlive it; an unknown id should cost the tailored vocabulary, not the
 * control.
 */
export function insightTagsFor(subject: string): readonly string[] {
  return SUBJECT_INSIGHT_TAGS[subject] ?? SHARED_INSIGHT_TAGS
}

/**
 * The tag buttons to draw for one item: its subject's vocabulary, plus whatever
 * it already carries.
 *
 * Without the second half the vocabularies become one-way doors. Tag an item
 * 考点 under 化学, open it under 全部学科, and the button is gone -- the tag is
 * set, invisible, and unremovable. Anything written on an item must stay
 * takeable off from wherever you find it.
 *
 * The subject's own three come first regardless, so the buttons you press daily
 * do not shift position because an old tag survives on this one item.
 */
export function tagOptionsFor(subject: string, existing: readonly string[] = []): readonly string[] {
  const vocabulary = insightTagsFor(subject)
  const strays = existing.filter((tag) => tag && !vocabulary.includes(tag))
  return [...vocabulary, ...new Set(strays)]
}
