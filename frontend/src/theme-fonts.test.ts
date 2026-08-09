import { describe, expect, it } from "vitest"

// 用 ?raw 而不是 node:fs 读这两份 CSS：src 走的是 tsconfig.app.json，types 里
// 只有 vite/client，没有 node。为一个测试把 @types/node 塞进浏览器侧的编译单元，
// 等于让业务代码也能摸到 process、Buffer 这些跑不起来的全局。
import packageCSS from "lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css?raw"

import themeCSS from "./index.css?raw"

// 字体名写错既不会让构建失败，也不会让渲染报错——它只是静默落到栈里的下一个名字，
// 页面看起来"不太对"而已。所以把引用的名字和字体包真正声明的名字对起来。
function referencedFamilies(variable: string): string[] {
  const declarations = [...themeCSS.matchAll(new RegExp(`${variable}:\\s*([^;]+);`, "g"))]
  expect(declarations.length).toBeGreaterThan(0)
  return declarations.map((match) => match[1].trim().split(",")[0].trim().replace(/^["']|["']$/g, ""))
}

// 这份 webfont 按 unicode-range 切了 97 段，每段一条 @font-face，所以同一个 family
// 名会出现 97 次；用 Set 才能把比较写得清楚。
const declaredFamilies = new Set(
  [...packageCSS.matchAll(/font-family:\s*(['"])(.+?)\1/g)].map((match) => match[2]),
)

describe("theme fonts", () => {
  it("names a font family the bundled webfont actually declares", () => {
    expect(declaredFamilies.size).toBeGreaterThan(0)

    for (const variable of ["--font-sans", "--font-heading"]) {
      for (const family of referencedFamilies(variable)) {
        expect(declaredFamilies).toContain(family)
      }
    }
  })

  it("imports the subset stylesheet that defines that family", () => {
    // 引包根会把四个变体全拉进来，其中两个声明了同名 family，最后加载的那个赢——
    // 等于让顺序替我们选字形。只引一个。
    expect(themeCSS).toContain('@import "lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css";')
  })
})
