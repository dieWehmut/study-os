import { useState } from "react"
import { Link } from "react-router-dom"

import { avatarRenderSize, githubAvatarURL, githubUser, profileInitial } from "@/lib/profile"

interface SidebarProfileProps {
  onNavigate?: () => void
}

export function SidebarProfile({ onNavigate }: SidebarProfileProps) {
  const [avatarUnavailable, setAvatarUnavailable] = useState(false)

  return (
    <div className="flex flex-col items-center px-4 pb-3 pt-5">
      <Link
        to="/"
        aria-label="回到首页"
        onClick={onNavigate}
        className="rounded-full transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {avatarUnavailable ? (
          <span
            aria-hidden="true"
            style={{ width: avatarRenderSize, height: avatarRenderSize }}
            className="flex items-center justify-center rounded-full bg-primary/10 text-5xl font-semibold text-primary"
          >
            {profileInitial(githubUser)}
          </span>
        ) : (
          <img
            src={githubAvatarURL(githubUser)}
            alt={`${githubUser} 的头像`}
            width={avatarRenderSize}
            height={avatarRenderSize}
            // 头像是装饰性的：它没到之前先留白，而不是把导航往下推一次再弹回来。
            loading="lazy"
            onError={() => setAvatarUnavailable(true)}
            className="rounded-full object-cover"
            style={{ width: avatarRenderSize, height: avatarRenderSize }}
          />
        )}
      </Link>

      <p className="mt-3 text-center text-xl font-extrabold leading-tight tracking-tight">
        {githubUser}
      </p>
    </div>
  )
}
