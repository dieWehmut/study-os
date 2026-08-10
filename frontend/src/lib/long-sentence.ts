/**
 * A long English sentence, cut at its clause boundaries.
 *
 * 语法题看结构不看词义：先找主谓，再定从句 is the right instruction and the hard
 * part is the first half of it. In a 长难句 the subject and its verb are rarely
 * adjacent -- everything hanging off the subject sits between them -- so 找主谓
 * fails not because a word is unknown but because the sentence is too wide to
 * hold at once.
 *
 * So the useful move is subtraction, not labelling: lift each subordinate
 * clause out, leave an ellipsis where it stood, and the main 主谓 land next to
 * each other on their own.
 *
 * This is a structural reading, not a parse. It knows markers and finite verbs
 * and nothing else -- no dictionary, no model, no network. A sentence it cannot
 * account for comes back whole, which is the same thing you started with and
 * therefore costs you nothing.
 */

export type ClauseRole = "main" | "relative" | "adverbial" | "nominal"

export interface Clause {
  role: ClauseRole
  text: string
  /** The word that introduced it: that, which, although… Null for a main clause. */
  marker: string | null
}

export interface SentenceSplit {
  clauses: Clause[]
  /** How many finite clauses the sentence carries, main one included. */
  depth: number
}

/** Words that can only introduce an adverbial clause. */
const ADVERBIAL = new Set([
  "although",
  "though",
  "because",
  "since",
  "unless",
  "whereas",
  "while",
  "if",
  "when",
  "before",
  "after",
  "until",
])

/** Words that can only introduce a relative clause. */
const RELATIVE = new Set(["which", "who", "whom", "whose", "where"])

/** Words that join two main clauses rather than subordinating one to the other. */
const COORDINATING = new Set(["and", "but", "or", "so", "yet"])

/**
 * Verbs after which a following "that" opens a nominal clause, not a relative one.
 *
 * "that" is the one marker whose role cannot be read off the word itself: after
 * a noun it is relative, after 说/认为 it is nominal, and telling them apart
 * properly needs the part of speech of the word before it. This list covers the
 * verbs that actually take a that-clause; anything else leaves "that" relative,
 * which is what it is after a noun.
 */
const REPORTING = new Set([
  "said",
  "says",
  "say",
  "think",
  "thinks",
  "thought",
  "know",
  "knows",
  "knew",
  "believe",
  "believes",
  "believed",
  "found",
  "find",
  "finds",
  "showed",
  "shows",
  "show",
  "suggest",
  "suggests",
  "suggested",
  "argue",
  "argues",
  "argued",
  "hope",
  "hopes",
  "hoped",
  "mean",
  "means",
  "meant",
  "report",
  "reports",
  "reported",
  "admit",
  "admits",
  "admitted",
  "claim",
  "claims",
  "claimed",
  "note",
  "notes",
  "noted",
  "explain",
  "explains",
  "explained",
  "conclude",
  "concludes",
  "concluded",
  "realize",
  "realizes",
  "realized",
  "assume",
  "assumes",
  "assumed",
  "decide",
  "decides",
  "decided",
  "agree",
  "agrees",
  "agreed",
  "reveal",
  "reveals",
  "revealed",
  "predict",
  "predicts",
  "predicted",
  "insist",
  "insists",
  "insisted",
])

/**
 * Verbs that are finite on their own, whatever the shape of the word.
 *
 * Every one of them is also an auxiliary, which is the second job this set
 * does: a verb sitting directly behind one of these is a participle sharing its
 * tense, not a second finite verb. 「had studied」 is one verb, and counting it
 * as two ends a relative clause halfway through itself.
 */
const FINITE = new Set([
  "is",
  "are",
  "was",
  "were",
  "am",
  "be",
  "been",
  "has",
  "have",
  "had",
  "does",
  "do",
  "did",
  "can",
  "could",
  "will",
  "would",
  "shall",
  "should",
  "may",
  "might",
  "must",
])

/**
 * Past tenses that no ending can identify.
 *
 * The -ed rule below misses exactly the verbs a 长难句 likes most. Without
 * 「bought」 in hand there is nothing to say where 「that I bought yesterday」
 * stops, and the relative clause swallows the main verb it was hiding.
 */
const IRREGULAR_PAST = new Set([
  "bought",
  "brought",
  "came",
  "became",
  "found",
  "gave",
  "went",
  "made",
  "met",
  "put",
  "said",
  "saw",
  "sent",
  "took",
  "thought",
  "told",
  "wrote",
  "knew",
  "held",
  "left",
  "lost",
  "won",
])

/**
 * Words the -s ending would misread as verbs.
 *
 * this/his/thus end in s and never inflect, and a false verb here is expensive:
 * it is what decides where a clause stops.
 */
const NOT_VERBS = new Set(["this", "his", "its", "hers", "theirs", "ours", "yours", "thus", "us"])

/**
 * Words after which an -s word is a noun rather than a verb.
 *
 * 「the samples」 「the results」 「The scientists」 -- a real 长难句 is built out
 * of these, and reading one as a verb is what cuts a clause down to two words.
 */
const DETERMINERS = new Set([
  "the",
  "a",
  "an",
  "this",
  "these",
  "those",
  "its",
  "his",
  "her",
  "their",
  "our",
  "your",
  "my",
  "some",
  "any",
  "no",
  "each",
  "every",
  "both",
  "all",
  "several",
  "many",
])

function word(token: string): string {
  return token.replace(/[^A-Za-z']/g, "").toLowerCase()
}

/**
 * Whether this word could be a finite verb.
 *
 * Deliberately loose, because of the only question it is asked: does this span
 * contain a verb at all? A clause has one, a prepositional phrase does not, and
 * a false positive there costs nothing.
 */
function couldBeVerb(token: string): boolean {
  const plain = word(token)
  if (plain === "") return false
  if (FINITE.has(plain) || IRREGULAR_PAST.has(plain)) return true
  if (NOT_VERBS.has(plain) || /(?:ous|ss)$/.test(plain)) return false
  return /(?:ed|es|s)$/.test(plain) && plain.length > 3
}

/**
 * Whether this word is confidently the verb of a clause.
 *
 * A stricter reading than `couldBeVerb`, because the question is different and
 * so is the cost of getting it wrong. Here the answer decides *where a clause
 * stops*, and a word wrongly called a verb ends the clause early -- the tail
 * then falls into the main clause, which is the one place it must not be.
 *
 * So an -s word is only a verb when no determiner sits in front of it, and a
 * word already covered by an auxiliary is not a second verb. Under-reporting is
 * safe: the clause simply runs on to the next marker, comma, or the end.
 */
function isClauseVerb(tokens: string[], index: number): boolean {
  const plain = word(tokens[index] as string)
  if (plain === "") return false
  if (FINITE.has(plain) || IRREGULAR_PAST.has(plain)) return true
  if (NOT_VERBS.has(plain) || /(?:ous|ss)$/.test(plain)) return false

  const previous = index > 0 ? word(tokens[index - 1] as string) : ""
  if (/ed$/.test(plain) && plain.length > 3) return true
  return /(?:es|s)$/.test(plain) && plain.length > 3 && !DETERMINERS.has(previous)
}

/**
 * Whether these words contain something that could be a finite verb.
 *
 * Without this, "before noon" reads as a clause and comes back as a fragment
 * with no verb in it -- teaching the opposite of what the sentence does.
 */
function hasFiniteVerb(tokens: string[]): boolean {
  return tokens.some(couldBeVerb)
}

interface Segment {
  role: ClauseRole
  marker: string | null
  tokens: string[]
}

/**
 * Where the clause a marker opened stops.
 *
 * A subordinate clause runs to the next marker, or to a comma, or to the end.
 * The comma matters most: in 「Although he was tired, he finished the work.」
 * the comma is the only thing saying where the concession ends and the sentence
 * proper begins.
 *
 * A relative clause usually has no comma to stop it, so it stops at its own
 * second verb instead. 「that I bought yesterday is on the table」 carries two:
 * 「bought」 belongs to the relative clause, and 「is」 is the main verb the
 * clause was hiding -- which is the whole reason for lifting it out.
 */
function endOfClause(tokens: string[], start: number, role: ClauseRole): number {
  let seenVerb = false
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index] as string
    if (index > start && markerRole(tokens, index) !== null) return index
    if (token.endsWith(",")) return index + 1
    if (index > start && isClauseVerb(tokens, index)) {
      // 「had studied」 is one verb, so the participle behind an auxiliary is
      // not a second one. Without this the clause ends inside its own verb.
      const previous = word(tokens[index - 1] as string)
      if (FINITE.has(previous)) continue
      if (role === "relative" && seenVerb) return index
      seenVerb = true
    }
  }
  return tokens.length
}

/**
 * What this token opens, if anything.
 *
 * Returns null for a word that only looks like a marker: a coordinator, or a
 * subordinator with no clause behind it.
 */
function markerRole(tokens: string[], index: number): ClauseRole | null {
  const plain = word(tokens[index] as string)
  if (plain === "") return null

  if (ADVERBIAL.has(plain) || RELATIVE.has(plain) || plain === "that") {
    const rest = tokens.slice(index + 1, endOfClauseGuess(tokens, index))
    if (!hasFiniteVerb(rest)) return null
  }

  if (ADVERBIAL.has(plain)) return "adverbial"
  if (RELATIVE.has(plain)) return "relative"
  if (plain === "that") {
    const previous = index > 0 ? word(tokens[index - 1] as string) : ""
    return REPORTING.has(previous) ? "nominal" : "relative"
  }
  return null
}

/** How far to look when deciding whether a marker has a verb behind it. */
function endOfClauseGuess(tokens: string[], start: number): number {
  for (let index = start + 1; index < tokens.length; index += 1) {
    if ((tokens[index] as string).endsWith(",")) return index + 1
  }
  return tokens.length
}

/** Whether this token joins two main clauses, rather than opening a subordinate one. */
function isCoordinator(tokens: string[], index: number): boolean {
  if (!COORDINATING.has(word(tokens[index] as string))) return false
  return hasFiniteVerb(tokens.slice(index + 1))
}

export function splitSentence(sentence: string): SentenceSplit {
  const text = sentence.trim()
  const tokens = text.split(/\s+/).filter((token) => token !== "")
  if (tokens.length === 0) {
    return { clauses: [{ role: "main", text, marker: null }], depth: 1 }
  }

  const segments: Segment[] = []
  let main: Segment = { role: "main", marker: null, tokens: [] }
  // Where the lifted clause stood, so the main clause reads as one sentence with
  // a hole in it rather than two halves that happen to sit next to each other.
  let lifted = false

  for (let index = 0; index < tokens.length; ) {
    const role = markerRole(tokens, index)

    if (role !== null) {
      const end = endOfClause(tokens, index, role)
      segments.push({
        role,
        marker: word(tokens[index] as string),
        tokens: tokens.slice(index, end),
      })
      lifted = true
      index = end
      continue
    }

    if (isCoordinator(tokens, index)) {
      segments.push(main)
      main = { role: "main", marker: null, tokens: [] }
      lifted = false
      index += 1
      continue
    }

    // The ellipsis stands for a hole, so it only means anything between two
    // pieces of the main clause. A clause lifted off the front of the sentence
    // left no hole behind it: 「Although he was tired,」 was never inside
    // 「he finished the work.」 Either way the lift has been accounted for.
    if (lifted) {
      if (main.tokens.length > 0) main.tokens.push("…")
      lifted = false
    }
    main.tokens.push(tokens[index] as string)
    index += 1
  }

  segments.push(main)

  const clauses = segments.flatMap((segment) => {
    const joined = segment.tokens.join(" ").replace(/\s+([,.])/g, "$1").trim()
    const cleaned = joined.replace(/,$/, "")
    if (cleaned === "") return []
    return [{ role: segment.role, text: cleaned, marker: segment.marker }]
  })

  if (clauses.length === 0) {
    return { clauses: [{ role: "main", text, marker: null }], depth: 1 }
  }

  return { clauses, depth: clauses.length }
}
