import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import "katex/dist/katex.min.css"

import App from "./App"
import "./index.css"
import { registerServiceWorker } from "./lib/pwa"
import { initializeTheme } from "./lib/theme"

initializeTheme()
void registerServiceWorker({ enabled: import.meta.env.PROD })

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
