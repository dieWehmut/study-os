import "@testing-library/jest-dom/vitest"
import { configure } from "@testing-library/react"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Same reasoning as testTimeout in vite.config.ts, one level down: findBy*/waitFor
// default to 1s, and a loaded machine (124 files across several workers) can take
// longer than that to paint a route into jsdom. The symptom was a different pair of
// "Unable to find role=..." failures on every full run -- each of them passing when
// its own file was run alone. This is the stopwatch, not the code.
configure({ asyncUtilTimeout: 5000 })

afterEach(() => cleanup())
