import { useEffect } from "react"
import { Navigate, Route, Routes } from "react-router-dom"

import { AppShell } from "@/components/layout/AppShell"
import { UpdateDialog } from "@/features/update/UpdateDialog"
import Home from "@/pages/Home"
import Import from "@/pages/Import"
import Knowledge from "@/pages/Knowledge"
import Memory from "@/pages/Memory"
import Practice from "@/pages/Practice"
import Settings from "@/pages/Settings"

export default function App() {
  useEffect(() => {
    function closeLauncher() {
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/launcher/close", "1")
      }
    }
    window.addEventListener("pagehide", closeLauncher)
    return () => window.removeEventListener("pagehide", closeLauncher)
  }, [])

  return (
    <AppShell>
      <UpdateDialog />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/knowledge" element={<Knowledge />} />
        <Route path="/import" element={<Import />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/practice" element={<Practice />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
