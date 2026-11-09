import { useEffect, useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { ChevronRight, CircleAlert, CirclePause, MessageSquare, Repeat } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { Composer, type Draft } from "@/components/composer"
import { PageHeader } from "@/components/page-header"
import { Markdown } from "@/components/markdown"
import { backend } from "@kitab/core/backend"
import { dateTime, nextRun, relativeTime } from "@kitab/core/format"
import type { Id, Routine, Run } from "@kitab/core/model"
import { store, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

type RoutineState = "running" | "failed" | "paused" | "ok" | "new"

function stateOf(r: Routine): RoutineState {
  if (r.running) return "running"
  if (!r.enabled) return "paused"
  if (r.lastStatus === "failed") return "failed"
  return r.lastRunAt ? "ok" : "new"
}

/** How a routine or run is doing, always in the same slot at the start of a row. */
export function StatusMark({ state, className }: { state: RoutineState | Run["status"]; className?: string }) {
  return (
    <span className={cn("flex size-5 shrink-0 items-center justify-center", className)}>
      {state === "running" ? (
        <Spinner className="size-3.5 text-update-foreground" />
      ) : state === "failed" ? (
        <CircleAlert className="size-4 text-destructive" />
      ) : state === "paused" ? (
        <CirclePause className="size-4 text-muted-foreground" />
      ) : (
        <span className={cn("size-2 rounded-full", state === "new" ? "bg-muted-foreground/40" : "bg-emerald-500")} />
      )}
    </span>
  )
}

/** Routines section: every routine in the profile, the next to run first. */
export function RoutinesView() {
  const all = useStore((s) => s.routines)
  const profileId = useStore((s) => s.profileId)
  const personalities = useStore((s) => s.personalities)
  const routines = useMemo(() => all.filter((r) => r.profileId === profileId), [all, profileId])
  const active = routines.filter((r) => r.enabled).sort(byNextRun)
  const paused = routines.filter((r) => !r.enabled).sort((a, b) => a.name.localeCompare(b.name))
  const failing = active.filter((r) => r.lastStatus === "failed").length

  const personality = (id?: Id) => (id ? (personalities.find((p) => p.id === id)?.name ?? id) : undefined)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Routines"
        subtitle={
          routines.length > 0 && (
            <>
              {active.length} active
              {paused.length > 0 && ` · ${paused.length} paused`}
              {failing > 0 && <span className="text-destructive"> · {failing} failing</span>}
            </>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {routines.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Repeat />
              </EmptyMedia>
              <EmptyTitle>No routines yet</EmptyTitle>
              <EmptyDescription>
                Routines are repeat work you've handed over, on a schedule. Ask for one in a thread.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="mx-auto w-full max-w-chat px-6 py-6">
            {active.length > 0 && (
              <RowGroup title="Active" count={active.length}>
                {active.map((r) => (
                  <RoutineRow key={r.id} routine={r} personality={personality(r.personalityId)} />
                ))}
              </RowGroup>
            )}
            {paused.length > 0 && (
              <RowGroup title="Paused" count={paused.length}>
                {paused.map((r) => (
                  <RoutineRow key={r.id} routine={r} personality={personality(r.personalityId)} />
                ))}
              </RowGroup>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function RowGroup({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 flex items-baseline gap-2 px-1 text-xs font-medium text-muted-foreground">
        {title}
        {count != null && <span className="text-muted-foreground/70 tabular-nums">{count}</span>}
      </h2>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">{children}</div>
    </section>
  )
}

function RoutineRow({ routine: r, personality }: { routine: Routine; personality?: string }) {
  const state = stateOf(r)
  const meta = [r.schedule, personality, r.skills?.join(", ")].filter(Boolean).join(" · ")
  return (
    <button
      onClick={() => store.go({ kind: "routine", routineId: r.id })}
      className="group flex w-full items-center gap-3 px-3 py-3 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50"
    >
      <StatusMark state={state} />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm font-medium", state === "paused" && "text-muted-foreground")}>{r.name}</div>
        <div className="truncate text-xs text-muted-foreground">{meta}</div>
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-0.5 text-xs tabular-nums sm:flex">
        <NextLine routine={r} state={state} />
        <span className="text-muted-foreground">
          {r.lastRunAt ? `Ran ${relativeTime(r.lastRunAt)}` : "Never run"}
          {r.runCount ? ` · ${plural(r.runCount, "run")}` : ""}
        </span>
      </div>
      <ChevronRight className="size-4 shrink-0 text-transparent transition-colors group-hover:text-muted-foreground" />
    </button>
  )
}

/** The one thing worth knowing first: running, failing, or when it runs next. */
function NextLine({ routine: r, state }: { routine: Routine; state: RoutineState }) {
  if (state === "running") return <span className="text-update-foreground">Running now</span>
  if (state === "failed")
    return (
      <span className="text-destructive" title={r.lastError}>
        {r.failureStreak && r.failureStreak > 1 ? `Failed ${r.failureStreak}× in a row` : "Last run failed"}
      </span>
    )
  if (!r.enabled) return <span className="text-muted-foreground">Paused</span>
  return r.nextRunAt ? (
    <span title={dateTime(r.nextRunAt)}>{nextRun(r.nextRunAt)}</span>
  ) : (
    <span className="text-muted-foreground">Not scheduled</span>
  )
}

function Breadcrumb({ items }: { items: { label: ReactNode; onClick?: () => void }[] }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      {items.map((item, i) => (
        <span key={i} className="flex min-w-0 items-baseline gap-1.5">
          {i > 0 && <span className="text-muted-foreground/60">/</span>}
          {item.onClick ? (
            <button className="truncate text-muted-foreground hover:text-foreground" onClick={item.onClick}>
              {item.label}
            </button>
          ) : (
            <span className="truncate">{item.label}</span>
          )}
        </span>
      ))}
    </span>
  )
}

/** One routine: what it is, how it's doing, and all of its runs. */
export function RoutineView({ routineId }: { routineId: Id }) {
  const routine = useStore((s) => s.routines.find((r) => r.id === routineId))
  const personality = useStore((s) => s.personalities.find((p) => p.id === routine?.personalityId))
  const runs = useStore((s) => s.runs[routineId])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    backend
      .loadRuns(routineId)
      .catch((e) => toast.error(String(e)))
      .finally(() => setLoading(false))
  }, [routineId])

  const state = routine ? stateOf(routine) : "new"

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={<Breadcrumb items={[{ label: "Routines", onClick: () => store.go({ kind: "routines" }) }, { label: routine?.name }]} />}
      />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto w-full max-w-chat px-6 py-6">
          {routine && (
            <section className="mb-8">
              <div className="mb-4 flex items-start gap-3 px-1">
                <StatusMark state={state} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <h1 className="text-lg font-semibold">{routine.name}</h1>
                  <p className="text-sm text-muted-foreground">
                    {routine.schedule}
                    {personality && ` · ${personality.name}`}
                  </p>
                </div>
              </div>
              {state === "failed" && routine.lastError && (
                <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
                  <div className="font-medium text-destructive">
                    {routine.failureStreak && routine.failureStreak > 1
                      ? `The last ${routine.failureStreak} runs failed`
                      : "The last run failed"}
                  </div>
                  <div className="mt-1 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
                    {routine.lastError}
                  </div>
                </div>
              )}
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
                <Fact label="Status">
                  {state === "running" ? "Running" : state === "paused" ? "Paused" : state === "failed" ? "Failing" : "Active"}
                </Fact>
                <Fact label="Next run" title={dateTime(routine.nextRunAt)}>
                  {routine.enabled && routine.nextRunAt ? nextRun(routine.nextRunAt, "") : "—"}
                </Fact>
                <Fact label="Last run" title={dateTime(routine.lastRunAt)}>
                  {routine.lastRunAt ? relativeTime(routine.lastRunAt) : "Never"}
                </Fact>
                <Fact label="Runs">{routine.runCount ?? runs?.length ?? "—"}</Fact>
              </dl>
              {(routine.skills?.length || routine.script || routine.model) && (
                <dl className="mt-3 grid gap-1.5 px-1 text-xs">
                  {!!routine.skills?.length && <Detail label="Skills">{routine.skills.join(", ")}</Detail>}
                  {routine.script && (
                    <Detail label="Script">
                      <code className="font-mono">{routine.script}</code>
                    </Detail>
                  )}
                  {routine.model && <Detail label="Model">{routine.model}</Detail>}
                  {routine.createdAt && <Detail label="Created">{dateTime(routine.createdAt)}</Detail>}
                </dl>
              )}
            </section>
          )}

          {!runs?.length ? (
            <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
              {loading ? (
                <Spinner />
              ) : (
                <>
                  <span>No runs yet</span>
                  {routine?.nextRunAt && <span className="text-xs">The first one is {dateTime(routine.nextRunAt)}.</span>}
                </>
              )}
            </div>
          ) : (
            <RowGroup title="Runs" count={runs.length}>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </RowGroup>
          )}
        </div>
      </div>
    </div>
  )
}

function Fact({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="bg-card px-4 py-3" title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">{children}</dd>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

/** Every run of every routine in the profile, newest first, grouped by day. */
export function AllRunsView() {
  const all = useStore((s) => s.routines)
  const profileId = useStore((s) => s.profileId)
  const runsByRoutine = useStore((s) => s.runs)
  const routines = useMemo(() => all.filter((r) => r.profileId === profileId), [all, profileId])
  const [loading, setLoading] = useState(false)

  const ids = routines.map((r) => r.id).join(",")
  useEffect(() => {
    if (!ids) return
    setLoading(true)
    Promise.allSettled(ids.split(",").map((id) => backend.loadRuns(id)))
      .then((results) => {
        const failed = results.filter((r) => r.status === "rejected").length
        if (failed) toast.error(`Couldn't load runs for ${plural(failed, "routine")}`)
      })
      .finally(() => setLoading(false))
  }, [ids])

  const days = useMemo(() => {
    const names = new Map(routines.map((r) => [r.id, r.name]))
    const runs = routines
      .flatMap((r) => runsByRoutine[r.id] ?? [])
      .sort((a, b) => b.startedAt - a.startedAt)
    const groups: { day: string; runs: (Run & { routineName: string })[] }[] = []
    for (const run of runs) {
      const day = dayLabel(run.startedAt)
      const last = groups.at(-1)
      const row = { ...run, routineName: names.get(run.routineId) ?? "Routine" }
      if (last?.day === day) last.runs.push(row)
      else groups.push({ day, runs: [row] })
    }
    return groups
  }, [routines, runsByRoutine])

  const total = days.reduce((n, d) => n + d.runs.length, 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={<Breadcrumb items={[{ label: "Routines", onClick: () => store.go({ kind: "routines" }) }, { label: "All runs" }]} />}
        subtitle={total > 0 && plural(total, "run")}
      >
        {loading && total > 0 && <Spinner className="size-3.5 text-muted-foreground" />}
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {total === 0 ? (
          loading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Repeat />
                </EmptyMedia>
                <EmptyTitle>No runs yet</EmptyTitle>
                <EmptyDescription>Each time a routine runs, its report shows up here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        ) : (
          <div className="mx-auto w-full max-w-chat px-6 py-6">
            {days.map((d) => (
              <RowGroup key={d.day} title={d.day} count={d.runs.length}>
                {d.runs.map((run) => (
                  <RunRow key={run.id} run={run} routineName={run.routineName} />
                ))}
              </RowGroup>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function dayLabel(ms: number) {
  const d = new Date(ms)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return "Today"
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  })
}

/** A run. With `routineName` (the all-runs list) the routine leads and the time moves to the end. */
function RunRow({ run, routineName }: { run: Run; routineName?: string }) {
  const summary = firstLine(run.report)
  if (routineName)
    return (
      <button
        onClick={() => store.go({ kind: "run", routineId: run.routineId, runId: run.id })}
        className="group flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50"
      >
        <StatusMark state={run.status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{routineName}</div>
          {(run.status === "running" || summary || run.report === "") && (
            <div className={cn("truncate text-xs", summary ? "text-muted-foreground" : "text-muted-foreground/60")}>
              {run.status === "running" ? "Running…" : summary || "No report"}
            </div>
          )}
        </div>
        {run.threadId && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            <MessageSquare className="size-3" />
            Thread
          </span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={dateTime(run.startedAt)}>
          {new Date(run.startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </span>
        <ChevronRight className="size-4 shrink-0 text-transparent transition-colors group-hover:text-muted-foreground" />
      </button>
    )
  return (
    <button
      onClick={() => store.go({ kind: "run", routineId: run.routineId, runId: run.id })}
      className="group flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50"
    >
      <StatusMark state={run.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium tabular-nums">{dateTime(run.startedAt)}</span>
          <span className="text-xs text-muted-foreground">{relativeTime(run.startedAt)}</span>
        </div>
        {/* Nothing until the report has loaded: "No report" only once we know there isn't one. */}
        {(run.status === "running" || summary || run.report === "") && (
          <div className={cn("truncate text-xs", summary ? "text-muted-foreground" : "text-muted-foreground/60")}>
            {run.status === "running" ? "Running…" : summary || "No report"}
          </div>
        )}
      </div>
      {run.threadId && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <MessageSquare className="size-3" />
          Thread
        </span>
      )}
      <ChevronRight className="size-4 shrink-0 text-transparent transition-colors group-hover:text-muted-foreground" />
    </button>
  )
}

/** One run's report. Replying to it turns it into a thread. */
export function RunView({ routineId, runId }: { routineId: Id; runId: Id }) {
  const routine = useStore((s) => s.routines.find((r) => r.id === routineId))
  const run = useStore((s) => s.runs[routineId]?.find((r) => r.id === runId))
  const [drafts, setDrafts] = useState<Draft[]>([])

  useEffect(() => {
    if (!run) void backend.loadRuns(routineId)
    else if (run.report === undefined) void backend.loadRunReport(routineId, runId).catch((e) => toast.error(String(e)))
  }, [run, routineId, runId])

  // Throws on failure so the composer keeps what you wrote.
  const reply = async (text: string, sent: Draft[]) => {
    try {
      const threadId = await backend.replyToRun(routineId, runId, text)
      if (sent.length) await backend.send(threadId, "", sent.map((d) => d.attachment))
      store.go({ kind: "thread", threadId })
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e))
      throw e
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={
          <Breadcrumb
            items={[
              { label: "Routines", onClick: () => store.go({ kind: "routines" }) },
              { label: routine?.name, onClick: () => store.go({ kind: "routine", routineId }) },
              { label: run && dateTime(run.startedAt) },
            ]}
          />
        }
      >
        {run && <StatusMark state={run.status} />}
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto w-full max-w-chat px-6 py-6">
          {run?.report === undefined ? (
            <Spinner />
          ) : run.report ? (
            <Markdown text={run.report} />
          ) : (
            <p className="text-sm text-muted-foreground">This run produced no report.</p>
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-chat px-6 pb-5">
        {run?.threadId ? (
          <Button className="w-full" variant="outline" onClick={() => store.go({ kind: "thread", threadId: run.threadId! })}>
            <MessageSquare />
            Open the thread for this run
          </Button>
        ) : (
          <Composer placeholder="Talk about this run… (starts a thread)" drafts={drafts} setDrafts={setDrafts} onSend={reply} />
        )}
      </div>
    </div>
  )
}

function byNextRun(a: Routine, b: Routine) {
  return (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity)
}

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

function firstLine(s?: string) {
  return (
    (s ?? "")
      .replace(/[#*_`>]/g, "")
      .trim()
      .split("\n")
      .find((l) => l.trim()) ?? ""
  )
}
