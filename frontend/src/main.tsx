import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, HashRouter } from "react-router-dom"
import "katex/dist/katex.min.css"

import App from "./App"
import "./index.css"
import { registerServiceWorker } from "./lib/pwa"
import { isStaticDemo, routerMode } from "./lib/runtime"
import { initializeTheme } from "./lib/theme"

initializeTheme()
const staticDemo = isStaticDemo()
void registerServiceWorker({ enabled: import.meta.env.PROD, staticDemo })

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {routerMode() === "hash" ? (
      <HashRouter><App /></HashRouter>
    ) : (
      <BrowserRouter><App /></BrowserRouter>
    )}
  </StrictMode>,
)
