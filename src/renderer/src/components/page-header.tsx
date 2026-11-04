import type { ReactNode } from "react"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { useFullscreen } from "@/hooks/use-fullscreen"

// The window's title bar. When the sidebar is hidden it leaves room for the
// traffic lights, except in full screen where macOS hides them.
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title?: ReactNode
  /** Muted text after the title, e.g. the project name. */
  subtitle?: ReactNode
  children?: ReactNode
}) {
  const { open } = useSidebar()
  const fullscreen = useFullscreen()
  return (
    <header
      className="app-drag flex h-[52px] shrink-0 items-center gap-2 border-b border-toolbar-border bg-toolbar px-3 text-toolbar-foreground"
      style={{ paddingLeft: !open && !fullscreen ? 84 : undefined }}
    >
      <SidebarTrigger className="text-muted-foreground" />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-sm font-medium">{title}</span>
        {subtitle && <span className="shrink-0 truncate text-sm text-muted-foreground">{subtitle}</span>}
      </div>
      {children}
    </header>
  )
}
