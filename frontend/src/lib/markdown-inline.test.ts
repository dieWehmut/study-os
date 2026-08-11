import { describe, expect, it } from "vitest"

import { plainInline } from "./markdown-inline"

describe("plainInline", () => {
  it("drops the asterisks around bold text", () => {
    // 2489 labels in the sample corpus carry them. Drawn as-is, the reader sees
    // the syntax instead of the emphasis it was meant to be.
    expect(plainInline("**内核 kernel** = 正文区图解")).toBe("内核 kernel = 正文区图解")
    expect(plainInline("__重点__")).toBe("重点")
  })

  it("drops the backticks around code spans", () => {
    expect(plainInline("接口：`render(kernel, shell?)`")).toBe("接口：render(kernel, shell?)")
  })

  it("keeps a link's words and drops its address", () => {
    // The words are what the author wrote for the reader; a URL in a node label
    // is unreadable and unclickable, since the map draws SVG text.
    expect(plainInline("见 [光合作用](https://x.com/a_b)")).toBe("见 光合作用")
  })

  it("keeps an image's alt text, which is the only part that reads", () => {
    expect(plainInline("![示意图](/img/light.png)")).toBe("示意图")
  })

  it("drops single-character emphasis too", () => {
    expect(plainInline("*强调* 与 _侧重_")).toBe("强调 与 侧重")
    expect(plainInline("~~划掉~~")).toBe("划掉")
  })

  it("leaves multiplication alone", () => {
    // "背景 * 形状框" is arithmetic, not emphasis. Markdown agrees: an opening
    // delimiter must be followed by something other than whitespace. Getting
    // this wrong silently rewrites formulas, which is worse than leaving a
    // stray asterisk on screen.
    expect(plainInline("背景 * 形状框 = 模板")).toBe("背景 * 形状框 = 模板")
    expect(plainInline("a * b * c")).toBe("a * b * c")
  })

  it("leaves multiplication alone even with no spaces around it", () => {
    // 手动验的时候撞上的：`3*4*5` 被画成了 `345`。空格那条规则挡不住紧挨着写
    // 的乘号 —— CommonMark 确实把 `3*4*5` 读成强调（词内强调对 `*` 是合法的），
    // 但一张数学卡上它是乘法，悄悄吃掉运算符就是把答案改错了。判据跟 `_` 早就
    // 用的那条一样：定界符紧贴着字母或数字，那它是算式或标识符，不是强调。
    expect(plainInline("3*4*5")).toBe("3*4*5")
    expect(plainInline("a*b*c")).toBe("a*b*c")
    expect(plainInline("P*Q*R")).toBe("P*Q*R")
    // 中文没有这个歧义 —— 没人用 `*` 乘汉字 —— 所以中文里的强调照旧脱掉。
    expect(plainInline("写得很*重要*的一句")).toBe("写得很重要的一句")
  })

  it("leaves an identifier's underscores alone", () => {
    // snake_case is everywhere in 教辅 code, and markdown does not treat an
    // underscore inside a word as emphasis either.
    expect(plainInline("knowledge_item_id 与 review_states")).toBe(
      "knowledge_item_id 与 review_states",
    )
  })

  it("leaves an unpaired delimiter alone", () => {
    // "**kwargs" is Python, and a lone asterisk is a footnote mark. Neither has
    // a closing delimiter, so neither is emphasis.
    expect(plainInline("def f(**kwargs)")).toBe("def f(**kwargs)")
    expect(plainInline("注 * 见下")).toBe("注 * 见下")
  })

  it("unwraps nested emphasis rather than leaving half of it", () => {
    expect(plainInline("**很*重要*的**")).toBe("很重要的")
  })

  it("returns an empty string unchanged", () => {
    expect(plainInline("")).toBe("")
  })
})
