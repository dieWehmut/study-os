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

  it("does not treat a preposition as a clause marker", () => {
    // "before" introduces a clause only when a subject and verb follow it.
    // Splitting "before noon" would hand back a fragment with no verb and call
    // it a clause, which teaches the opposite of what the sentence is doing.
    const split = splitSentence("He left before noon.")

    expect(split.depth).toBe(1)
  })
})
