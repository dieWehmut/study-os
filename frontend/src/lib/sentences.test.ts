import { describe, expect, it } from "vitest"

import { splitSentences } from "./sentences"

describe("sentence splitting", () => {
  it("merges short sentences so one request is worth making", () => {
    // A request per sentence would spend the wall clock on round trips, and
    // every seam restarts the voice's prosody from nothing.
    const text = "光合作用发生在叶绿体中。光反应在类囊体薄膜上进行。暗反应在基质中进行。"

    expect(splitSentences(text)).toEqual([text])
  })

  it("cuts at the sentence end once a piece is long enough", () => {
    const text = "光合作用发生在叶绿体中。光反应在类囊体薄膜上进行。暗反应在基质中进行。"

    expect(splitSentences(text, 12)).toEqual([
      "光合作用发生在叶绿体中。",
      // The last sentence is under the minimum, so it rides along rather than
      // becoming a request of its own.
      "光反应在类囊体薄膜上进行。暗反应在基质中进行。",
    ])
  })

  it("cuts English prose at the stop, not inside it", () => {
    const text = "The mitochondrion makes ATP. It is a small organelle. Nothing else lives here."

    expect(splitSentences(text, 1)).toEqual([
      "The mitochondrion makes ATP.",
      "It is a small organelle.",
      "Nothing else lives here.",
    ])
  })

  it("handles a passage that switches language mid-way", () => {
    const text = "The answer is simple. 然后是中文的一句话。And then English again."

    expect(splitSentences(text, 1)).toEqual([
      "The answer is simple.",
      "然后是中文的一句话。",
      "And then English again.",
    ])
  })

  it("keeps a run of stops with the sentence it closes", () => {
    expect(splitSentences("真的吗？！他说是的。", 1)).toEqual(["真的吗？！", "他说是的。"])
  })

  it("returns the whole passage when nothing terminates a sentence", () => {
    // A heading or a bullet often has no stop at all. Returning nothing would
    // read it as silence.
    const text = "没有任何标点的一段话"

    expect(splitSentences(text, 1)).toEqual([text])
  })

  it("returns nothing for an empty or blank passage", () => {
    expect(splitSentences("")).toEqual([])
    expect(splitSentences("   \n\n  ")).toEqual([])
  })

  it("never emits a blank piece", () => {
    const chunks = splitSentences("第一句。\n\n第二句。\n", 1)

    expect(chunks).toEqual(["第一句。", "第二句。"])
  })

  it("does not cut inside inline maths", () => {
    // A dot inside a formula is notation. Cutting here would hand the engine
    // half an equation and read the other half as a new sentence.
    const text = "已知 $a = b. C = d$ 时结论成立。"

    expect(splitSentences(text, 1)).toEqual([text])
  })

  it("does not cut inside display maths", () => {
    const text = "推导得到 $$x = 1. Y = 2$$ 这一结果。"

    expect(splitSentences(text, 1)).toEqual([text])
  })

  // An independent review found this one: a "$" living inside a code span was
  // itself read as the start of a maths span, and the scanner went hunting
  // for its close in the *next* real formula -- tearing that formula in half.
  it("does not let a dollar sign inside a code span open a maths span", () => {
    const text = "Use `$` as a delimiter. 已知 $x = 1. Y = 2$ 时结论成立。"

    expect(splitSentences(text, 1)).toEqual([
      "Use `$` as a delimiter.",
      "已知 $x = 1. Y = 2$ 时结论成立。",
    ])
  })

  it("keeps an abbreviation with its sentence", () => {
    expect(splitSentences("See No. 7 for the answer. It is there.", 1)).toEqual([
      "See No. 7 for the answer.",
      "It is there.",
    ])
    expect(splitSentences("Use an indicator, e.g. iodine solution, first.", 1)).toEqual([
      "Use an indicator, e.g. iodine solution, first.",
    ])
  })

  it("keeps a decimal number whole", () => {
    expect(splitSentences("光速约为 3.0 乘以十的八次方米每秒。", 1)).toEqual([
      "光速约为 3.0 乘以十的八次方米每秒。",
    ])
  })

  it("loses no text, so the passage is read in full", () => {
    const text = "第一句话。第二句话！第三句话？还有一句没有句号"
    const strip = (value: string) => value.replace(/\s/g, "")

    expect(strip(splitSentences(text, 5).join(""))).toBe(strip(text))
  })
})
