# 可视化信息图 · 第一期 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把一份 wiki markdown 用固定程序画成一张有几何结构的 SVG 信息图，先支持并列 / 流程 / 循环 / 发散四类，挂进 `WikiPanel` 成为第四个 tab。

**Architecture:** 沿用 `parseOutline` 的确定性树，往下接四层纯函数——`readCard` 读出语义块、`classify` 判结构、`layoutCard` 算坐标、`VisualCard` 只负责把坐标画成 SVG。宽高由内容算出，没有画布常量，也没有裁切路径。四类结构共用两个几何引擎：**网格**（并列 / 流程）与**环**（循环 / 发散），这正对应 `structures.md` §1.1 的派生律——闭合是把一条带子弯成环的那个开关。

**Tech Stack:** TypeScript · React 19 · vitest + jsdom · 纯 SVG（不用 canvas，不用 foreignObject——前者 jsdom 没有，后者光栅化时会被丢掉）

**设计出处：** `DESIGN-visual-cards.md`（§二 管线、§三 判定、§四 不锁尺寸、§七 测试、§八 分期第 1 条）

---

## 文件结构

| 文件 | 职责 | 依赖 |
|---|---|---|
| `frontend/src/lib/text-metrics.ts` | 前进宽表、`measure()`、`wrap()` | 无 |
| `frontend/src/lib/text-metrics.test.ts` | 上者的用例 | |
| `frontend/src/lib/outline.ts`（改） | 记住列表项是不是有序号 | 无 |
| `frontend/src/features/mindmap/MindMap.tsx`（改） | 改用 `text-metrics`，删掉自己那份 | `text-metrics` |
| `frontend/src/lib/card-blocks.ts` | `OutlineNode` 树 → `Block[]` | `outline` |
| `frontend/src/lib/card-blocks.test.ts` | 上者的用例 | |
| `frontend/src/lib/card-structure.ts` | `Block[]` → 四类之一 | `card-blocks` |
| `frontend/src/lib/card-structure.test.ts` | 上者的用例 | |
| `frontend/src/lib/card-layout.ts` | `Block[]` + 结构 → `Frame` | `text-metrics`, `card-blocks`, `card-structure` |
| `frontend/src/lib/card-layout.test.ts` | 上者的用例 | |
| `frontend/src/features/card/VisualCard.tsx` | `Frame` → SVG，零逻辑 | 以上全部 |
| `frontend/src/features/card/VisualCard.test.tsx` | 上者的用例 | |
| `frontend/src/features/knowledge/WikiPanel.tsx`（改） | 第四个 tab | `VisualCard` |

**四道验收闸**（每次 commit 前全跑，缺一不可——vitest 只转译不做类型检查，`pnpm build` 才做，`pnpm lint` 抓另外两者都不抓的未使用 import）：

```bash
cd frontend && pnpm test -- --run && pnpm lint && pnpm build
```

---

## Task 1: 前进宽表

`MindMap.tsx:89` 现在把非中日韩字符一律当 0.58em。`i` 和 `W` 差三倍，一行 `if (x) {` 会被高估近一倍——导图里只是节点略宽，到了卡片里就是一整列白。换成 `SKILL.md` 那张更细的表，并抽出来共用。

**Files:**
- Create: `frontend/src/lib/text-metrics.ts`
- Test: `frontend/src/lib/text-metrics.test.ts`

- [ ] **Step 1: 写下会失败的测试**

`frontend/src/lib/text-metrics.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import { measure, wrap } from "./text-metrics"

describe("text metrics", () => {
  it("gives a CJK character a full em", () => {
    expect(measure("字", 20)).toBe(20)
  })

  it("gives a narrow latin letter far less than a wide one", () => {
    // i 和 W 在同一个字号下差三倍。把它们算成同一个宽度，一行 `if (x) {`
    // 会被高估近一倍，卡片就会为一段根本不存在的文字留出一整列白。
    expect(measure("i", 20)).toBeLessThan(measure("W", 20))
    expect(measure("W", 20)).toBeLessThan(measure("字", 20))
  })

  it("counts fullwidth punctuation as a CJK character", () => {
    // 「，」和「,」在等宽表里是两个字符。中文正文里前者占满一格。
    expect(measure("，", 20)).toBe(measure("字", 20))
  })

  it("scales linearly with font size", () => {
    expect(measure("知识点", 24)).toBe(measure("知识点", 12) * 2)
  })

  it("wraps at the width it was given", () => {
    const lines = wrap("一二三四五六七八九十", 20, 100)

    expect(lines).toEqual(["一二三四五", "六七八九十"])
  })

  it("never returns a line wider than the budget", () => {
    const text = "光合作用分为光反应和暗反应两个阶段，前者在类囊体薄膜上进行"
    for (const line of wrap(text, 16, 180)) {
      expect(measure(line, 16)).toBeLessThanOrEqual(180)
    }
  })

  it("does not cut a latin word in half", () => {
    // 「pho / tosynthesis」不是断行，是把一个词毁掉。中文没有词边界，
    // 逐字断是对的；拉丁文有空格，那就是作者标好的断点。
    expect(wrap("alpha beta gamma", 20, 130)).toEqual(["alpha beta", "gamma"])
  })

  it("breaks a latin word that cannot fit on a line of its own", () => {
    // 宁可切开也不能溢出：一个比整行还长的词如果整段留着，
    // 它会捅穿卡片右边，而卡片没有裁切路径。
    for (const line of wrap("supercalifragilistic", 20, 60)) {
      expect(measure(line, 20)).toBeLessThanOrEqual(60)
    }
  })

  it("keeps every character it was given", () => {
    const text = "混合 text 与中文 mixed 的一行"
    expect(wrap(text, 16, 90).join("").replace(/ /g, "")).toBe(text.replace(/ /g, ""))
  })
})
```

- [ ] **Step 2: 跑一遍，确认它失败**

```bash
cd frontend && pnpm test -- --run src/lib/text-metrics.test.ts
```

Expected: FAIL —`Failed to resolve import "./text-metrics"`

- [ ] **Step 3: 写出实现**

`frontend/src/lib/text-metrics.ts`：

```ts
/**
 * How wide text draws, without a browser to ask.
 *
 * Canvas `measureText` is exact and unavailable: jsdom has no layout engine, so
 * `getBoundingClientRect()` answers 0 for everything. That is not a testing
 * inconvenience -- it decides the architecture. The one thing these cards must
 * get right is that nothing overflows, and a layout only the browser can
 * compute is a layout no test can check. So the width is arithmetic here, and
 * the same arithmetic runs in the test and on the screen.
 *
 * The table is from sample/distill/skill/knowledge-card/SKILL.md, which had to
 * do this by hand for the same reason.
 */

/** CJK, kana, and the fullwidth forms: all one em. */
const fullWidth = /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f\u3040-\u30ff]/
/** The wide latin letters and the arrows drawn at letter size. */
const wide = /[mwMW→⇌⇄↔]/
/** The ones that are barely more than a stroke. */
const narrow = /[iljItf1.,;:'`|!\[\]()]/

/** Fractions of the font size. Anything unlisted is ordinary latin or a digit. */
const emWide = 0.9
const emNarrow = 0.3
const emDefault = 0.55

/** One character's advance, in fractions of an em. */
function advance(character: string): number {
  if (fullWidth.test(character)) return 1
  if (wide.test(character)) return emWide
  if (narrow.test(character)) return emNarrow
  return emDefault
}

/** How wide this string draws at this font size, in px. */
export function measure(text: string, fontSize: number): number {
  let total = 0
  for (const character of text) total += advance(character)
  return total * fontSize
}

/**
 * Break a latin run that is wider than a whole line.
 *
 * Only as a last resort. A word cut in half is a word destroyed, but a word
 * left whole is a word hanging past the card's right edge -- and these cards
 * have no clipping path by design, so an overflow is not hidden, it is drawn
 * over whatever is next to it.
 */
function breakLongWord(word: string, fontSize: number, maxWidth: number): string[] {
  const pieces: string[] = []
  let current = ""
  for (const character of word) {
    if (current && measure(current + character, fontSize) > maxWidth) {
      pieces.push(current)
      current = ""
    }
    current += character
  }
  if (current) pieces.push(current)
  return pieces
}

/**
 * Split text into lines that each fit inside `maxWidth`.
 *
 * Two different jobs, because two different scripts. CJK has no word
 * boundaries and breaks anywhere, so it is measured character by character.
 * Latin does have boundaries and the author already marked them with spaces;
 * breaking mid-word there turns "photosynthesis" into two things that are not
 * words. So a latin run is kept whole and moved to the next line, unless it
 * cannot fit on a line at all.
 */
export function wrap(text: string, fontSize: number, maxWidth: number): string[] {
  // A latin run is any stretch of non-CJK non-space; everything else is taken
  // one character at a time.
  const tokens = text.match(/[^\s]+|\s+/g) ?? []
  const lines: string[] = []
  let line = ""

  const push = (piece: string) => {
    if (line && measure(line + piece, fontSize) > maxWidth) {
      lines.push(line)
      line = ""
    }
    // A space that lands at the start of a line is the break itself, not text.
    if (!line && piece.trim() === "") return
    line += piece
  }

  for (const token of tokens) {
    if (token.trim() === "") {
      push(token)
      continue
    }
    if (fullWidth.test(token)) {
      for (const character of token) push(character)
      continue
    }
    if (measure(token, fontSize) > maxWidth) {
      for (const piece of breakLongWord(token, fontSize, maxWidth)) {
        if (line) {
          lines.push(line)
          line = ""
        }
        line = piece
        if (measure(line, fontSize) >= maxWidth) {
          lines.push(line)
          line = ""
        }
      }
      continue
    }
    push(token)
  }

  if (line) lines.push(line)
  return lines.length > 0 ? lines : [""]
}
```

- [ ] **Step 4: 跑到绿**

```bash
cd frontend && pnpm test -- --run src/lib/text-metrics.test.ts
```

Expected: PASS，9 passed

- [ ] **Step 5: 四道闸**

```bash
cd frontend && pnpm test -- --run && pnpm lint && pnpm build
```

- [ ] **Step 6: commit**

```bash
git add frontend/src/lib/text-metrics.ts frontend/src/lib/text-metrics.test.ts
git commit -m "量得出一行字有多宽，才谈得上不裁切"
```

---

## Task 2: 导图改用同一张表

两份宽度表会各自漂移，而它们的分歧是看不见的——导图量出一个宽度，卡片量出另一个，同一段文字在两个 tab 里换行位置不一样，没人查得出为什么。

**Files:**
- Modify: `frontend/src/features/mindmap/MindMap.tsx:82-95`（删掉 `labelWidth`）

- [ ] **Step 1: 先确认导图现有用例是相对断言**

```bash
cd frontend && pnpm test -- --run src/features/mindmap/MindMap.test.tsx
```

Expected: PASS。用例断言的是「长节点比短节点宽」这类相对关系（`MindMap.test.tsx:297`），不是具体像素，所以换表不该改变任何一条。

- [ ] **Step 2: 删掉本地的 `labelWidth`，改调 `measure`**

`frontend/src/features/mindmap/MindMap.tsx` 顶部加入：

```ts
import { measure } from "@/lib/text-metrics"
```

删掉第 82–95 行整个 `labelWidth` 函数（连同它的注释），并新增一个只绑定字号的薄封装，放在原处：

```ts
/**
 * How wide this label draws, at the map's own font size.
 *
 * The table itself lives in `lib/text-metrics`, shared with the cards. Two
 * copies would drift, and the drift is invisible: the same sentence would wrap
 * at a different place in the 导图 tab than in the 信息图 tab, with nothing on
 * screen saying why.
 */
function labelWidth(label: string): number {
  return measure(label, FONT_SIZE)
}
```

- [ ] **Step 3: 跑导图用例**

```bash
cd frontend && pnpm test -- --run src/features/mindmap/MindMap.test.tsx
```

Expected: PASS，全部保持绿。若有一条转红，说明它断言了具体像素——把它改写成相对断言（`toBeGreaterThan` 另一个节点），不要改回旧表。

- [ ] **Step 4: 四道闸**

```bash
cd frontend && pnpm test -- --run && pnpm lint && pnpm build
```

- [ ] **Step 5: commit**

```bash
git add frontend/src/features/mindmap/MindMap.tsx
git commit -m "导图和卡片用同一把尺"
```

---

## Task 3: 大纲记住序号

「1. 加热 2. 冷却 3. 结晶」是教辅里最常见的流程写法。`parseOutline` 认出了它是列表项，但把 `1.` 这个记号扔了，于是流程和并列在树里长得一模一样。`structures.md` §1.1 的派生律说流程 = 并列 + 箭头 + **序号**，序号得留下来。

**Files:**
- Modify: `frontend/src/lib/outline.ts`（`OutlineNode` 接口、`emptyNode`、列表项分支）
- Test: `frontend/src/lib/outline.test.ts`

- [ ] **Step 1: 写下会失败的测试**

追加到 `frontend/src/lib/outline.test.ts` 最外层 `describe` 内部（`describe("long headings", ...)` 之后）：

```ts
  describe("ordered items", () => {
    it("remembers that a numbered item was numbered", () => {
      // 流程 = 并列 + 箭头 + 序号（structures.md §1.1）。记号被扔掉之后，
      // 「1. 加热 2. 冷却」和「- 加热 - 冷却」在树里完全一样，
      // 判定就只剩下猜。
      const root = parseOutline(["## 步骤", "1. 加热", "2. 冷却"].join("\n"))

      expect(root.children[0].children.map((child) => child.ordered)).toEqual([true, true])
    })

    it("says a bullet is not ordered", () => {
      const root = parseOutline(["## 条件", "- 光照", "- 温度"].join("\n"))

      expect(root.children[0].children.map((child) => child.ordered)).toEqual([false, false])
    })

    it("reads a parenthesised number as a number too", () => {
      // `1)` 和 `1.` 是同一件事，listPattern 本来就同时认。
      const root = parseOutline("1) 第一步")

      expect(root.children[0].ordered).toBe(true)
    })

    it("leaves a heading and a table row unordered", () => {
      // 两者都不是列表项，序号对它们没有意义——写成 true 会让
      // 一张普通表格被读成流程。
      const root = parseOutline(
        ["## 对比", "| 概念 | 定义 |", "| --- | --- |", "| 动量 | mv |"].join("\n"),
      )

      expect(root.children[0].ordered).toBe(false)
      expect(root.children[0].children[0].ordered).toBe(false)
    })
  })
```

- [ ] **Step 2: 跑一遍，确认它失败**

```bash
cd frontend && pnpm test -- --run src/lib/outline.test.ts
```

Expected: FAIL —`expected [ undefined, undefined ] to deeply equal [ true, true ]`（行为性失败，不是编译失败：多余的属性访问在 TS 里会报错，所以先加字段声明再让值为 false 更稳——见下一步）

- [ ] **Step 3: 写出实现**

`frontend/src/lib/outline.ts`，`OutlineNode` 接口内 `body` 之前插入：

```ts
  /**
   * Whether this node was written with a number rather than a bullet.
   *
   * The list marker is otherwise thrown away, and with it the one thing that
   * tells a 流程 apart from a 并列: `structures.md` §1.1 derives 流程 from 并列 by
   * adding arrows and numbering, and numbering is the half that survives into
   * plain markdown. False for headings and table rows, which are not list items
   * at all -- reading a numbered heading as a step would turn every 教辅 chapter
   * into a flowchart.
   */
  ordered: boolean
```

`emptyNode` 改为接受它：

```ts
function emptyNode(
  title: string,
  depth: number,
  kind: OutlineKind,
  line: number,
  ordered = false,
): OutlineNode {
  return { id: "", title, kind, depth, line, ordered, body: [], children: [] }
}
```

列表项分支里，把 `item[2]` 读出来传进去：

```ts
      const source = item[3].trim()
      const { title, note } = splitLongItem(source)
      // `1.` and `1)` are both numbering; `-`, `*`, `+` are not.
      const node = emptyNode(title, itemDepth, "item", index, /^\d/.test(item[2]))
```

- [ ] **Step 4: 跑到绿**

```bash
cd frontend && pnpm test -- --run src/lib/outline.test.ts
```

Expected: PASS

- [ ] **Step 5: 四道闸**

```bash
cd frontend && pnpm test -- --run && pnpm lint && pnpm build
```

- [ ] **Step 6: commit**

```bash
git add frontend/src/lib/outline.ts frontend/src/lib/outline.test.ts
git commit -m "「1. 加热」和「- 加热」不再是同一件事"
```

---

## Task 4: 读出语义块

`OutlineNode` 是给导图用的：一个标题加一串散文。卡片还要知道散文里哪些是**带名字的值**，因为几何要拿名字去对齐成列。

还要决定**画哪一层**。一篇 wiki 常写成「`## 条件` 下面挂三条」——根只有一个孩子，照根画就是一个方框装着三行字，正是这套东西要避免的东西。规则：**只要一个节点恰有一个孩子、而那个孩子自己还有孩子，就往下走一层**。

**Files:**
- Create: `frontend/src/lib/card-blocks.ts`
- Test: `frontend/src/lib/card-blocks.test.ts`

- [ ] **Step 1: 写下会失败的测试**

`frontend/src/lib/card-blocks.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import { readCard } from "./card-blocks"
import { parseOutline } from "./outline"

const cardOf = (markdown: string) => readCard(parseOutline(markdown))

describe("card blocks", () => {
  it("makes one block per section", () => {
    const { blocks } = cardOf(["# 光合作用", "## 光反应", "## 暗反应"].join("\n"))

    expect(blocks.map((block) => block.title)).toEqual(["光反应", "暗反应"])
  })

  it("descends through a lone section to the things inside it", () => {
    // 一篇 wiki 常写成「## 条件」底下挂三条。照根画出来是一个方框装着三行字 ——
    // 那正是 0807:41 说的方框长条。真正在并列的是那三条，就画那三条。
    const { blocks } = cardOf(["## 条件", "- 光照", "- 温度", "- 水分"].join("\n"))

    expect(blocks.map((block) => block.title)).toEqual(["光照", "温度", "水分"])
  })

  it("stops descending at a section that has nothing inside it", () => {
    // 往下走一层的前提是下面还有东西。走进一个空节点，卡片就什么都没有了。
    const { blocks } = cardOf(["## 光反应", "发生在类囊体薄膜上。"].join("\n"))

    expect(blocks.map((block) => block.title)).toEqual(["光反应"])
    expect(blocks[0].lines).toEqual(["发生在类囊体薄膜上。"])
    expect(blocks[0].fields).toEqual([])
  })

  it("hands back the prose written above the blocks as the centre", () => {
    // 并列 vs 发散 的分界就是它有没有内容（structures.md §1.3），
    // 所以读块的时候必须一并把它读出来，不能让下游再去树里找一次。
    const { centre, blocks } = cardOf(
      ["光合作用是绿色植物制造有机物的过程。", "- 光反应", "- 暗反应"].join("\n"),
    )

    expect(centre).toEqual(["光合作用是绿色植物制造有机物的过程。"])
    expect(blocks).toHaveLength(2)
  })

  it("takes the centre from wherever it stopped descending", () => {
    const { centre, blocks } = cardOf(["## 术语", "这是一段总述。", "### 甲", "### 乙"].join("\n"))

    expect(centre).toEqual(["这是一段总述。"])
    expect(blocks.map((block) => block.title)).toEqual(["甲", "乙"])
  })

  it("reads a table row's cells back into named fields", () => {
    // parseOutline 把一行表格编码成了「表头：值」的散文。几何要按名字归列，
    // 所以这里把它再拆回来 —— 名字本来就写在每一行上。
    const { blocks } = cardOf(
      ["| 概念 | 定义 | 例子 |", "| --- | --- | --- |", "| 动量 | mv | 小球碰撞 |"].join("\n"),
    )

    expect(blocks[0].title).toBe("动量")
    expect(blocks[0].fields).toEqual([
      { name: "定义", value: "mv" },
      { name: "例子", value: "小球碰撞" },
    ])
    expect(blocks[0].lines).toEqual([])
  })

  it("leaves a sentence with a colon in it as a line, not a field", () => {
    // 字段名是名字，不是半句话。一句「它得出的结论是这样的：后面还有很长一段」
    // 被当成字段，几何会拿这半句话去当列头。
    const { blocks } = cardOf(["## 结论", "它得出的结论是这样的：后面还有很长的一段说明"].join("\n"))

    expect(blocks[0].fields).toEqual([])
    expect(blocks[0].lines).toEqual(["它得出的结论是这样的：后面还有很长的一段说明"])
  })

  it("does not read a url as a field", () => {
    const { blocks } = cardOf(["## 出处", "https://example.com/a"].join("\n"))

    expect(blocks[0].fields).toEqual([])
  })

  it("nests a section's sub-sections as child blocks", () => {
    const { blocks } = cardOf(["## 甲", "## 乙", "### 乙一"].join("\n"))

    expect(blocks.map((block) => block.title)).toEqual(["甲", "乙"])
    expect(blocks[1].children.map((child) => child.title)).toEqual(["乙一"])
  })

  it("carries the ordered flag through", () => {
    const { blocks } = cardOf(["## 步骤", "1. 加热", "2. 冷却"].join("\n"))

    expect(blocks.map((block) => block.ordered)).toEqual([true, true])
  })

  it("gives every block the id the outline gave its node", () => {
    // 卡片是每次重画的，但 React key 和测试选择器需要一个跨渲染稳定的名字，
    // 而 outline 的 id 已经是从位置推出来的，稳定就是它的定义。
    const source = ["## 甲", "## 乙"].join("\n")

    expect(new Set(cardOf(source).blocks.map((block) => block.id)).size).toBe(2)
    expect(cardOf(source).blocks[0].id).toBe(cardOf(source).blocks[0].id)
  })

  it("returns nothing for an empty document", () => {
    expect(readCard(parseOutline(""))).toEqual({ centre: [], blocks: [] })
  })
})
```

- [ ] **Step 2: 跑一遍，确认它失败**

```bash
cd frontend && pnpm test -- --run src/lib/card-blocks.test.ts
```

Expected: FAIL —`Failed to resolve import "./card-blocks"`

- [ ] **Step 3: 写出实现**

`frontend/src/lib/card-blocks.ts`：

```ts
/**
 * Outline tree -> the units a card draws.
 *
 * A `OutlineNode` is what the map needs: a title and a run of prose under it.
 * A card needs two things more.
 *
 * One is which prose lines are *named values*, because geometry aligns them
 * into columns by name. `parseOutline` already found them; it just encoded them
 * as prose (a table row arrives as `["定义：mv", "例子：小球碰撞"]`, i.e. `表头：值`).
 *
 * The other is *which level to draw*. The map always starts at the root because
 * the root is where the reader starts scrolling. A card has no scroll -- it is
 * one picture -- so starting at a root with a single child would draw one box
 * with three lines in it, which is exactly the 方框长条 of 0807:41.
 */

import type { OutlineNode } from "./outline"

export interface Field {
  name: string
  value: string
}

export interface Block {
  /** The outline's id, which is derived from position and so is stable. */
  id: string
  title: string
  /** Prose that is not a named value. */
  lines: string[]
  /**
   * Named values, in document order.
   *
   * Pairs, not a positional grid. `parseOutline` drops empty cells
   * (`outline.ts` -- a half-filled table is normal and "例子：" with nothing
   * after it reads as a missing answer), so the third row's second field need
   * not share a column with the second row's second field. Geometry groups by
   * `name`, which is written on every row, rather than by index.
   */
  fields: Field[]
  ordered: boolean
  children: Block[]
}

export interface CardSource {
  /**
   * The prose written above the blocks.
   *
   * Read here rather than by the classifier, because only this module knows
   * which node it stopped at -- and 并列 vs 发散 turns on whether *that* node has
   * anything to say (`structures.md` §1.3). Two walks of the same chain would
   * drift, and the drift would be silent: the card would draw a hub with
   * nothing in it, or no hub where there was one.
   */
  centre: string[]
  blocks: Block[]
}

/**
 * How long a string can be and still read as a field name.
 *
 * A column header is short by nature -- 定义, 例子, 适用条件. Past this it is a
 * sentence that happens to contain a colon, and taking it as a name would put
 * half a sentence in a column head. Deliberately tighter than the outline's own
 * 24-character label budget: a label is something you read, a field name is
 * something you read *repeatedly*, once per row.
 */
const nameBudget = 12

/** A colon inside running prose, told apart from a field name before one. */
const sentenceEnd = /[。！？；;]/

/**
 * Split `定义：mv` into a name and a value, or answer null.
 *
 * Unlike `outline.splitLongItem` this runs regardless of length -- 「定义：mv」 is
 * five characters and is still a named value. What it shares is the reason to
 * refuse: no colon, an empty half, a `//` after the colon (that is a URL
 * scheme, not a field name), or a name long enough to be a sentence.
 */
function readField(line: string): Field | null {
  const mark = line.search(/[：:]/)
  if (mark <= 0) return null

  const name = line.slice(0, mark).trim()
  const value = line.slice(mark + 1).trim()
  if (!name || !value || value.startsWith("//")) return null
  if ([...name].length > nameBudget || sentenceEnd.test(name)) return null

  return { name, value }
}

function toBlock(node: OutlineNode): Block {
  const lines: string[] = []
  const fields: Field[] = []
  for (const line of node.body) {
    const field = readField(line)
    if (field) fields.push(field)
    else lines.push(line)
  }
  return {
    id: node.id,
    title: node.title,
    lines,
    fields,
    ordered: node.ordered,
    children: node.children.map(toBlock),
  }
}

/**
 * Walk down while there is only one way to go.
 *
 * A lone child is not a structure -- there is nothing for it to be beside. The
 * requirement that it have children of its own is what stops the walk from
 * stepping into a leaf and leaving the card with nothing at all to draw.
 */
function deepestFork(node: OutlineNode): OutlineNode {
  let current = node
  while (current.children.length === 1 && current.children[0].children.length > 0) {
    current = current.children[0]
  }
  return current
}

export function readCard(root: OutlineNode): CardSource {
  const fork = deepestFork(root)
  return { centre: [...fork.body], blocks: fork.children.map(toBlock) }
}
```

- [ ] **Step 4: 跑到绿**

```bash
cd frontend && pnpm test -- --run src/lib/card-blocks.test.ts
```

Expected: PASS，12 passed

- [ ] **Step 5: 四道闸 + commit**

```bash
cd frontend && pnpm test -- --run && pnpm lint && pnpm build
cd .. && git add frontend/src/lib/card-blocks.ts frontend/src/lib/card-blocks.test.ts
git commit -m "画在并列的那一层，不是画在根上"
```

---

## Task 5: 判四类结构

**Files:**
- Create: `frontend/src/lib/card-structure.ts`
- Test: `frontend/src/lib/card-structure.test.ts`

- [ ] **Step 1: 写下会失败的测试**

`frontend/src/lib/card-structure.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import { readCard } from "./card-blocks"
import { classify } from "./card-structure"
import { parseOutline } from "./outline"

const readingOf = (markdown: string) => {
  const { centre, blocks } = readCard(parseOutline(markdown))
  return classify(blocks, centre)
}

describe("structure classification", () => {
  it("reads a plain list as 并列", () => {
    expect(readingOf(["## 条件", "- 光照", "- 温度", "- 水分"].join("\n"))).toBe("并列")
  })

  it("reads a numbered list as 流程", () => {
    // structures.md §1.1: 流程 = 并列 + 箭头 + 序号。
    expect(readingOf(["## 步骤", "1. 加热", "2. 冷却", "3. 结晶"].join("\n"))).toBe("流程")
  })

  it("reads arrows in the titles as 流程 even without numbering", () => {
    expect(readingOf(["## 通路", "- 光能 → ATP", "- ATP → 糖"].join("\n"))).toBe("流程")
  })

  it("reads a numbered list that returns to its first step as 循环", () => {
    // 循环 = 流程 + 闭合。闭合的证据是末项指回首项。
    expect(
      readingOf(["## 水循环", "1. 蒸发", "2. 凝结", "3. 降水", "4. 径流后重新蒸发"].join("\n")),
    ).toBe("循环")
  })

  it("reads an explicit return marker as 闭合 too", () => {
    expect(
      readingOf(["## 细胞周期", "1. 间期", "2. 分裂期", "3. 回到间期"].join("\n")),
    ).toBe("循环")
  })

  it("reads a list under its own prose as 发散", () => {
    // 并列 vs 发散 的分界是中心有没有内容（structures.md §1.3）。
    // 这里的散文写在根上，它就是中心主题。
    expect(
      readingOf(["光合作用是绿色植物制造有机物的过程。", "- 光反应", "- 暗反应"].join("\n")),
    ).toBe("发散")
  })

  it("prefers 流程 over 发散 when the steps are numbered", () => {
    // 有中心又有序号时，读者要的是顺序。中心可以画在旁边，
    // 顺序画错了整张图就是错的。
    expect(readingOf(["这是一段总述。", "1. 第一步", "2. 第二步"].join("\n"))).toBe("流程")
  })

  it("falls back to 并列 for a single block", () => {
    // 一个块没有结构可言。并列是根结构，落回它永远是合法输出。
    expect(readingOf("## 只有一节")).toBe("并列")
  })

  it("falls back to 并列 for nothing at all", () => {
    expect(classify([], [])).toBe("并列")
  })
})
```

- [ ] **Step 2: 跑一遍，确认它失败**

```bash
cd frontend && pnpm test -- --run src/lib/card-structure.test.ts
```

Expected: FAIL —`Failed to resolve import "./card-structure"`

- [ ] **Step 3: 写出实现**

`frontend/src/lib/card-structure.ts`：

```ts
/**
 * Which of the shapes this material is.
 *
 * Four of the ten, and they are not four pieces of code. `structures.md` §1.1
 * gives a derivation law -- 并列 is the root; 流程 is 并列 plus arrows and
 * numbering; 循环 is 流程 plus closure; 发散 is 并列 plus a centre. So the
 * classifier answers three yes/no questions, and the layout has two geometries
 * rather than four.
 *
 * Every unanswerable case falls back to 并列. The skill itself writes that any
 * 并列 skeleton plus arrows is a legal 流程 skeleton, which makes 并列 the safe
 * answer by construction -- and that is what guarantees this always draws
 * something. For a tool whose whole purpose is lowering the cost of starting to
 * read, "sometimes there is no picture" is far worse than "sometimes the
 * picture is an ordinary one."
 */

import type { Block } from "./card-blocks"

export type Structure = "并列" | "流程" | "循环" | "发散"

/** The arrows people actually type in study material. */
const arrow = /→|⇒|⟶|->|=>|➜/
/**
 * A last step that says it goes back.
 *
 * 循环 vs 流程 turns entirely on whether the end meets the beginning
 * (`structures.md` §1.3), and in plain markdown the author says so in words.
 */
const returnMark = /回到|重新|下一轮|周而复始|循环|复始/

function textOf(block: Block): string {
  return [block.title, ...block.lines, ...block.fields.map((field) => field.value)].join(" ")
}

/** Numbered, or drawn with arrows: either is the mark of a sequence. */
function isSequence(blocks: Block[]): boolean {
  const numbered = blocks.filter((block) => block.ordered).length
  if (numbered >= 2) return true
  return blocks.filter((block) => arrow.test(textOf(block))).length >= 2
}

/**
 * Whether the last step meets the first.
 *
 * Two readings, because authors write it both ways: naming the first step again
 * at the end, or just saying 「回到」. The name test needs the first title to be
 * a real word -- a one-character title would match almost any sentence.
 */
function isClosed(blocks: Block[]): boolean {
  const last = blocks[blocks.length - 1]
  if (returnMark.test(textOf(last))) return true
  const first = blocks[0].title
  return [...first].length >= 2 && textOf(last).includes(first)
}

/**
 * @param blocks the card's top-level units
 * @param centre the prose written above them, if any -- the root's own body
 */
export function classify(blocks: Block[], centre: string[]): Structure {
  // One box is not a structure, and neither is none.
  if (blocks.length < 2) return "并列"

  if (isSequence(blocks)) return isClosed(blocks) ? "循环" : "流程"

  // 并列 vs 发散: does the centre have anything in it? A list written under a
  // paragraph has a subject; a list written under a bare heading does not.
  return centre.length > 0 ? "发散" : "并列"
}
```

- [ ] **Step 4: 跑到绿**

```bash
cd frontend && pnpm test -- --run src/lib/card-structure.test.ts
```

Expected: PASS，9 passed

- [ ] **Step 5: 四道闸 + commit**

```bash
cd frontend && pnpm test -- --run && pnpm lint && pnpm build
cd .. && git add frontend/src/lib/card-structure.ts frontend/src/lib/card-structure.test.ts
git commit -m "四类结构判得出来，判不出来就落回并列"
```

---

## Task 6: 算坐标

这一步是整个设计的赌注：**画布高度由内容算出**，所以没有「装不下就压缩」这条路，也就没有方框长条。

两个几何引擎：
- **网格**（并列 / 流程）：最多三列，行高取该行最高的块。流程在相邻块之间画箭头。
- **环**（循环 / 发散）：块摆在一个圆上，半径由周长约束推出——`n` 个宽 `w` 的盒子要不重叠地摆一圈，圆周至少得有 `n × (w + gap)`。循环在相邻块之间画箭头并闭合；发散在圆心多画一个中心块，从中心连出去、不画箭头。

**Files:**
- Create: `frontend/src/lib/card-layout.ts`
- Test: `frontend/src/lib/card-layout.test.ts`

- [ ] **Step 1: 写下会失败的测试**

`frontend/src/lib/card-layout.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import { readCard } from "./card-blocks"
import { layoutCard, type Frame } from "./card-layout"
import { classify } from "./card-structure"
import { parseOutline } from "./outline"

const frameOf = (markdown: string): Frame => {
  const { centre, blocks } = readCard(parseOutline(markdown))
  return layoutCard(blocks, classify(blocks, centre), centre)
}

/** Nothing drawn may sit outside the frame -- there is no clipping path. */
const inside = (frame: Frame) =>
  frame.shapes.every(
    (shape) =>
      shape.x >= 0 && shape.y >= 0 && shape.x + shape.w <= frame.w && shape.y + shape.h <= frame.h,
  )

const overlaps = (a: Frame["shapes"][number], b: Frame["shapes"][number]) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const list = ["## 条件", "- 光照", "- 温度", "- 水分"].join("\n")
const steps = ["## 步骤", "1. 加热", "2. 冷却", "3. 结晶"].join("\n")
const cycle = ["## 水循环", "1. 蒸发", "2. 凝结", "3. 降水", "4. 回到蒸发"].join("\n")
const radial = ["光合作用是绿色植物制造有机物的过程。", "- 光反应", "- 暗反应", "- 产物"].join("\n")

describe("card layout", () => {
  it("draws one shape per block", () => {
    expect(frameOf(list).shapes).toHaveLength(3)
  })

  it("keeps every shape inside the frame", () => {
    for (const source of [list, steps, cycle, radial]) {
      expect(inside(frameOf(source))).toBe(true)
    }
  })

  it("never overlaps two shapes", () => {
    for (const source of [list, steps, cycle, radial]) {
      const { shapes } = frameOf(source)
      for (let a = 0; a < shapes.length; a += 1) {
        for (let b = a + 1; b < shapes.length; b += 1) {
          expect(overlaps(shapes[a], shapes[b])).toBe(false)
        }
      }
    }
  })

  it("grows taller for more content instead of clipping it", () => {
    // 这条是整份设计的赌注。skill 的画布是常量，超出静默裁切；
    // 这里画布是算出来的，所以「不锁尺寸」不是一句要求自觉的话。
    const few = frameOf(["## 甲", "- 一", "- 二"].join("\n"))
    const many = frameOf(
      ["## 甲", ...Array.from({ length: 12 }, (_, index) => `- 第${index}项`)].join("\n"),
    )

    expect(many.h).toBeGreaterThan(few.h)
    expect(inside(many)).toBe(true)
  })

  it("grows taller for a long line rather than letting it run off the edge", () => {
    const short = frameOf(["## 甲", "- 一", "- 二"].join("\n"))
    const long = frameOf(
      ["## 甲", "- 一：这一条写得非常长，长到必须折成好几行才装得下，而卡片只能长高", "- 二"].join("\n"),
    )

    expect(long.h).toBeGreaterThan(short.h)
    expect(inside(long)).toBe(true)
  })

  it("keeps every text inside the frame too", () => {
    const frame = frameOf(radial)

    for (const text of frame.texts) {
      expect(text.x).toBeGreaterThanOrEqual(0)
      expect(text.y).toBeGreaterThanOrEqual(0)
      expect(text.x).toBeLessThanOrEqual(frame.w)
      expect(text.y).toBeLessThanOrEqual(frame.h)
    }
  })

  it("draws no arrows for 并列", () => {
    expect(frameOf(list).links.filter((link) => link.arrow)).toHaveLength(0)
  })

  it("draws an arrow between consecutive steps of a 流程", () => {
    expect(frameOf(steps).links.filter((link) => link.arrow)).toHaveLength(2)
  })

  it("closes the ring of a 循环", () => {
    // 四个块的环有四条边，不是三条 -- 末项回到首项那条就是「闭合」本身。
    expect(frameOf(cycle).links.filter((link) => link.arrow)).toHaveLength(4)
  })

  it("gives 发散 a centre that every branch is linked to", () => {
    const frame = frameOf(radial)

    // 三个分支 + 一个中心。
    expect(frame.shapes).toHaveLength(4)
    expect(frame.links).toHaveLength(3)
    expect(frame.links.every((link) => !link.arrow)).toBe(true)
  })

  it("is at least as wide as two columns need", () => {
    // 比这更窄的卡片放不下两列，所有骨架都会退化成一列 —— 那就又是方框长条了。
    expect(frameOf(list).w).toBeGreaterThanOrEqual(640)
  })

  it("gives the same markdown the same frame every time", () => {
    // 它能用来预习的前提：结构每次都一样，才值得先看一遍。
    expect(frameOf(steps)).toEqual(frameOf(steps))
  })

  it("draws nothing for nothing", () => {
    const frame = layoutCard([], "并列", [])

    expect(frame.shapes).toEqual([])
    expect(frame.h).toBe(0)
  })
})
```

- [ ] **Step 2: 跑一遍，确认它失败**

```bash
cd frontend && pnpm test -- --run src/lib/card-layout.test.ts
```

Expected: FAIL —`Failed to resolve import "./card-layout"`

- [ ] **Step 3: 写出实现**

`frontend/src/lib/card-layout.ts`：

```ts
/**
 * Blocks -> coordinates.
 *
 * The canvas is computed, not declared. `SKILL.md` fixes it at 1133 × 1511 and
 * silently truncates what does not fit, which is why its output slides into
 * 方框长条 the moment there is a little too much to say (0807:41). There is no
 * constant here and no clipping path: `h` is the sum of what the content
 * needed, so "do not lock the dimensions" is a line of arithmetic rather than a
 * request for a model to behave.
 *
 * Two geometries cover four structures, which is the derivation law of
 * `structures.md` §1.1 showing up in the code: closure is the switch that bends
 * a strip into a ring, and a centre is the switch that puts something in the
 * middle of one.
 */

import type { Block } from "./card-blocks"
import type { Structure } from "./card-structure"
import { measure, wrap } from "./text-metrics"

export interface Shape {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** The centre of a 发散 is drawn differently from the branches around it. */
  role: "block" | "centre"
}

export interface CardText {
  id: string
  x: number
  y: number
  text: string
  size: number
  bold: boolean
}

export interface Link {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  arrow: boolean
}

export interface Frame {
  w: number
  h: number
  shapes: Shape[]
  texts: CardText[]
  links: Link[]
}

/** Below this a card cannot hold two columns, and every skeleton degrades to
 *  one -- which is the 方框长条 this whole module exists to avoid. No maximum. */
const minWidth = 640
const pad = 32
const gap = 24
const boxPad = 14
const titleSize = 17
const bodySize = 14
const lineGap = 6
/** Three at most: a nine-item list should read as 3×3, not as a nine-wide strip
 *  whose boxes are too narrow to hold a sentence. */
const maxColumns = 3

function lineHeight(size: number): number {
  return size + lineGap
}

/** Everything this block says, as the lines it will actually draw. */
function blockLines(block: Block, innerWidth: number): string[] {
  return [
    ...block.lines.flatMap((line) => wrap(line, bodySize, innerWidth)),
    ...block.fields.flatMap((field) => wrap(`${field.name}：${field.value}`, bodySize, innerWidth)),
    ...block.children.map((child) => `· ${child.title}`).flatMap((line) => wrap(line, bodySize, innerWidth)),
  ]
}

function blockHeight(block: Block, boxWidth: number): number {
  const innerWidth = boxWidth - boxPad * 2
  const titleLines = wrap(block.title, titleSize, innerWidth).length
  const bodyLines = blockLines(block, innerWidth).length
  return boxPad * 2 + titleLines * lineHeight(titleSize) + bodyLines * lineHeight(bodySize)
}

/** How wide this block would like to be, before any grid is imposed on it. */
function naturalWidth(block: Block): number {
  const candidates = [
    measure(block.title, titleSize),
    ...block.lines.map((line) => measure(line, bodySize)),
    ...block.fields.map((field) => measure(`${field.name}：${field.value}`, bodySize)),
    ...block.children.map((child) => measure(`· ${child.title}`, bodySize)),
  ]
  return Math.max(...candidates, 0) + boxPad * 2
}

/** Draw one block's title and body into a box already placed at (x, y). */
function paint(block: Block, shape: Shape, texts: CardText[]): void {
  const innerWidth = shape.w - boxPad * 2
  let cursor = shape.y + boxPad + titleSize
  let index = 0
  for (const line of wrap(block.title, titleSize, innerWidth)) {
    texts.push({
      id: `${block.id}-t${index}`,
      x: shape.x + boxPad,
      y: cursor,
      text: line,
      size: titleSize,
      bold: true,
    })
    cursor += lineHeight(titleSize)
    index += 1
  }
  index = 0
  for (const line of blockLines(block, innerWidth)) {
    texts.push({
      id: `${block.id}-b${index}`,
      x: shape.x + boxPad,
      y: cursor,
      text: line,
      size: bodySize,
      bold: false,
    })
    cursor += lineHeight(bodySize)
    index += 1
  }
}

/** 并列 and 流程: a grid, arrows only for the latter. */
function layoutGrid(blocks: Block[], arrows: boolean): Frame {
  const columns = Math.min(blocks.length, maxColumns)
  const widest = Math.max(...blocks.map(naturalWidth))
  const needed = pad * 2 + columns * widest + gap * (columns - 1)
  const w = Math.max(minWidth, needed)
  // Slack is given back to the boxes rather than left as margin: a card with
  // 200px columns floating in 640px of white reads as a mistake.
  const boxWidth = Math.floor((w - pad * 2 - gap * (columns - 1)) / columns)

  const shapes: Shape[] = []
  const texts: CardText[] = []
  const links: Link[] = []
  let y = pad

  for (let start = 0; start < blocks.length; start += columns) {
    const row = blocks.slice(start, start + columns)
    const rowHeight = Math.max(...row.map((block) => blockHeight(block, boxWidth)))
    row.forEach((block, column) => {
      const shape: Shape = {
        id: block.id,
        x: pad + column * (boxWidth + gap),
        y,
        w: boxWidth,
        h: rowHeight,
        role: "block",
      }
      shapes.push(shape)
      paint(block, shape, texts)
    })
    y += rowHeight + gap
  }

  if (arrows) {
    for (let index = 0; index + 1 < shapes.length; index += 1) {
      const from = shapes[index]
      const to = shapes[index + 1]
      const sameRow = from.y === to.y
      links.push({
        id: `${from.id}->${to.id}`,
        // Within a row the arrow runs along the gap; across a row break it
        // drops from the bottom of the last box to the top of the next.
        x1: sameRow ? from.x + from.w : from.x + from.w / 2,
        y1: sameRow ? from.y + from.h / 2 : from.y + from.h,
        x2: sameRow ? to.x : to.x + to.w / 2,
        y2: sameRow ? to.y + to.h / 2 : to.y,
        arrow: true,
      })
    }
  }

  return { w, h: y - gap + pad, shapes, texts, links }
}

/**
 * 循环 and 发散: boxes on a circle.
 *
 * The radius is forced by geometry, not chosen. Two axis-aligned boxes overlap
 * only if their centres are closer than `w` horizontally *and* closer than `h`
 * vertically, so centres one diagonal apart can never overlap whatever the
 * angle -- `hypot(w, h)` is the one spacing that holds for every rotation.
 * Adjacent centres on a ring of `n` sit a chord `2r·sin(π/n)` apart, so
 * `r ≥ (hypot(w, h) + gap) / (2·sin(π/n))`.
 *
 * Sizing by `max(w, h)` instead would be wrong by exactly the amount that
 * bites: three 260×100 boxes land 235px apart when they need 260, and the
 * "never overlaps" assertion fails at n=3 only. This is the same "compute it,
 * do not cap it" move as the grid's height -- a twelve-step cycle draws a big
 * ring rather than twelve boxes on top of each other.
 */
function layoutRing(blocks: Block[], centre: Block | null, arrows: boolean): Frame {
  const boxWidth = Math.min(Math.max(...blocks.map(naturalWidth)), 260)
  const heights = blocks.map((block) => blockHeight(block, boxWidth))
  const boxHeight = Math.max(...heights)
  const centreWidth = centre ? Math.min(naturalWidth(centre), 320) : 0
  const centreHeight = centre ? blockHeight(centre, centreWidth) : 0

  // max(n, 2) because sin(π/1) is 0 and would divide by zero. `classify` never
  // returns a ring for one block, but a layout function that explodes on an
  // input its caller happens not to send is a trap left for the next phase.
  const spread = Math.max(blocks.length, 2)
  const bySpacing = (Math.hypot(boxWidth, boxHeight) + gap) / (2 * Math.sin(Math.PI / spread))
  // Also has to clear the centre box, plus half of a branch box, plus the gap.
  const byCentre = Math.hypot(centreWidth, centreHeight) / 2 + gap + Math.hypot(boxWidth, boxHeight) / 2
  const radius = Math.max(bySpacing, byCentre)

  const w = Math.max(minWidth, pad * 2 + radius * 2 + boxWidth)
  const h = pad * 2 + radius * 2 + boxHeight
  const cx = w / 2
  const cy = h / 2

  const shapes: Shape[] = []
  const texts: CardText[] = []
  const links: Link[] = []

  if (centre) {
    const shape: Shape = {
      id: centre.id,
      x: cx - centreWidth / 2,
      y: cy - centreHeight / 2,
      w: centreWidth,
      h: centreHeight,
      role: "centre",
    }
    shapes.push(shape)
    paint(centre, shape, texts)
  }

  const ring: Shape[] = []
  blocks.forEach((block, index) => {
    // Starting at the top and going clockwise, because that is where a reader
    // starts on a clock and on every cycle diagram ever drawn.
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / blocks.length
    const shape: Shape = {
      id: block.id,
      x: cx + Math.cos(angle) * radius - boxWidth / 2,
      y: cy + Math.sin(angle) * radius - boxHeight / 2,
      w: boxWidth,
      h: boxHeight,
      role: "block",
    }
    ring.push(shape)
    shapes.push(shape)
    paint(block, shape, texts)
  })

  if (centre) {
    const hub = shapes[0]
    for (const shape of ring) {
      links.push({
        id: `${hub.id}-${shape.id}`,
        x1: cx,
        y1: cy,
        x2: shape.x + shape.w / 2,
        y2: shape.y + shape.h / 2,
        arrow: false,
      })
    }
  }

  if (arrows) {
    ring.forEach((from, index) => {
      const to = ring[(index + 1) % ring.length]
      links.push({
        id: `${from.id}->${to.id}`,
        x1: from.x + from.w / 2,
        y1: from.y + from.h / 2,
        x2: to.x + to.w / 2,
        y2: to.y + to.h / 2,
        arrow: true,
      })
    })
  }

  return { w, h, shapes, texts, links }
}

/**
 * @param blocks the card's top-level units
 * @param structure what `classify` read them as
 * @param centre the prose written above them -- becomes 发散's hub
 */
export function layoutCard(blocks: Block[], structure: Structure, centre: string[]): Frame {
  if (blocks.length === 0) return { w: minWidth, h: 0, shapes: [], texts: [], links: [] }

  if (structure === "循环") return layoutRing(blocks, null, true)
  if (structure === "发散") {
    const hub: Block = {
      id: "centre",
      title: centre[0] ?? "",
      lines: centre.slice(1),
      fields: [],
      ordered: false,
      children: [],
    }
    return layoutRing(blocks, hub, false)
  }
  return layoutGrid(blocks, structure === "流程")
}
```

- [ ] **Step 4: 跑到绿**

```bash
cd frontend && pnpm test -- --run src/lib/card-layout.test.ts
```

Expected: PASS，14 passed。若「never overlaps」只在环形那几个用例转红，先看 `bySpacing` 用的是不是弦长公式（`2·sin(π/n)`），而不是周长除 `2π`——后者对 n=3 会算出 235px 的间距去放 260px 宽的盒子。**不要靠缩盒子来过这条断言**：盒子缩了字就装不下，那正是设计要避免的滑档。

- [ ] **Step 5: 四道闸 + commit**

```bash
cd frontend && pnpm test -- --run && pnpm lint && pnpm build
cd .. && git add frontend/src/lib/card-layout.ts frontend/src/lib/card-layout.test.ts
git commit -m "卡片装不下就长高，没有裁切这条路"
```

---

## Task 7: 画出来

**Files:**
- Create: `frontend/src/features/card/VisualCard.tsx`
- Test: `frontend/src/features/card/VisualCard.test.tsx`

- [ ] **Step 1: 写下会失败的测试**

`frontend/src/features/card/VisualCard.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { VisualCard } from "./VisualCard"

describe("VisualCard", () => {
  it("names itself by the term and the structure it drew", () => {
    // 一张图对读屏软件只是一块空白，除非它自己说出画的是什么形状。
    render(<VisualCard markdown={["## 步骤", "1. 加热", "2. 冷却"].join("\n")} title="结晶" />)

    expect(screen.getByRole("img", { name: /结晶/ })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /流程/ })).toBeInTheDocument()
  })

  it("draws one box per section", () => {
    const { container } = render(
      <VisualCard markdown={["## 甲", "## 乙", "## 丙"].join("\n")} title="词条" />,
    )

    expect(container.querySelectorAll("[data-block]")).toHaveLength(3)
  })

  it("sizes the viewBox from the frame it was given", () => {
    // 卡片自己算出宽高，元素按容器给的宽度缩放 —— 尺寸不锁，
    // 但也不能因此把图顶出面板。
    const { container } = render(<VisualCard markdown={["## 甲", "## 乙"].join("\n")} title="词条" />)
    const svg = container.querySelector("svg")!

    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${svg.dataset.width} ${svg.dataset.height}`)
    expect(Number(svg.dataset.height)).toBeGreaterThan(0)
  })

  it("says so instead of drawing an empty box", () => {
    render(<VisualCard markdown="" title="词条" />)

    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByText(/还没有/)).toBeInTheDocument()
  })

  it("says so when there is only one section to draw", () => {
    // 一个块没有结构可言，画出来的是一个方框 —— 那正是这套东西要避免的东西。
    render(<VisualCard markdown="## 只有一节" title="词条" />)

    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByText(/只有一段|没有可拆/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑一遍，确认它失败**

```bash
cd frontend && pnpm test -- --run src/features/card/VisualCard.test.tsx
```

Expected: FAIL —`Failed to resolve import "./VisualCard"`

- [ ] **Step 3: 写出实现**

`frontend/src/features/card/VisualCard.tsx`：

```tsx
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
        {markdown.trim()
          ? "这篇百科只有一段，没有可拆的结构。"
          : "这个知识点还没有详细百科。"}
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
```

- [ ] **Step 4: 跑到绿**

```bash
cd frontend && pnpm test -- --run src/features/card/VisualCard.test.tsx
```

Expected: PASS，5 passed

- [ ] **Step 5: 四道闸 + commit**

```bash
cd frontend && pnpm test -- --run && pnpm lint && pnpm build
cd .. && git add frontend/src/features/card/
git commit -m "wiki 画成一张有几何的图，不是一列方框"
```

---

## Task 8: 挂进 WikiPanel

**Files:**
- Modify: `frontend/src/features/knowledge/WikiPanel.tsx`（import、`TabsList`、新增 `TabsContent`）
- Test: `frontend/src/features/knowledge/WikiPanel.test.tsx`

- [ ] **Step 1: 写下会失败的测试**

追加到 `frontend/src/features/knowledge/WikiPanel.test.tsx` 现有最外层 `describe` 内部：

```tsx
  it("offers the wiki as a structured picture as well as a map", () => {
    // 导图画的是层级，信息图画的是这段内容本身是什么形状 ——
    // 一个用来找位置，一个用来在读之前就看懂大意（0807:73）。
    render(
      <Harness
        start={{ ...item, detailed_markdown: ["## 步骤", "1. 加热", "2. 冷却", "3. 结晶"].join("\n") }}
      />,
    )

    fireEvent.click(screen.getByRole("tab", { name: "信息图" }))

    expect(screen.getByRole("img", { name: /流程/ })).toBeInTheDocument()
  })
```

`Harness`（第 39 行）和 `item`（第 23 行）是该文件里已有的辅助组件与夹具，`render` / `fireEvent` / `screen` 也都已经 import 好了。

- [ ] **Step 2: 跑一遍，确认它失败**

```bash
cd frontend && pnpm test -- --run src/features/knowledge/WikiPanel.test.tsx
```

Expected: FAIL —`Unable to find an accessible element with the role "tab" and name "信息图"`

- [ ] **Step 3: 写出实现**

`frontend/src/features/knowledge/WikiPanel.tsx`，在第 22 行 `import { MindMap } ...` 之后加：

```ts
import { VisualCard } from "@/features/card/VisualCard"
```

`TabsList` 里，`导图` 之后加一个：

```tsx
            <TabsTrigger value="card">信息图</TabsTrigger>
```

`value="map"` 的 `TabsContent` 结束之后、`</Tabs>` 之前，加：

```tsx
          <TabsContent value="card" className="pt-5">
            {/* The card re-derives itself from the same markdown on every draw,
                exactly as the map does, so a wiki edited in the 详细百科 tab is
                redrawn here with no cache to invalidate. */}
            <div className="grid gap-2">
              <VisualCard markdown={markdown} title={term} />
              <p className="text-xs text-muted-foreground">
                结构由正文的层级和序号推出，同一篇每次画出来都一样。
              </p>
            </div>
          </TabsContent>
```

- [ ] **Step 4: 跑到绿**

```bash
cd frontend && pnpm test -- --run src/features/knowledge/WikiPanel.test.tsx
```

Expected: PASS

- [ ] **Step 5: 四道闸**

```bash
cd frontend && pnpm test -- --run && pnpm lint && pnpm build
```

- [ ] **Step 6: 拿真语料看一眼**

后端跑起来（仓库根目录，不要改 `STUDY_OS_DATA_DIR`）：

```bash
cd /d/project/study-os && ./.dev-backend.exe
```

另开一个：`cd frontend && pnpm dev`，打开知识库，挑一个有详细百科的词条，点「信息图」。要看到的是有几何的图，不是一列方框；看到方框长条说明 `classify` 落回了并列，去看那篇的正文有没有序号或箭头。

- [ ] **Step 7: commit 并推远端**

```bash
git add frontend/src/features/knowledge/WikiPanel.tsx frontend/src/features/knowledge/WikiPanel.test.tsx
git commit -m "知识库多一个 tab：这段内容本身是什么形状"
git push
```

---

## 一期收尾

跑完 Task 1–8 之后应当为真的三件事：

1. `pnpm test -- --run` 全绿，且新增用例里有一条断言「没有任何形状超出画布」——这是整份设计跟 skill 的分界线。
2. `WikiPanel` 有四个 tab，第四个对着任何一篇有两节以上的百科都能画出图。
3. 同一篇 markdown 画两次结果逐字节相同（`card-layout.test.ts` 里那条 `toEqual` 守着它）。

**下一期**（`DESIGN-visual-cards.md` §八 第 2 条）：对比 / 层级 / 表格三个独立几何。它们各自需要新的骨架，但 `readCard` / `text-metrics` / `VisualCard` 都不用改——`classify` 多几个分支，`layoutCard` 多几个函数。这是把并列做成根结构换来的。
