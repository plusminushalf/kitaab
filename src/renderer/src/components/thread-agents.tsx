import { useEffect, useState, type MouseEvent } from "react"
import { toast } from "sonner"
import { Ban, Check, ChevronRight, CircleAlert, CircleDashed, Square } from "lucide-react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Spinner } from "@/components/ui/spinner"
import { backend } from "@kitab/core/backend"
import type { Id, Subagent } from "@kitab/core/model"
import { shortModelName } from "@kitab/core/model-names"
import { isActive } from "@kitab/core/subagents"
import { useStore } from "@/lib/store"

// The helper agents a thread handed work to, in its details card: the ones still
// working first, finished ones folded under "Previous agents" (T3 Code's lineage rows).

const EMPTY: Subagent[] = []

export function useSubagents(threadId: Id): Subagent[] {
  return useStore((s) => s.subagents[threadId] ?? EMPTY)
}

/** Re-reads the roster while helpers are working, in case an event went missing. */
export function useSubagentPolling(threadId: Id | null) {
  const active = useStore((s) => (threadId ? (s.subagents[threadId] ?? EMPTY).some(isActive) : false))
  const connected = useStore((s) => s.connection.state === "connected")
  useEffect(() => {
    if (!threadId || !active || !connected) return
    const refresh = () => document.visibilityState === "visible" && void backend.loadSubagents(threadId)
    const timer = window.setInterval(refresh, 10_000)
    window.addEventListener("focus", refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", refresh)
    }
  }, [threadId, active, connected])
}

function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!ticking) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [ticking])
  return now
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const STATUS_LABEL: Record<Subagent["status"], string> = {
  queued: "Waiting to start",
  running: "Working",
  completed: "Done",
  failed: "Failed",
  interrupted: "Stopped",
}

function StatusIcon({ status }: { status: Subagent["status"] }) {
  const cls = "size-4.5 shrink-0"
  switch (status) {
    case "running":
      return <Spinner className={cls + " text-muted-foreground"} />
    case "queued":
      return <CircleDashed className={cls + " text-muted-foreground"} />
    case "completed":
      return <Check className={cls + " text-muted-foreground"} />
    case "failed":
      return <CircleAlert className={cls + " text-destructive"} />
    case "interrupted":
      return <Ban className={cls + " text-muted-foreground"} />
  }
}

export function AgentsSection({ threadId }: { threadId: Id }) {
  const all = useSubagents(threadId)
  const active = all.filter(isActive)
  const previous = all.filter((a) => !isActive(a)).reverse()
  const [showPrevious, setShowPrevious] = useState(false)
  const now = useNow(active.length > 0)
  if (!all.length) return null

  return (
    <div className="flex flex-col">
      {active.map((a) => (
        <AgentRow key={a.id} threadId={threadId} agent={a} now={now} />
      ))}
      {previous.length > 0 && (
        <>
          <button
            className="flex min-h-9 items-center gap-3 rounded-xl px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => setShowPrevious(!showPrevious)}
            aria-expanded={showPrevious}
          >
            <ChevronRight className={"size-4.5 shrink-0 transition-transform " + (showPrevious ? "rotate-90" : "")} />
            <span className="flex-1">Previous agents</span>
            <span className="tabular-nums">{previous.length}</span>
          </button>
          {showPrevious && previous.map((a) => <AgentRow key={a.id} threadId={threadId} agent={a} now={now} />)}
        </>
      )}
    </div>
  )
}

function AgentRow({ threadId, agent: a, now }: { threadId: Id; agent: Subagent; now: number }) {
  const running = isActive(a)
  const took = (a.endedAt ?? now) - a.startedAt
  const stop = (e: MouseEvent) => {
    e.stopPropagation()
    void backend.stopSubagent(threadId, a.id).catch((err) => toast.error(String(err instanceof Error ? err.message : err)))
  }

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={300}
        render={<div />}
        className="group flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
      >
        <StatusIcon status={a.status} />
        <span className={"min-w-0 flex-1 truncate " + (running ? "" : "text-muted-foreground")}>{a.goal}</span>
        {running && !a.id.startsWith("~") ? (
          <>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums group-hover:hidden">{elapsed(took)}</span>
            <button
              className="hidden size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground group-hover:flex hover:bg-background hover:text-foreground"
              onClick={stop}
              aria-label="Stop this agent"
              title="Stop this agent"
            >
              <Square className="size-3 fill-current" />
            </button>
          </>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{elapsed(took)}</span>
        )}
      </HoverCardTrigger>
      <HoverCardContent side="left" align="start" sideOffset={14} className="flex flex-col gap-2">
        <div className="selectable leading-snug font-medium">{a.goal}</div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span className={a.status === "failed" ? "text-destructive" : ""}>{STATUS_LABEL[a.status]}</span>
          <span>· {elapsed(took)}</span>
          {a.model && <span>· {shortModelName(a.model)}</span>}
          {a.toolCount ? <span>· {a.toolCount === 1 ? "1 tool call" : `${a.toolCount} tool calls`}</span> : null}
        </div>
        {running && a.activity && (
          <div className="selectable truncate font-mono text-xs text-muted-foreground" title={a.activity}>
            {a.activity}
          </div>
        )}
        {a.summary && <div className="selectable line-clamp-6 text-xs whitespace-pre-wrap">{a.summary}</div>}
      </HoverCardContent>
    </HoverCard>
  )
}

/** Helpers still working in this thread, for the details button's badge. */
export function useActiveAgentCount(threadId: Id): number {
  return useStore((s) => (s.subagents[threadId] ?? EMPTY).filter(isActive).length)
}
