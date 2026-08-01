import { Navigate, Route, Routes } from "react-router-dom"

import { AppShell } from "@/components/layout/AppShell"
import Home from "@/pages/Home"
import Import from "@/pages/Import"
import Knowledge from "@/pages/Knowledge"
import Memory from "@/pages/Memory"
import Practice from "@/pages/Practice"
import Settings from "@/pages/Settings"

export default function App() {
  return (
    <AppShell>
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
