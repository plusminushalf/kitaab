// The sidebar's update button, after T3 Code's: it shows up only when there's
// something to do. A download arrow with a dot means a new version is out, a ring
// fills while it downloads, and a restart arrow with a tick means it's ready.
// Hovering shows what's new.
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Download, ExternalLink, RotateCw, TriangleAlert } from "lucide-react"
import { cn } from "cn"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { describeUpdate, releaseUrl, runUpdateAction, targetVersion, updateAction, useUpdateState } from "@/lib/updates"
import { relativeTime } from "@kitab/core/format"
import type { UpdateState } from "../../../shared/bridge"

const RADIUS = 14
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function UpdateButton() {
  const state = useUpdateState()
  if (!state) return null
  const action = updateAction(state)
  const downloading = state.status === "downloading"
  if (action === "none" && !downloading) return null

  const failed =
    (state.notAppliedVersion !== null && targetVersion(state) === state.notAppliedVersion) ||
    (state.errorContext === "download" || state.errorContext === "install")
  const label = describeUpdate(state)

  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-disabled={downloading || undefined}
            onClick={() => !downloading && runUpdateAction(state)}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-control text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              downloading ? "cursor-default" : "cursor-pointer hover:bg-sidebar-row-hover",
            )}
          />
        }
        delay={150}
      >
        {downloading ? (
          <DownloadRing percent={state.downloadPercent} />
        ) : failed ? (
          <TriangleAlert className="size-4 text-amber-500" />
        ) : action === "install" ? (
          <ReadyIcon />
        ) : (
          <AvailableIcon />
        )}
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-80 p-0">
        <UpdateCard state={state} label={label} />
      </HoverCardContent>
    </HoverCard>
  )
}

function AvailableIcon() {
  return (
    <span className="relative grid size-4 place-items-center">
      <Download className="size-4" />
      <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-sidebar" />
    </span>
  )
}

function ReadyIcon() {
  return (
    <span className="relative grid size-4 place-items-center">
      <RotateCw className="size-4" />
      <span className="absolute -right-1 -bottom-1 grid size-2.5 place-items-center rounded-full bg-foreground text-background ring-2 ring-sidebar">
        <Check className="size-2" strokeWidth={3} />
      </span>
    </span>
  )
}

function DownloadRing({ percent }: { percent: number | null }) {
  const p = Math.min(100, Math.max(0, percent ?? 0))
  return (
    <span className="relative grid size-8 place-items-center">
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full -rotate-90" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r={RADIUS} fill="none" className="stroke-current opacity-20" strokeWidth="1.5" />
        <circle
          cx="16"
          cy="16"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - p / 100)}
          strokeLinecap="round"
          strokeWidth="1.5"
          className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
        />
      </svg>
      <Download className="size-4" />
    </span>
  )
}

/** The hover card: what the button will do, then what changed in each newer release. */
function UpdateCard({ state, label }: { state: UpdateState; label: string }) {
  const version = targetVersion(state)
  const newest = state.releaseNotes.find((n) => n.version === version)
  const notes = state.releaseNotes.filter((n) => n.body)
  const action = updateAction(state)

  return (
    <div className="flex max-h-[min(30rem,calc(100vh-6rem))] flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="font-medium leading-snug">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {version && newest?.publishedAt ? `Released ${relativeTime(Date.parse(newest.publishedAt))} · ` : ""}
          You have {state.currentVersion}
          {action === "download" && " · Click to download"}
          {action === "install" && " · Click to restart"}
        </div>
      </div>
      {notes.length > 0 && (
        <div className="min-h-0 overflow-y-auto border-t border-foreground/10 px-3 pt-2 pb-3">
          {notes.map((n, i) => (
            <section key={n.version} className={i > 0 ? "mt-3" : undefined}>
              {notes.length > 1 && <h3 className="mb-1 text-xs font-semibold">{n.version}</h3>}
              <div className="prose prose-sm prose-neutral max-w-none text-xs dark:prose-invert prose-headings:my-1 prose-headings:text-xs prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-ul:pl-4 prose-li:my-0.5 prose-a:text-muted-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{n.body}</ReactMarkdown>
              </div>
            </section>
          ))}
        </div>
      )}
      {version && (
        <a
          href={releaseUrl(version)}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 border-t border-foreground/10 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
        >
          View release on GitHub
          <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  )
}
