import { http, platform, toast } from "./platform"
import { Gateway, type GatewayEvent, type ServerRequest } from "./gateway"
import type { Attachment, Id, Message, PendingQuestion, Routine, Run, Thread, ToolCall } from "./model"
import { store, type Backend } from "./store"
import { humanSchedule } from "./schedule"
import { applySpeakers, castOf, forgetSessions, noteSession, prepareTurn, readLibrary, speakerFor, threadCast } from "./personalities"
import { claimCreatedSkills, noteToolStart } from "./skills"
import { setFileAccess } from "./server-files"
import { previewText, splitUserText } from "./user-text"
import { syncKitabContext } from "./kitab-context"
import { migrateLocal, readThreadMeta, runOrigin, runThreads, saveThreadMeta, threadMeta } from "./thread-meta"
import { onSubagentEvent, reconcileSubagents } from "./subagents"
import { readMyModel, resolveDefault, usableMyModel, writeMyModel } from "./default-model"
import { addReasoning, addText, addTool, breakText, partsOf, updateTool } from "./turn"

// Hermes adapter. Translates Hermes into the app's vocabulary:
//   profile            → Project
//   non-cron session   → Thread   (thread id = stored session id)
//   cron job           → Routine
//   cron job's session → Run      (replying to one makes it a Thread)
// Live session calls use the runtime id the gateway hands out on create/resume.

export const gw = new Gateway()

const runtimeOf = new Map<Id, string>() // stored id → runtime id
const storedOf = new Map<string, Id>() // runtime id → stored id
const openRequests = new Map<string, { threadId: Id; req: ServerRequest }>()
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let attempt = 0

const profile = () => store.get().projectId ?? "default"
const api = <T>(path: string) => http().get<T>(path)
const q = encodeURIComponent

// ---- helpers ------------------------------------------------------------------

/** `t` at the top of `list`, replacing any copy already there. A thread listed twice breaks the sidebar. */
function withFirst(list: Thread[], t: Thread): Thread[] {
  return [t, ...list.filter((x) => x.id !== t.id)]
}

/** Threads being marked done (true) or restored (false) whose archive call hasn't landed yet. */
const settling = new Map<Id, boolean>()

function patchThread(id: Id, patch: Partial<Thread>) {
  store.set((s) => ({ threads: s.threads.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
}

function lastAssistant(threadId: Id, fn: (m: Message) => Message) {
  store.updateDetail(threadId, (d) => {
    const messages = [...d.messages]
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        messages[i] = fn(messages[i])
        return { ...d, messages }
      }
      if (messages[i].role === "user") break
    }
    // No assistant message for this turn yet: start one.
    messages.push(
      fn({ id: `a-${Date.now()}`, role: "assistant", text: "", createdAt: Date.now(), streaming: true, personalityId: speakerFor(threadId) }),
    )
    return { ...d, messages }
  })
}

/** Folds Hermes transcript rows into one assistant message per turn. */
function mapTranscript(rows: any[]): Message[] {
  const out: Message[] = []
  let turn: Message | null = null
  let lastUserAt: number | undefined
  for (const r of rows) {
    const ts = typeof r.timestamp === "number" ? r.timestamp * 1000 : Date.now()
    const text = typeof r.text === "string" ? r.text : typeof r.content === "string" ? r.content : ""
    if (r.role === "user") {
      turn = null
      lastUserAt = ts
      const shown = splitUserText(text)
      out.push({
        id: `u-${r.row_id ?? out.length}`,
        role: "user",
        text: shown.text,
        attachments: shown.attachments.length ? shown.attachments : undefined,
        createdAt: ts,
      })
    } else if (r.role === "assistant" || r.role === "tool") {
      if (!turn) {
        turn = { id: `a-${r.row_id ?? out.length}`, role: "assistant", text: "", tools: [], parts: [], createdAt: ts, startedAt: lastUserAt ?? ts }
        out.push(turn)
      }
      turn.endedAt = ts
      if (r.role === "assistant") {
        // A row's thinking comes before its text, and its tool calls (the tool rows) after.
        if (r.reasoning) {
          turn.reasoning = turn.reasoning ? `${turn.reasoning}\n\n${r.reasoning}` : r.reasoning
          turn.parts = addReasoning(turn.parts!, r.reasoning, "\n\n")
        }
        if (text) {
          turn.text = turn.text ? `${turn.text}\n\n${text}` : text
          turn.parts = addText(breakText(turn.parts!), text)
        }
      } else {
        const call: ToolCall = {
          id: r.tool_call_id ?? `t-${turn.tools!.length}`,
          name: r.name ?? "tool",
          summary: r.labels?.[0]?.text ?? r.context ?? undefined,
          status: "done",
        }
        turn.tools!.push(call)
        turn.parts = addTool(turn.parts!, call)
      }
    }
  }
  return out
}

function toRoutine(j: any): Routine {
  const projectId: string = j.profile ?? "default"
  const raw: string = j.name ?? j.id
  // Jobs are often named "[bot:<profile>] …". Inside that project the tag says nothing new.
  const tag = `[bot:${projectId}]`
  const name = raw.toLowerCase().startsWith(tag.toLowerCase()) ? raw.slice(tag.length).trim() || raw : raw
  return {
    id: j.id,
    projectId,
    name,
    schedule: humanSchedule(j.schedule?.expr ?? j.schedule_display ?? j.schedule?.display ?? ""),
    enabled: j.enabled !== false,
    lastRunAt: j.last_run_at ? Date.parse(j.last_run_at) : undefined,
    nextRunAt: j.next_run_at ? Date.parse(j.next_run_at) : undefined,
    // last_status is "ok", "delivery_queued", … on success; only error-ish values are failures.
    lastStatus: !j.last_status ? undefined : /error|fail|timeout|crash|killed/i.test(j.last_status) ? "failed" : "ok",
    lastError: j.last_error ?? undefined,
    failureStreak: typeof j.failure_streak === "number" ? j.failure_streak : undefined,
    running: j.state === "running" || j.latest_execution?.status === "running",
    runCount: typeof j.repeat?.completed === "number" ? j.repeat.completed : undefined,
    skills: Array.isArray(j.skills) ? j.skills : j.skill ? [j.skill] : undefined,
    script: j.script ?? undefined,
    model: j.model ?? undefined,
    createdAt: j.created_at ? Date.parse(j.created_at) : undefined,
  }
}

const blobToBase64 = (url: string) => platform().base64(url)

// ---- lists ----------------------------------------------------------------------

const toThread = (p: string, s: any): Thread => ({
  id: s.id,
  projectId: p,
  title: s.title || (s.preview ? String(s.preview).slice(0, 80) : "Untitled"),
  updatedAt: (s.last_active ?? s.started_at ?? 0) * 1000,
  cast: threadCast(s.id),
  status: "idle",
  preview: previewText(s.preview),
})

// ---- models ------------------------------------------------------------------------

async function loadModels(p: string) {
  const [r, effort, fast] = await Promise.all([
    gw.call<{ providers: any[]; model: string; provider: string }>("model.options", { profile: p }),
    gw.call<{ value?: string }>("config.get", { key: "reasoning", profile: p }).catch(() => ({ value: "" })),
    gw.call<{ value?: string }>("config.get", { key: "fast", profile: p }).catch(() => ({ value: "" })),
  ])
  store.set({
    models: r.providers
      .filter((x) => x.authenticated !== false && x.models?.length)
      .map((x) => {
        // Some providers list one model under two spellings (claude-fable-5.1 / -5-1): keep the first.
        const seen = new Set<string>()
        const models = (x.models as string[]).filter((m) => {
          const key = m.replace(/\./g, "-")
          return seen.has(key) ? false : (seen.add(key), true)
        })
        const caps = Object.fromEntries(
          models.map((m) => [m, { fast: Boolean(x.capabilities?.[m]?.fast), reasoning: x.capabilities?.[m]?.reasoning !== false }]),
        )
        return { slug: x.slug, name: x.name, models, caps }
      }),
    projectModel: r.model ? { model: r.model, provider: r.provider, fast: fast.value === "fast" } : null,
    projectEffort: effort.value && effort.value !== "none" ? effort.value : "medium",
    draftModel: null,
  })
  resolveDefault()
}

function rememberModel(threadId: Id, info: any) {
  if (!info?.model) return
  store.set((s) => ({
    threadModels: {
      ...s.threadModels,
      [threadId]: {
        model: info.model,
        provider: info.provider ?? "",
        effort: info.reasoning_effort || undefined,
        fast: typeof info.fast === "boolean" ? info.fast : undefined,
      },
    },
  }))
}

/** Applies a model (and effort) to a live session. Asks before switching to an expensive model. */
/** Switches a live session's model. `sameModel`: it already runs this model, so only effort and speed change. */
async function applyModel(
  runtimeId: string,
  choice: { model: string; provider: string; effort?: string; fast?: boolean },
  sameModel = false,
) {
  if (!sameModel) {
    const value = `${choice.model} --provider ${choice.provider} --session`
    let r = await gw.call<any>("config.set", { session_id: runtimeId, key: "model", value })
    if (r?.confirm_required) {
      if (!(await platform().confirm(r.confirm_message || `Switch to ${choice.model}? It costs more.`))) return false
      r = await gw.call<any>("config.set", { session_id: runtimeId, key: "model", value, confirm_expensive_model: true })
    }
    if (r?.warning) toast.warning(r.warning)
    if (r?.deferred) toast(`${choice.model} will be used from the next message`)
  }
  if (choice.effort) {
    await gw.call("config.set", { session_id: runtimeId, key: "reasoning", value: choice.effort, scope: "session" })
  }
  if (choice.fast !== undefined) {
    await gw.call("config.set", { session_id: runtimeId, key: "fast", value: choice.fast ? "fast" : "normal" })
  }
  return true
}

/** Hermes stores threads started from Kitab (Mac or iPhone) as source "desktop". Sessions from
 *  scripts, the CLI or chat platforms aren't threads, so the lists leave them out. */
const THREAD_SOURCE = "desktop"

/** Done threads are Hermes's archived sessions. */
async function loadDone(p: string) {
  const res = await api<{ sessions: any[]; total?: number }>(
    `/api/sessions?profile=${q(p)}&sources=${THREAD_SOURCE},cron&archived=only&order=recent&limit=100&min_messages=1`,
  )
  // Archived routine runs only count if someone turned them into a thread.
  const rows = res.sessions.filter((s) => (s.source !== "cron" || runOrigin(s.id)) && settling.get(s.id) !== false)
  const cronRows = res.sessions.length - rows.length
  store.set({
    done: rows.map((s) => toThread(p, s)),
    doneCount: Math.max(rows.length, (res.total ?? rows.length) - cronRows),
  })
}

async function loadThreads(p: string) {
  const res = await api<{ sessions: any[] }>(
    `/api/sessions?profile=${q(p)}&sources=${THREAD_SOURCE}&order=recent&limit=100&min_messages=1`,
  )
  void migrateLocal(p, res.sessions.map((s) => s.id))
  const fromRuns = runThreads(p).filter((r) => !r.run.done)
  const threads: Thread[] = [
    ...res.sessions.map(
      (s): Thread => ({
        id: s.id,
        projectId: p,
        title: s.title || (s.preview ? String(s.preview).slice(0, 80) : "Untitled"),
        updatedAt: (s.last_active ?? s.started_at ?? 0) * 1000,
        cast: threadCast(s.id),
        // `is_active` only means "recently active". Live events decide "working".
        status: "idle",
        preview: previewText(s.preview),
      }),
    ),
    ...fromRuns.map(
      ({ id, run }): Thread => ({
        id,
        projectId: p,
        title: run.title,
        updatedAt: run.updatedAt,
        cast: threadCast(id),
        status: "idle",
        fromRun: { routineId: run.routineId, runId: id },
      }),
    ),
  ]
  // A refresh that lands before an archive call does would bring a just-done thread back.
  const fresh = threads.filter((t, i) => settling.get(t.id) !== true && threads.findIndex((x) => x.id === t.id) === i)
  store.set((s) => ({
    // Keep live status for threads we're already tracking.
    threads: [
      ...s.threads.filter((t) => t.projectId !== p && !fresh.some((f) => f.id === t.id)),
      ...fresh.map((t) => {
        const known = s.threads.find((k) => k.id === t.id)
        return known && known.status !== "idle" ? { ...t, status: known.status } : t
      }),
    ],
  }))
}

async function loadRoutines() {
  const res = await api<any[] | { jobs: any[] }>(`/api/cron/jobs?profile=all`)
  const jobs = Array.isArray(res) ? res : res.jobs
  store.set({ routines: jobs.map(toRoutine) })
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined
function refreshSoon(what: "threads" | "routines") {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    // Another device may have changed a thread's cast or turned a run into a thread.
    if (what === "threads") void refreshProfiles().then(() => loadThreads(profile())).catch(() => {})
    else void loadRoutines().catch(() => {})
  }, 400)
}

// ---- live events ------------------------------------------------------------------

function onEvent(e: GatewayEvent) {
  if (e.type === "sessions.changed") return refreshSoon("threads")
  if (e.type === "cron.changed") return refreshSoon("routines")
  if (e.type === "error" && !e.session_id) return void toast.error(e.payload?.message ?? "Hermes error")

  const threadId = e.session_id ? storedOf.get(e.session_id) : undefined
  if (!threadId) return
  const p = e.payload ?? {}
  if (e.type.startsWith("subagent.")) return onSubagentEvent(threadId, e.type, p)

  switch (e.type) {
    case "message.start":
      patchThread(threadId, { status: "working" })
      store.updateDetail(threadId, (d) => ({
        ...d,
        messages: [
          ...d.messages,
          {
            id: `live-${e.seq ?? Date.now()}`,
            role: "assistant",
            text: "",
            tools: [],
            parts: [],
            createdAt: Date.now(),
            startedAt: Date.now(),
            streaming: true,
            personalityId: speakerFor(threadId),
          },
        ],
      }))
      break
    case "message.delta":
      lastAssistant(threadId, (m) => ({
        ...m,
        text: p.text == null ? (m.text && !m.text.endsWith("\n\n") ? m.text + "\n\n" : m.text) : m.text + p.text,
        parts: p.text == null ? breakText(partsOf(m)) : addText(partsOf(m), p.text),
      }))
      break
    case "reasoning.delta":
    case "thinking.delta":
      if (p.text) lastAssistant(threadId, (m) => ({ ...m, reasoning: (m.reasoning ?? "") + p.text, parts: addReasoning(partsOf(m), p.text) }))
      break
    case "tool.start":
      noteToolStart(threadId, p.name, p.args)
      lastAssistant(threadId, (m) => {
        const call: ToolCall = { id: p.tool_id ?? String(Date.now()), name: p.name ?? "tool", summary: p.preview ?? undefined, status: "running" }
        return { ...m, tools: [...(m.tools ?? []), call], parts: addTool(partsOf(m), call) }
      })
      break
    case "tool.complete":
      lastAssistant(threadId, (m) => ({
        ...m,
        tools: (m.tools ?? []).map((t) =>
          t.id === p.tool_id ? { ...t, status: "done", summary: p.summary ?? t.summary } : t,
        ),
        parts: updateTool(partsOf(m), p.tool_id, (t) => ({ ...t, status: "done", summary: p.summary ?? t.summary })),
      }))
      break
    case "message.complete":
      lastAssistant(threadId, (m) => {
        // Text or thinking that only came with the end (nothing streamed) still belongs in the parts.
        let parts = partsOf(m)
        if (!m.text.trim() && p.text) parts = addText(parts, p.text)
        if (!m.reasoning && p.reasoning) parts = [{ type: "work", reasoning: p.reasoning, tools: [] }, ...parts]
        return {
          ...m,
          streaming: false,
          endedAt: Date.now(),
          text: m.text.trim() ? m.text.trim() : (p.text ?? ""),
          reasoning: m.reasoning ?? p.reasoning ?? undefined,
          parts,
        }
      })
      if (p.status === "error" && p.error) toast.error(String(p.error))
      patchThread(threadId, { status: "idle", updatedAt: Date.now() })
      platform().attention()
      void claimCreatedSkills(
        threadId,
        store.get().threads.find((t) => t.id === threadId)?.projectId ?? profile(),
        speakerFor(threadId),
      )
      break
    case "session.info":
      rememberModel(threadId, p)
      break
    case "session.title":
      if (p.title) patchThread(threadId, { title: p.title })
      break
    case "approval.cancelled":
    case "request.cancel": {
      const id = p.id ?? p.request_id
      for (const [rid, v] of openRequests) {
        if (rid === id || v.req.params?.request_id === id) {
          openRequests.delete(rid)
          removePending(v.threadId, rid)
        }
      }
      break
    }
  }
}

function removePending(threadId: Id, id: string) {
  store.updateDetail(threadId, (d) => ({ ...d, pending: d.pending.filter((x) => x.id !== id) }))
  const anyLeft = (store.get().details[threadId]?.pending.length ?? 0) > 0
  patchThread(threadId, { status: anyLeft ? "needs-you" : "working" })
}

function onRequest(req: ServerRequest) {
  const threadId = req.params?.session_id ? storedOf.get(req.params.session_id) : undefined
  if (!threadId || (req.method !== "approval" && req.method !== "clarify")) {
    gw.respondError(req.id, -32601, `${req.method} isn't supported by this app yet`)
    return
  }
  showRequest(threadId, req)
}

function showRequest(threadId: Id, req: ServerRequest) {
  openRequests.set(req.id, { threadId, req })
  let question: PendingQuestion
  if (req.method === "approval") {
    question = {
      id: req.id,
      kind: "approval",
      title: req.params.description || "Hermes wants to run a command",
      detail: req.params.command ?? undefined,
      choices: req.params.choices?.length ? req.params.choices : ["once", "deny"],
    }
  } else {
    const first = req.params.questions?.[0] ?? {}
    question = {
      id: req.id,
      kind: "clarify",
      title: first.question ?? "Hermes has a question",
      choices: first.choices ?? undefined,
    }
  }
  store.updateDetail(threadId, (d) => ({ ...d, pending: [...d.pending.filter((x) => x.id !== req.id), question] }))
  patchThread(threadId, { status: "needs-you" })
  platform().attention()
}

// ---- sessions --------------------------------------------------------------------

const resuming = new Map<Id, Promise<string>>()

/** Single-flight per thread: the view and a reconnect resuming the same thread share one session. */
function ensureRuntime(threadId: Id): Promise<string> {
  const known = runtimeOf.get(threadId)
  if (known) return Promise.resolve(known)
  let p = resuming.get(threadId)
  if (!p) {
    const flight: Promise<string> = resume(threadId).finally(() => {
      if (resuming.get(threadId) === flight) resuming.delete(threadId)
    })
    resuming.set(threadId, flight)
    p = flight
  }
  return p
}

async function resume(threadId: Id): Promise<string> {
  const p = runOrigin(threadId)?.projectId ?? store.get().threads.find((t) => t.id === threadId)?.projectId ?? profile()
  const r = await gw.call<any>("session.resume", { session_id: threadId, profile: p })
  runtimeOf.set(threadId, r.session_id)
  storedOf.set(r.session_id, threadId)
  rememberModel(threadId, r.info)
  noteSession(r.session_id, r.info)

  const messages = applySpeakers(threadId, mapTranscript(r.messages ?? []))
  if (r.running && r.inflight?.assistant) {
    messages.push({ id: "inflight", role: "assistant", text: r.inflight.assistant, createdAt: Date.now(), streaming: true })
  }
  store.updateDetail(threadId, (d) => ({ ...d, messages, loading: false, stale: false }))
  if (r.running) patchThread(threadId, { status: "working" })
  for (const req of r.open_requests ?? []) showRequest(threadId, req)
  return r.session_id
}

async function attach(runtimeId: string, attachments: Attachment[]) {
  for (const a of attachments) {
    if (!a.url) continue
    if (a.kind === "image") {
      await gw.call("image.attach_bytes", { session_id: runtimeId, content_base64: await blobToBase64(a.url), filename: a.name })
    } else if (a.name.toLowerCase().endsWith(".pdf")) {
      await gw.call("pdf.attach", { session_id: runtimeId, content_base64: await blobToBase64(a.url), filename: a.name })
    } else {
      toast.warning(`${a.name}: only images and PDFs can be sent for now`)
    }
  }
}

// ---- connection ------------------------------------------------------------------

function scheduleReconnect() {
  clearTimeout(reconnectTimer)
  const delay = Math.min(30_000, 1000 * 2 ** attempt++)
  reconnectTimer = setTimeout(() => void backend.connect(), delay)
}

gw.onEvent = onEvent
gw.onRequest = onRequest
/** Threads that were working or waiting when the socket dropped, to reattach after reconnecting. */
const liveBeforeDrop = new Set<Id>()

gw.onClose = (reason) => {
  // Live session ids die with the socket; resume again after reconnecting.
  runtimeOf.clear()
  storedOf.clear()
  resuming.clear()
  openRequests.clear()
  forgetSessions()
  for (const t of store.get().threads) if (t.status !== "idle") liveBeforeDrop.add(t.id)
  store.set((s) => {
    return {
      connection: { state: "error", message: `Disconnected: ${reason}` },
      // No live events reach us now, so nothing would ever clear "working".
      threads: s.threads.map((t) => (t.status === "idle" ? t : { ...t, status: "idle" })),
      // Keep what's on screen; resuming replaces it. Open questions died with the socket.
      details: Object.fromEntries(
        Object.entries(s.details).map(([id, d]) => [id, { ...d, pending: [], loading: false, stale: true }]),
      ),
    }
  })
  scheduleReconnect()
}

/** Reattaches threads that were running before a drop, so their status and replies come back. */
function resumeLive() {
  const open = store.get().view
  for (const id of [...liveBeforeDrop]) {
    liveBeforeDrop.delete(id)
    // The open thread is reloaded by its view.
    if (open.kind === "thread" && open.threadId === id) continue
    void ensureRuntime(id).catch(() => {})
  }
}

let connecting: Promise<void> | null = null

async function connectOnce() {
  clearTimeout(reconnectTimer)
  gw.close()
  store.set({ connection: { state: "connecting" } })
  const r = await platform().connect()
  if (!r.ok) {
    console.warn("[connection]", r.message)
    store.set({ connection: { state: "error", message: r.message, needsSignIn: r.needsSignIn } })
    if (!r.needsSignIn) scheduleReconnect()
    return
  }
  try {
    console.log("[gateway] opening socket")
    await gw.open(r.wsUrl)
    console.log("[gateway] ready")
  } catch (e) {
    console.warn("[gateway]", e)
    store.set({ connection: { state: "error", message: e instanceof Error ? e.message : String(e) } })
    scheduleReconnect()
    return
  }
  attempt = 0
  setFileAccess(r.files)
  store.set({ connection: { state: "connected", server: r.label, version: r.version } })

  const { profiles } = await gw.call<{ profiles: any[] }>("profiles.list", {})
  const projects = profiles.map((p) => ({
    id: p.name as string,
    name: (p.display_name as string) || (p.name === "default" ? "Default" : (p.name as string)),
    personalityIds: castOf(p),
  }))
  store.set({ projects, personalities: readLibrary(profiles) })
  readThreadMeta(profiles)
  readMyModel(profiles)
  void migrateLocal()
  // Tells Hermes it's talking through Kitab, in every project (see kitab-context.ts).
  void syncKitabContext(profiles).catch((e) => console.warn("[kitab-context]", e))
  let saved: string | null = null
  try {
    saved = platform().storage.get("projectId")
  } catch {}
  const pick = projects.find((p) => p.id === saved)?.id ?? projects.find((p) => p.id === "default")?.id ?? projects[0]?.id
  if (pick) await backend.selectProject(pick)
  resumeLive()
}

/** Re-reads the library, each project's cast and thread details (they can change on another device). */
async function refreshProfiles() {
  const { profiles } = await gw.call<{ profiles: any[] }>("profiles.list", { include_sessions: false })
  readThreadMeta(profiles)
  readMyModel(profiles)
  store.set((s) => ({
    personalities: readLibrary(profiles),
    projects: s.projects.map((pr) => {
      const row = profiles.find((p) => p.name === pr.id)
      return row ? { ...pr, personalityIds: castOf(row) } : pr
    }),
  }))
}

/** The thread list's order as shown (sort and search applied), so marking the open
 *  thread done can move to its neighbour. Set by the UI; not state, nothing renders it. */
let shownOrder: Id[] = []
export function setShownThreadOrder(ids: Id[]) {
  shownOrder = ids
}

/** The thread to open after `threadId` leaves the list: the one above it as shown,
 *  else the one below, else the most recently active one left. */
function neighbourOf(threadId: Id, remaining: Thread[]): Id | null {
  const left = new Set(remaining.map((t) => t.id))
  const i = shownOrder.indexOf(threadId)
  if (i >= 0) {
    for (let j = i - 1; j >= 0; j--) if (left.has(shownOrder[j])) return shownOrder[j]
    for (let j = i + 1; j < shownOrder.length; j++) if (left.has(shownOrder[j])) return shownOrder[j]
  }
  return [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null
}

/** Threads marked done this session, newest last, for ⌘Z. */
const recentlyDone: { threadId: Id; wasOpen: boolean }[] = []
const doneToastId = (threadId: Id) => `done:${threadId}`
function forgetDone(threadId: Id) {
  const i = recentlyDone.findIndex((d) => d.threadId === threadId)
  if (i >= 0) recentlyDone.splice(i, 1)
}

/** Restores a thread marked done, reopening it if it was open at the time. */
async function undoDone(threadId: Id) {
  const entry = recentlyDone.find((d) => d.threadId === threadId)
  // Already restored some other way: nothing to undo.
  if (!store.get().done.some((t) => t.id === threadId)) return forgetDone(threadId)
  await backend.setDone(threadId, false)
  if (entry?.wasOpen) store.go({ kind: "thread", threadId })
}

/** ⌘Z: restores the most recently marked-done thread. False when there is none. */
export function undoLastDone(): boolean {
  const last = recentlyDone.at(-1)
  if (!last) return false
  void undoDone(last.threadId)
  return true
}

export function hasUndoableDone(): boolean {
  return recentlyDone.length > 0
}

/** Typing anything makes ⌘Z about the text again. */
export function clearUndoableDone() {
  recentlyDone.length = 0
}

export const backend: Backend = {
  // Single-flight: overlapping calls (StrictMode, menu, reconnect) share one attempt.
  connect() {
    connecting ??= connectOnce().finally(() => (connecting = null))
    return connecting
  },
  async selectProject(id) {
    try {
      platform().storage.set("projectId", id)
    } catch {}
    const changed = store.get().projectId !== id
    store.set({ projectId: id })
    if (changed) store.go({ kind: "thread", threadId: null })
    await Promise.all([
      loadThreads(id).catch((e) => toast.error(`Threads: ${e.message ?? e}`)),
      loadDone(id).catch(() => {}),
      loadModels(id).catch(() => {}),
      loadRoutines().catch((e) => toast.error(`Routines: ${e.message ?? e}`)),
      changed ? refreshProfiles().catch(() => {}) : undefined,
    ])
  },

  async loadThread(threadId) {
    // Clearing stale first keeps a view that reloads stale details from asking twice.
    store.updateDetail(threadId, (d) => ({ ...d, loading: true, stale: false }))
    try {
      if (!resuming.has(threadId)) runtimeOf.delete(threadId)
      await ensureRuntime(threadId)
      void backend.loadSubagents(threadId)
    } catch (e) {
      store.updateDetail(threadId, (d) => ({ ...d, loading: false }))
      toast.error(e instanceof Error ? e.message : String(e))
    }
  },

  async send(threadId, text, attachments) {
    let id = threadId
    let runtimeId: string
    if (!id) {
      const r = await gw.call<any>("session.create", { profile: profile() })
      id = r.stored_session_id as string
      runtimeId = r.session_id
      runtimeOf.set(id, runtimeId)
      storedOf.set(runtimeId, id)
      rememberModel(id, r.info)
      noteSession(runtimeId, r.info)
      // The composer's pick for this thread, else your default from Settings.
      const pick = store.get().draftModel ?? usableMyModel()
      if (pick) {
        const started = store.get().threadModels[id]
        const same = started?.model === pick.model && started?.provider === pick.provider
        const applied = await applyModel(runtimeId, pick, same).catch((e) => {
          toast.error(`Model: ${e.message ?? e}`)
          return false
        })
        if (applied) rememberModel(id, { model: pick.model, provider: pick.provider, reasoning_effort: pick.effort, fast: pick.fast })
      }
      const title = text.split("\n")[0].slice(0, 80) || attachments[0]?.name || "New thread"
      store.set((s) => ({
        threads: withFirst(s.threads, { id: id!, projectId: profile(), title, updatedAt: Date.now(), cast: [], status: "working" }),
      }))
      store.updateDetail(id, (d) => ({ ...d, loading: false }))
    } else {
      runtimeId = await ensureRuntime(id)
    }
    const threadIdFinal = id

    // An open clarify question is answered by the next message (a custom answer when it has choices).
    const openClarify = store.get().details[threadIdFinal]?.pending.find((x) => x.kind === "clarify")
    if (openClarify && text) {
      await backend.answer(threadIdFinal, openClarify, text)
      return threadIdFinal
    }

    const optimisticId = `u-${Date.now()}`
    store.updateDetail(threadIdFinal, (d) => ({
      ...d,
      messages: [...d.messages, { id: optimisticId, role: "user", text, attachments, createdAt: Date.now() }],
    }))
    patchThread(threadIdFinal, { status: "working", updatedAt: Date.now() })
    try {
      // Who answers: the @mentioned personality, else the thread's host.
      const projectId =
        runOrigin(threadIdFinal)?.projectId ?? store.get().threads.find((t) => t.id === threadIdFinal)?.projectId ?? profile()
      const cast = await prepareTurn(threadIdFinal, runtimeId, projectId, text)
      patchThread(threadIdFinal, { cast })
      await attach(runtimeId, attachments)
      await gw.call("prompt.submit", { session_id: runtimeId, text })
    } catch (e) {
      patchThread(threadIdFinal, { status: "idle" })
      // The composer puts the text back; showing it in the thread too would look sent.
      store.updateDetail(threadIdFinal, (d) => ({ ...d, messages: d.messages.filter((m) => m.id !== optimisticId) }))
      throw e
    }
    return threadIdFinal
  },

  async setMyModel(choice) {
    try {
      await writeMyModel(gw, choice)
    } catch (e) {
      toast.error(`Couldn't save your default model: ${e instanceof Error ? e.message : e}`)
    }
  },

  async loadSubagents(threadId) {
    const runtimeId = runtimeOf.get(threadId)
    if (!runtimeId) return
    const before = store.get().subagents[threadId]
    try {
      const r = await gw.call<{ subagents?: any[]; delegations?: any[] }>("subagent.list", { session_id: runtimeId })
      // Answered for a session the thread has since moved off of.
      if (runtimeOf.get(threadId) !== runtimeId || !Array.isArray(r.subagents)) return
      reconcileSubagents(threadId, r.subagents, r.delegations ?? [], before)
    } catch (e) {
      // Older Hermes without the roster: live events still fill it in.
      console.warn("[subagents]", e)
    }
  },

  async stopSubagent(threadId, subagentId) {
    const runtimeId = runtimeOf.get(threadId)
    if (!runtimeId) return
    const r = await gw.call<{ found?: boolean }>("subagent.interrupt", { session_id: runtimeId, subagent_id: subagentId })
    if (!r.found) toast.error("Couldn’t stop that agent. It may have finished already.")
    void backend.loadSubagents(threadId)
  },

  async interrupt(threadId) {
    const runtimeId = runtimeOf.get(threadId)
    if (runtimeId) await gw.call("session.interrupt", { session_id: runtimeId })
  },

  async answer(threadId, question, value) {
    const open = openRequests.get(question.id)
    if (!open) return removePending(threadId, question.id)
    if (open.req.method === "approval") {
      gw.respond(question.id, { choice: value })
    } else {
      const qid = open.req.params.questions?.[0]?.qid ?? "0"
      gw.respond(question.id, { answers: { [qid]: value } })
    }
    openRequests.delete(question.id)
    removePending(threadId, question.id)
  },

  async loadRuns(routineId) {
    const routine = store.get().routines.find((r) => r.id === routineId)
    const p = routine?.projectId ?? profile()
    const res = await api<{ runs: any[] }>(`/api/cron/jobs/${q(routineId)}/runs?profile=${q(p)}&limit=50`)
    const prev = store.get().runs[routineId] ?? []
    const runs: Run[] = res.runs.map((s) => ({
      id: s.id,
      routineId,
      startedAt: (s.started_at ?? 0) * 1000,
      status: s.is_active ? "running" : "ok",
      report: prev.find((r) => r.id === s.id)?.report ?? (s.message_count ? undefined : ""),
      threadId: runOrigin(s.id) ? s.id : undefined,
    }))
    store.set((st) => ({ runs: { ...st.runs, [routineId]: runs } }))
  },

  async loadRunReport(routineId, runId) {
    const routine = store.get().routines.find((r) => r.id === routineId)
    const p = routine?.projectId ?? profile()
    const res = await api<{ messages: any[] }>(`/api/sessions/${q(runId)}/messages?profile=${q(p)}`)
    const said = res.messages
      .filter((m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim())
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
    const report = said.at(-1)?.content ?? ""
    store.set((st) => ({
      runs: { ...st.runs, [routineId]: (st.runs[routineId] ?? []).map((r) => (r.id === runId ? { ...r, report } : r)) },
    }))
  },

  async replyToRun(routineId, runId, text) {
    const routine = store.get().routines.find((r) => r.id === routineId)
    const p = routine?.projectId ?? profile()
    const run = store.get().runs[routineId]?.find((r) => r.id === runId)
    const title = `${routine?.name ?? "Routine"} · ${new Date(run?.startedAt ?? Date.now()).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`
    await saveThreadMeta(p, runId, { run: { routineId, title, updatedAt: Date.now() } })
    store.set((s) => ({
      threads: s.threads.some((t) => t.id === runId)
        ? s.threads
        : [{ id: runId, projectId: p, title, updatedAt: Date.now(), cast: [], status: "idle", fromRun: { routineId, runId } }, ...s.threads],
      runs: { ...s.runs, [routineId]: (s.runs[routineId] ?? []).map((r) => (r.id === runId ? { ...r, threadId: runId } : r)) },
    }))
    await backend.send(runId, text, [])
    return runId
  },

  async setDone(threadId, done) {
    const st = store.get()
    const thread = (done ? st.threads : st.done).find((t) => t.id === threadId)
    const p = thread?.projectId ?? runOrigin(threadId)?.projectId ?? profile()

    // Optimistic: move it between the lists right away.
    store.set((s) => {
      const moving = thread ?? s.threads.find((t) => t.id === threadId)
      if (!moving) return {}
      const others = s.threads.filter((t) => t.projectId === p && t.id !== threadId)
      const leavingOpen = done && s.view.kind === "thread" && s.view.threadId === threadId
      return {
        threads: done ? s.threads.filter((t) => t.id !== threadId) : withFirst(s.threads, { ...moving, status: "idle" }),
        done: done ? withFirst(s.done, { ...moving, status: "idle" }) : s.done.filter((t) => t.id !== threadId),
        doneCount: Math.max(0, s.doneCount + (done ? 1 : -1)),
        // Marking the open thread done moves to its neighbour in the list.
        view: leavingOpen ? { kind: "thread", threadId: neighbourOf(threadId, others) } : s.view,
      }
    })
    const run = threadMeta(threadId).run
    if (run) void saveThreadMeta(p, threadId, { run: { ...run, done: done || undefined } }).catch(() => {})
    if (done) recentlyDone.push({ threadId, wasOpen: st.view.kind === "thread" && st.view.threadId === threadId })
    else {
      forgetDone(threadId)
      toast.dismiss(doneToastId(threadId))
    }

    settling.set(threadId, done)
    try {
      await gw.call("session.archive", { session_id: threadId, archived: done, profile: p })
      if (settling.get(threadId) === done) settling.delete(threadId)
    } catch (e) {
      if (settling.get(threadId) === done) settling.delete(threadId)
      toast.error(`Couldn't ${done ? "mark as done" : "restore"}: ${e instanceof Error ? e.message : e}`)
      if (done) forgetDone(threadId)
      void loadThreads(p)
      void loadDone(p)
      return
    }
    if (done) {
      toast(`Marked “${thread?.title ?? "thread"}” as done`, {
        id: doneToastId(threadId),
        action: { label: "Undo", onClick: () => void undoDone(threadId) },
      })
    }
  },

  async setModel(threadId, choice) {
    if (!threadId) {
      store.set({ draftModel: choice })
      return
    }
    const runtimeId = await ensureRuntime(threadId)
    try {
      if (await applyModel(runtimeId, choice)) {
        rememberModel(threadId, { model: choice.model, provider: choice.provider, reasoning_effort: choice.effort, fast: choice.fast })
      }
    } catch (e) {
      toast.error(`Couldn't switch model: ${e instanceof Error ? e.message : e}`)
    }
  },
}
