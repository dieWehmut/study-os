import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, HashRouter } from "react-router-dom"
import "katex/dist/katex.min.css"

import App from "./App"
import "./index.css"
import { routerMode } from "./lib/runtime"
import { initializeTheme } from "./lib/theme"

initializeTheme()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {routerMode() === "hash" ? (
      <HashRouter><App /></HashRouter>
    ) : (
      <BrowserRouter><App /></BrowserRouter>
    )}
  </StrictMode>,
)
