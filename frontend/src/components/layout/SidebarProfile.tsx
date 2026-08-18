import { BookOpen } from "lucide-react"
import { Link } from "react-router-dom"

interface SidebarProfileProps {
  onNavigate?: () => void
}

const brandMarkSize = 152

export function SidebarProfile({ onNavigate }: SidebarProfileProps) {
  return (
    <div className="flex flex-col items-center px-4 pb-3 pt-5">
      <Link
        to="/"
        aria-label="回到首页"
        onClick={onNavigate}
        className="rounded-2xl transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <span
          aria-hidden="true"
          style={{ width: brandMarkSize, height: brandMarkSize }}
          className="grid place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm"
        >
          <BookOpen className="size-16" strokeWidth={1.75} />
        </span>
      </Link>

      <p className="mt-3 text-center text-xl font-extrabold leading-tight tracking-normal">
        学习系统
      </p>
    </div>
  )
}
