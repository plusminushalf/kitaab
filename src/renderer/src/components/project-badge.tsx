import { CircleCheck } from "lucide-react"
import { cn } from "cn"
import { Spinner } from "@/components/ui/spinner"
import type { Thread } from "@kitab/core/model"
import { hue, initials } from "@kitab/core/project-color"

export { hue, initials }

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
export function StatusPill({ status, stopping, className }: { status: Status; stopping?: boolean; className?: string }) {
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
      {status === "working" ? (stopping ? "Stopping" : "Working") : status === "needs-you" ? "Needs you" : "Done"}
    </span>
  )
}
