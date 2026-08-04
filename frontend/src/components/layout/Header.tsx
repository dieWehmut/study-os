import { ThemeToggle } from "./ThemeToggle"

export function Header() {
  return (
    <header className="sticky top-0 border-b border-border/80 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex-1" />
        <ThemeToggle />
      </div>
    </header>
  )
}
