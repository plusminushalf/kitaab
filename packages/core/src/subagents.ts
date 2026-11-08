import type { Id, Subagent, Thread } from "./model"
import { store } from "./store"

// Helper agents a thread delegated work to (Hermes `delegate_task`). Live
// `subagent.*` events keep them current; `subagent.list` fills them in after a
// reload or a dropped event. Top-level delegations run in the background, so a
// thread can sit idle while its helpers are still working.

type Payload = Record<string, any>

const TERMINAL = new Set<Subagent["status"]>(["completed", "failed", "interrupted"])
/** Finished helpers kept per thread; the card folds them under "Previous agents". */
const KEEP_FINISHED = 30

export const isActive = (a: Subagent) => !TERMINAL.has(a.status)

/**
 * The status a thread shows. Its own reply may be over while helpers it started
 * are still going; it's still working then (you'd only be talking over them).
 */
export function shownStatus(t: Thread, subagents: Record<Id, Subagent[]>): Thread["status"] {
  return t.status === "idle" && subagents[t.id]?.some(isActive) ? "working" : t.status
}

const str = (v: unknown) => (typeof v === "string" ? v : "")
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const oneLine = (s: string, max = 160) => {
  const line = s.replace(/\s+/g, " ").trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
/** Hermes timestamps are seconds. */
const toMs = (t: unknown) => {
  const n = num(t)
  return n === undefined ? undefined : n < 1e12 ? n * 1000 : n
}

function statusOf(v: unknown, terminal: boolean): Subagent["status"] {
  if (v === "completed" || v === "failed" || v === "interrupted") return v
  if (v === "timeout" || v === "error") return "failed"
  if (v === "cancelled" || v === "canceled") return "interrupted"
  // A complete event ends the helper whatever it says; don't leave it spinning.
  if (terminal) return v === "ok" || v === "success" || !v ? "completed" : "failed"
  return v === "queued" ? "queued" : "running"
}

/** Real ids come from Hermes; "~" ids stand in until one arrives. */
function idOf(p: Payload): Id {
  if (str(p.subagent_id)) return p.subagent_id
  if (str(p.delegation_id)) return `~${p.delegation_id}:${num(p.task_index) ?? 0}`
  return `~goal:${str(p.goal)}`
}

function save(threadId: Id, list: Subagent[]) {
  const finished = list.filter((a) => !isActive(a))
  if (finished.length > KEEP_FINISHED) {
    const drop = new Set(finished.slice(0, finished.length - KEEP_FINISHED).map((a) => a.id))
    list = list.filter((a) => !drop.has(a.id))
  }
  store.set((s) => ({ subagents: { ...s.subagents, [threadId]: list } }))
}

/** Finds the row for `id`, adopting a stand-in row with the same goal once the real id shows up. */
function indexFor(list: Subagent[], id: Id, goal: string): number {
  const i = list.findIndex((a) => a.id === id)
  if (i >= 0 || id.startsWith("~")) return i
  return list.findIndex((a) => a.id.startsWith("~") && isActive(a) && goal && a.goal === goal)
}

/** Applies one live `subagent.*` event. */
export function onSubagentEvent(threadId: Id, type: string, p: Payload) {
  if (type === "subagent.text" || type === "subagent.thinking") return
  const list = [...(store.get().subagents[threadId] ?? [])]
  const id = idOf(p)
  const i = indexFor(list, id, str(p.goal))
  const prev = i >= 0 ? list[i] : undefined
  // A late event must not bring a finished helper back to life.
  if (prev && !isActive(prev) && type !== "subagent.complete") return

  const now = Date.now()
  const next: Subagent = {
    id,
    goal: str(p.goal) || prev?.goal || "Helper agent",
    status: prev?.status ?? "running",
    model: str(p.model) || prev?.model,
    startedAt: prev?.startedAt ?? now,
    endedAt: prev?.endedAt,
    toolCount: num(p.tool_count) ?? prev?.toolCount,
    activity: prev?.activity,
    summary: prev?.summary,
  }
  switch (type) {
    case "subagent.spawn_requested":
      next.status = prev?.status ?? "queued"
      break
    case "subagent.start":
      next.status = "running"
      break
    case "subagent.tool": {
      const tool = str(p.tool_name)
      const preview = oneLine(str(p.tool_preview) || str(p.text))
      if (tool) next.activity = preview ? `${tool}: ${preview}` : tool
      next.status = "running"
      break
    }
    case "subagent.progress": {
      const text = oneLine(str(p.text).replace(/^🔀\s*/u, ""))
      if (text) next.activity = text
      break
    }
    case "subagent.complete": {
      next.status = statusOf(p.status, true)
      next.endedAt = now
      const secs = num(p.duration_seconds)
      if (secs !== undefined) next.startedAt = now - secs * 1000
      const summary = str(p.summary) || str(p.text)
      next.summary = summary ? oneLine(summary, 500) : str(p.status) === "timeout" && secs ? `Timed out after ${Math.round(secs)}s` : prev?.summary
      next.activity = undefined
      break
    }
    default:
      return
  }
  if (i >= 0) list[i] = next
  else list.push(next)
  save(threadId, list)
}

/**
 * Merges a `subagent.list` answer. `before` is the thread's list when the request
 * went out: if events changed it meanwhile, they're newer than this answer, so
 * helpers missing from it aren't taken as finished.
 */
export function reconcileSubagents(threadId: Id, live: Payload[], failed: Payload[], before: Subagent[] | undefined) {
  const current = store.get().subagents[threadId]
  const list = [...(current ?? [])]
  const seen = new Set<Id>()
  const now = Date.now()

  for (const r of live) {
    const id = idOf(r)
    seen.add(id)
    const i = indexFor(list, id, str(r.goal))
    const prev = i >= 0 ? list[i] : undefined
    if (prev && !isActive(prev)) continue
    const lastTool = str(r.last_tool)
    const next: Subagent = {
      id,
      goal: str(r.goal) || prev?.goal || "Helper agent",
      status: statusOf(r.status, false),
      model: str(r.model) || prev?.model,
      startedAt: toMs(r.started_at) ?? prev?.startedAt ?? now,
      toolCount: num(r.tool_count) ?? prev?.toolCount,
      activity: prev?.activity ?? (lastTool || undefined),
    }
    if (i >= 0) list[i] = next
    else list.push(next)
  }

  const failure = (f: Payload): Partial<Subagent> => ({
    status: statusOf(f.status, true),
    endedAt: toMs(f.completed_at) ?? now,
    summary: str(f.error) ? oneLine(f.error, 500) : undefined,
    activity: undefined,
  })

  // Gone from the live roster: finished. Hermes only remembers how when it failed.
  if (current === before) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      if (!isActive(a) || seen.has(a.id)) continue
      const f = failed.find((x) => str(x.goal) === a.goal)
      list[i] = { ...a, ...(f ? failure(f) : { status: "completed", endedAt: now, activity: undefined }) }
    }
  }

  // Failures from before a reload, which no event told us about.
  for (const f of failed) {
    const goal = str(f.goal)
    const id = idOf({ delegation_id: f.delegation_id, task_index: f.task_index, goal })
    if (list.some((a) => a.id === id || (!isActive(a) && a.goal === goal))) continue
    const rest = failure(f)
    list.push({ id, goal: goal || "Helper agent", startedAt: toMs(f.dispatched_at) ?? rest.endedAt!, ...rest } as Subagent)
  }
  list.sort((a, b) => a.startedAt - b.startedAt)
  save(threadId, list)
}
