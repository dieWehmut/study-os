import { Component, type ErrorInfo, type ReactNode } from "react"

import { Button } from "@/components/ui/button"

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * A crashed page must not look like a crashed app.
 *
 * Answering a 默写公式 card once answered with `"expected_answers":null`, the
 * memory panel indexed that field, and React unmounted the entire tree: no
 * sidebar, no verdict, nothing to press but restarting the window. That payload
 * is fixed at both ends, but a render error will happen again, and the shell --
 * the part that lets you leave the broken page -- is what has to survive it.
 *
 * The caller keys this on the route, so navigating elsewhere remounts it and
 * clears the failure.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The boundary exists so the screen stays usable, not so the failure goes
    // unseen: whoever debugs this next needs the trace React would have printed.
    console.error("页面渲染失败", error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div role="alert" className="mx-auto grid w-full max-w-xl gap-3 py-16 text-center">
        <h1 className="font-heading text-xl font-semibold">这个页面没能显示出来</h1>
        <p className="text-sm text-muted-foreground">
          学习数据都还在本地。重新加载通常就能恢复，先切到别的页面也可以继续用。
        </p>
        <p className="break-words rounded-lg border border-dashed px-3 py-2 text-left font-mono text-xs text-muted-foreground">
          {error.message || error.name}
        </p>
        <div className="justify-self-center">
          <Button onClick={() => window.location.reload()}>重新加载</Button>
        </div>
      </div>
    )
  }
}