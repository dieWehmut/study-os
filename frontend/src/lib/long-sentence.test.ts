import { describe, expect, it } from "vitest"

import { splitSentence } from "./long-sentence"

describe("splitSentence", () => {
  it("leaves a sentence with one verb alone", () => {
    const split = splitSentence("The book is on the table.")

    expect(split.clauses).toHaveLength(1)
    expect(split.clauses[0]?.role).toBe("main")
    expect(split.clauses[0]?.text).toBe("The book is on the table.")
  })

  it("lifts a relative clause out so the 主谓 end up next to each other", () => {
    // This is the whole point of the tool. 先找主谓 fails on a long sentence
    // because the subject and its verb are pushed apart by everything hanging
    // off the subject -- not because any word in it is hard.
    const split = splitSentence("The book that I bought yesterday is on the table.")

    const main = split.clauses.find((clause) => clause.role === "main")
    expect(main?.text).toBe("The book … is on the table.")
  })

  it("names the clause it lifted out, and what introduced it", () => {
    const split = splitSentence("The book that I bought yesterday is on the table.")

    const relative = split.clauses.find((clause) => clause.role === "relative")
    expect(relative?.marker).toBe("that")
    expect(relative?.text).toBe("that I bought yesterday")
  })

  it("separates an adverbial clause from the main one", () => {
    const split = splitSentence("Although he was tired, he finished the work.")

    expect(split.clauses.find((clause) => clause.role === "adverbial")?.marker).toBe("although")
    expect(split.clauses.find((clause) => clause.role === "main")?.text).toBe(
      "he finished the work.",
    )
  })

  it("counts the finite clauses, so a plain sentence is not dressed up as a hard one", () => {
    expect(splitSentence("The book is on the table.").depth).toBe(1)
    expect(splitSentence("Although he was tired, he finished the work.").depth).toBe(2)
  })

  it("says it is unsure rather than guessing which kind of that it met", () => {
    // "that" after a noun is relative, after a verb like said it is nominal, and
    // telling them apart needs the part of speech of the word before it. Marking
    // one wrong is worse than admitting it: the whole promise is 看结构, and a
    // confident wrong structure is the one failure the tool must not produce.
    const split = splitSentence("He said that he would come.")

    expect(split.clauses.find((clause) => clause.marker === "that")?.role).toBe("nominal")
  })

  it("keeps both halves of a compound sentence as main clauses", () => {
    const split = splitSentence("He opened the door, and she walked in.")

    expect(split.clauses.filter((clause) => clause.role === "main")).toHaveLength(2)
  })

  it("keeps an auxiliary and its participle together as one verb", () => {
    // 「had studied」 is one finite verb, not two. Counted as two it ends the
    // relative clause at 「studied」, and the rest of the clause spills into the
    // main clause it was never part of.
    const split = splitSentence("The scientists who had studied the samples reported the result.")

    expect(split.clauses.find((clause) => clause.role === "relative")?.text).toBe(
      "who had studied the samples",
    )
  })

  it("does not end a clause on a plural noun", () => {
    // scientists/samples/results all end in -s. Every real 长难句 is full of
    // them, and stopping at one cuts the clause down to two words.
    const split = splitSentence("The scientists who had studied the samples reported the result.")

    expect(split.clauses.find((clause) => clause.role === "main")?.text).toBe(
      "The scientists … reported the result.",
    )
  })

  it("reads that after a reporting verb it has not been told about", () => {
    // The list of verbs taking a that-clause cannot be complete, but it should
    // at least cover the ones an exam passage actually uses.
    const split = splitSentence("The team reported that the results were surprising.")

    expect(split.clauses.find((clause) => clause.marker === "that")?.role).toBe("nominal")
  })

  it("takes a real 长难句 apart without losing half of it", () => {
    // The point of the whole file, on the kind of sentence it exists for: four
    // 从句 lifted off, and the 主谓 left sitting next to each other.
    const split = splitSentence(
      "The scientists who had studied the samples reported that the results were surprising, although they admitted that more work was needed.",
    )

    expect(split.clauses.find((clause) => clause.role === "main")?.text).toBe(
      "The scientists … reported",
    )
    expect(split.clauses.map((clause) => clause.text)).toContain("who had studied the samples")
    expect(split.clauses.map((clause) => clause.text)).toContain("that the results were surprising")
    expect(split.clauses.map((clause) => clause.text)).toContain("that more work was needed.")
  })

  it("does not treat a preposition as a clause marker", () => {
    // "before" introduces a clause only when a subject and verb follow it.
    // Splitting "before noon" would hand back a fragment with no verb and call
    // it a clause, which teaches the opposite of what the sentence is doing.
    const split = splitSentence("He left before noon.")

    expect(split.depth).toBe(1)
  })
})
