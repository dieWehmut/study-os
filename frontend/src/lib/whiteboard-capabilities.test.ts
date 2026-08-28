import { describe, expect, it } from "vitest"

import {
  WHITEBOARD_CAPABILITIES,
  WHITEBOARD_TIERS,
  capabilitiesForTier,
} from "./whiteboard-capabilities"

describe("whiteboard capability research catalogue", () => {
  it("keeps all three experience tiers populated and uniquely addressable", () => {
    expect(WHITEBOARD_TIERS).toEqual(["foundation", "polish", "frontier"])
    expect(WHITEBOARD_CAPABILITIES.length).toBeGreaterThanOrEqual(12)
    expect(new Set(WHITEBOARD_CAPABILITIES.map((entry) => entry.id)).size)
      .toBe(WHITEBOARD_CAPABILITIES.length)
    for (const tier of WHITEBOARD_TIERS) {
      expect(capabilitiesForTier(tier).length).toBeGreaterThanOrEqual(3)
    }
  })

  it("records a product trail and a learner-facing reason for every capability", () => {
    expect(WHITEBOARD_CAPABILITIES.every((entry) =>
      entry.products.length > 0 && entry.learningValue.trim() !== "" && entry.evidence.trim() !== "",
    )).toBe(true)
    expect(WHITEBOARD_CAPABILITIES.some((entry) => entry.products.includes("Heptabase"))).toBe(true)
    expect(WHITEBOARD_CAPABILITIES.some((entry) => entry.products.includes("FlexNote"))).toBe(true)
    expect(WHITEBOARD_CAPABILITIES.some((entry) => entry.products.includes("Project graph"))).toBe(true)
  })

  it("returns a fresh filtered list without allowing callers to mutate the registry", () => {
    const foundation = capabilitiesForTier("foundation")
    expect(foundation.every((entry) => entry.tier === "foundation")).toBe(true)
    foundation.pop()
    expect(capabilitiesForTier("foundation").length).toBeGreaterThan(foundation.length)
  })
})
