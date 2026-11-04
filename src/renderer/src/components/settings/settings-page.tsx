import { useEffect, useState, type ReactNode } from "react"
import { Paintbrush, Server, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { store, useStore, type SettingsSection } from "@/lib/store"
import { cn } from "@/lib/utils"
import { AppearanceSection } from "./appearance-section"
import { GeneralSection } from "./general-section"

const SECTIONS: { id: SettingsSection; label: string; icon: typeof Server }[] = [
  { id: "general", label: "Server", icon: Server },
  { id: "appearance", label: "Appearance", icon: Paintbrush },
]

/**
 * Settings float over the app like T3 Code's: a large rounded panel below the
 * traffic lights, with its own section nav. Esc or the X closes it.
 */
export function SettingsOverlay() {
  const section = useStore((s) => s.settings)
  const [shown, setShown] = useState<SettingsSection>("general")
  // Keep the last section rendered while the panel animates closed.
  useEffect(() => {
    if (section) setShown(section)
  }, [section])
  const current = SECTIONS.find((s) => s.id === shown) ?? SECTIONS[0]

  return (
    <Dialog open={section !== null} onOpenChange={(open) => !open && store.set({ settings: null })}>
      <DialogContent
        showCloseButton={false}
        className="top-11 right-3 bottom-3 left-3 flex w-auto max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl sm:max-w-none"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r bg-sidebar-row-hover/40 p-3">
          <div className="px-2 pt-1 pb-3 text-xs font-medium text-muted-foreground">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => store.set({ settings: s.id })}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                s.id === shown && "bg-accent font-medium text-accent-foreground",
              )}
            >
              <s.icon className="size-4" />
              {s.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-5">
            <nav className="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <span className="text-muted-foreground">Settings</span>
              <span className="text-muted-foreground/60">/</span>
              <span className="truncate font-medium">{current.label}</span>
            </nav>
            <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close settings" />}>
              <X />
            </DialogClose>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-4xl px-8 py-8">
              {shown === "appearance" ? <AppearanceSection /> : <GeneralSection />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SettingsGroup({
  title,
  actions,
  children,
  className,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("mb-10", className)}>
      <div className="mb-3 flex min-h-8 items-center justify-between gap-2 px-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/** One setting: label and description on the left, its control on the right. */
export function SettingRow({
  label,
  description,
  children,
  onReset,
}: {
  label: string
  description?: ReactNode
  children: ReactNode
  /** Shown as a small "Reset" link when the value differs from the default. */
  onReset?: () => void
}) {
  return (
    <div className="flex items-center gap-6 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          {label}
          {onReset && (
            <button className="text-xs font-normal text-muted-foreground hover:text-foreground" onClick={onReset}>
              Reset
            </button>
          )}
        </div>
        {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

export function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="divide-y overflow-hidden rounded-xl border bg-card">{children}</div>
}
