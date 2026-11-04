import { CircleCheck } from "lucide-react"
import { cn } from "cn"
import { Spinner } from "@/components/ui/spinner"
import type { Thread } from "@/lib/model"

/** "hermes-desktop" → "HD", "notes" → "NO". */
export function initials(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean)
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)
  return letters.toUpperCase()
}

function hue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

/** A project's colored initials, tinted from a hue derived from its name (T3-style). */
export function ProjectBadge({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ "--h": hue(name) } as React.CSSProperties}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[0.625rem] leading-none font-bold tracking-tight",
        "bg-[oklch(0.62_0.17_var(--h)/0.16)] text-[oklch(0.5_0.17_var(--h))] dark:bg-[oklch(0.62_0.17_var(--h)/0.22)] dark:text-[oklch(0.74_0.15_var(--h))]",
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

export type Status = Thread["status"] | "done"

/** Rolls a project's threads up into one status. */
export function aggregateStatus(threads: Thread[]): Status {
  if (threads.some((t) => t.status === "working")) return "working"
  if (threads.some((t) => t.status === "needs-you")) return "needs-you"
  return "done"
}

/** The small status label on the right of sidebar rows. Idle threads show nothing. */
export function StatusPill({ status, className }: { status: Status; className?: string }) {
  if (status === "idle") return null
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs font-medium",
        status === "working" && "text-update-foreground",
        status === "needs-you" && "text-warning-foreground",
        status === "done" && "text-emerald-600 dark:text-emerald-400",
        className,
      )}
    >
      {status === "working" && <Spinner className="size-3.5" />}
      {status === "needs-you" && <span className="size-1.5 rounded-full bg-warning" />}
      {status === "done" && <CircleCheck className="size-3.5" />}
      {status === "working" ? "Working" : status === "needs-you" ? "Needs you" : "Done"}
    </span>
  )
}
