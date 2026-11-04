import { toast } from "sonner"
import { Gateway, type GatewayEvent, type ServerRequest } from "./gateway"
import type { Attachment, Id, Message, PendingQuestion, Routine, Run, Thread, ToolCall } from "./model"
import { store, type Backend } from "./store"
import { humanSchedule } from "./schedule"
import { applySpeakers, castOf, forgetSessions, noteSession, prepareTurn, readLibrary, speakerFor, threadCast } from "./personalities"
import { claimCreatedSkills, noteToolStart } from "./skills"
import { setFileAccess } from "./server-files"
import { splitUserText } from "./user-text"

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

// ---- local memory: which runs have become threads ----------------------------

type RunThread = { routineId: Id; profile: string; title: string; updatedAt: number; done?: boolean }
const RUN_THREADS = "runThreads"
function runThreads(): Record<Id, RunThread> {
  try {
    return JSON.parse(localStorage.getItem(RUN_THREADS) ?? "{}")
  } catch {
    return {}
  }
}
function rememberRunThread(id: Id, value: RunThread) {
  try {
    localStorage.setItem(RUN_THREADS, JSON.stringify({ ...runThreads(), [id]: value }))
  } catch {}
}

const profile = () => store.get().projectId ?? "default"
const api = <T>(path: string) => window.hermes.api.get<T>(path)
const q = encodeURIComponent

// ---- helpers ------------------------------------------------------------------

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
        turn = { id: `a-${r.row_id ?? out.length}`, role: "assistant", text: "", tools: [], createdAt: ts, startedAt: lastUserAt ?? ts }
        out.push(turn)
      }
      turn.endedAt = ts
      if (r.role === "assistant") {
        if (text) turn.text = turn.text ? `${turn.text}\n\n${text}` : text
        if (r.reasoning) turn.reasoning = turn.reasoning ? `${turn.reasoning}\n\n${r.reasoning}` : r.reasoning
      } else {
        turn.tools!.push({
          id: r.tool_call_id ?? `t-${turn.tools!.length}`,
          name: r.name ?? "tool",
          summary: r.labels?.[0]?.text ?? r.context ?? undefined,
          status: "done",
        })
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

async function blobToBase64(url: string): Promise<string> {
  const buf = await (await fetch(url)).arrayBuffer()
  let bin = ""
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

// ---- lists ----------------------------------------------------------------------

const toThread = (p: string, s: any): Thread => ({
  id: s.id,
  projectId: p,
  title: s.title || (s.preview ? String(s.preview).slice(0, 80) : "Untitled"),
  updatedAt: (s.last_active ?? s.started_at ?? 0) * 1000,
  cast: threadCast(s.id),
  status: "idle",
  preview: s.preview,
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
    defaultModel: r.model ? { model: r.model, provider: r.provider, fast: fast.value === "fast" } : null,
    defaultEffort: effort.value && effort.value !== "none" ? effort.value : "medium",
    draftModel: null,
  })
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
async function applyModel(runtimeId: string, choice: { model: string; provider: string; effort?: string; fast?: boolean }) {
  const value = `${choice.model} --provider ${choice.provider} --session`
  let r = await gw.call<any>("config.set", { session_id: runtimeId, key: "model", value })
  if (r?.confirm_required) {
    if (!window.confirm(r.confirm_message || `Switch to ${choice.model}? It costs more.`)) return false
    r = await gw.call<any>("config.set", { session_id: runtimeId, key: "model", value, confirm_expensive_model: true })
  }
  if (r?.warning) toast.warning(r.warning)
  if (r?.deferred) toast(`${choice.model} will be used from the next message`)
  if (choice.effort) {
    await gw.call("config.set", { session_id: runtimeId, key: "reasoning", value: choice.effort, scope: "session" })
  }
  if (choice.fast !== undefined) {
    await gw.call("config.set", { session_id: runtimeId, key: "fast", value: choice.fast ? "fast" : "normal" })
  }
  return true
}

/** Done threads are Hermes's archived sessions. */
async function loadDone(p: string) {
  const res = await api<{ sessions: any[]; total?: number }>(
    `/api/sessions?profile=${q(p)}&archived=only&order=recent&limit=100&min_messages=1`,
  )
  const runs = runThreads()
  // Archived routine runs only count if someone turned them into a thread.
  const rows = res.sessions.filter((s) => s.source !== "cron" || runs[s.id])
  const cronRows = res.sessions.length - rows.length
  store.set({
    done: rows.map((s) => toThread(p, s)),
    doneCount: Math.max(rows.length, (res.total ?? rows.length) - cronRows),
  })
}

async function loadThreads(p: string) {
  const res = await api<{ sessions: any[] }>(
    `/api/sessions?profile=${q(p)}&exclude_sources=cron&order=recent&limit=100&min_messages=1`,
  )
  const fromRuns = Object.entries(runThreads()).filter(([, v]) => v.profile === p && !v.done)
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
        preview: s.preview,
      }),
    ),
    ...fromRuns.map(
      ([id, v]): Thread => ({
        id,
        projectId: p,
        title: v.title,
        updatedAt: v.updatedAt,
        cast: threadCast(id),
        status: "idle",
        fromRun: { routineId: v.routineId, runId: id },
      }),
    ),
  ]
  store.set((s) => ({
    // Keep live status for threads we're already tracking.
    threads: [
      ...s.threads.filter((t) => t.projectId !== p),
      ...threads.map((t) => {
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
    if (what === "threads") void loadThreads(profile()).catch(() => {})
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
      }))
      break
    case "reasoning.delta":
    case "thinking.delta":
      if (p.text) lastAssistant(threadId, (m) => ({ ...m, reasoning: (m.reasoning ?? "") + p.text }))
      break
    case "tool.start":
      noteToolStart(threadId, p.name, p.args)
      lastAssistant(threadId, (m) => ({
        ...m,
        tools: [
          ...(m.tools ?? []),
          { id: p.tool_id ?? String(Date.now()), name: p.name ?? "tool", summary: p.preview ?? undefined, status: "running" } as ToolCall,
        ],
      }))
      break
    case "tool.complete":
      lastAssistant(threadId, (m) => ({
        ...m,
        tools: (m.tools ?? []).map((t) =>
          t.id === p.tool_id ? { ...t, status: "done", summary: p.summary ?? t.summary } : t,
        ),
      }))
      break
    case "message.complete":
      lastAssistant(threadId, (m) => ({
        ...m,
        streaming: false,
        endedAt: Date.now(),
        text: m.text.trim() ? m.text.trim() : (p.text ?? ""),
        reasoning: m.reasoning ?? p.reasoning ?? undefined,
      }))
      if (p.status === "error" && p.error) toast.error(String(p.error))
      patchThread(threadId, { status: "idle", updatedAt: Date.now() })
      if (!document.hasFocus()) window.hermes.dock.bounce()
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
  if (!document.hasFocus()) window.hermes.dock.bounce()
}

// ---- sessions --------------------------------------------------------------------

async function ensureRuntime(threadId: Id): Promise<string> {
  const known = runtimeOf.get(threadId)
  if (known) return known
  const p = runThreads()[threadId]?.profile ?? store.get().threads.find((t) => t.id === threadId)?.projectId ?? profile()
  const r = await gw.call<any>("session.resume", { session_id: threadId, profile: p })
  runtimeOf.set(threadId, r.session_id)
  storedOf.set(r.session_id, threadId)
  rememberModel(threadId, r.info)
  noteSession(r.session_id, r.info)

  const messages = applySpeakers(threadId, mapTranscript(r.messages ?? []))
  if (r.running && r.inflight?.assistant) {
    messages.push({ id: "inflight", role: "assistant", text: r.inflight.assistant, createdAt: Date.now(), streaming: true })
  }
  store.updateDetail(threadId, (d) => ({ ...d, messages, loading: false }))
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
gw.onClose = (reason) => {
  // Live session ids die with the socket; resume again after reconnecting.
  runtimeOf.clear()
  storedOf.clear()
  openRequests.clear()
  forgetSessions()
  store.set({ connection: { state: "error", message: `Disconnected: ${reason}` }, details: {} })
  scheduleReconnect()
}

let connecting: Promise<void> | null = null

async function connectOnce() {
  clearTimeout(reconnectTimer)
  gw.close()
  store.set({ connection: { state: "connecting" } })
  const r = await window.hermes.connection.open()
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
  let saved: string | null = null
  try {
    saved = localStorage.getItem("projectId")
  } catch {}
  const pick = projects.find((p) => p.id === saved)?.id ?? projects.find((p) => p.id === "default")?.id ?? projects[0]?.id
  if (pick) await backend.selectProject(pick)
}

/** Re-reads the library and each project's cast (they can change from another Mac). */
async function refreshPersonalities() {
  const { profiles } = await gw.call<{ profiles: any[] }>("profiles.list", { include_sessions: false })
  store.set((s) => ({
    personalities: readLibrary(profiles),
    projects: s.projects.map((pr) => {
      const row = profiles.find((p) => p.name === pr.id)
      return row ? { ...pr, personalityIds: castOf(row) } : pr
    }),
  }))
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
      localStorage.setItem("projectId", id)
    } catch {}
    const changed = store.get().projectId !== id
    store.set({ projectId: id })
    if (changed) store.go({ kind: "thread", threadId: null })
    await Promise.all([
      loadThreads(id).catch((e) => toast.error(`Threads: ${e.message ?? e}`)),
      loadDone(id).catch(() => {}),
      loadModels(id).catch(() => {}),
      loadRoutines().catch((e) => toast.error(`Routines: ${e.message ?? e}`)),
      changed ? refreshPersonalities().catch(() => {}) : undefined,
    ])
  },

  async loadThread(threadId) {
    store.updateDetail(threadId, (d) => ({ ...d, loading: true }))
    try {
      runtimeOf.delete(threadId)
      await ensureRuntime(threadId)
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
      const draft = store.get().draftModel
      if (draft) {
        await applyModel(runtimeId, draft).catch((e) => toast.error(`Model: ${e.message ?? e}`))
        rememberModel(id, { model: draft.model, provider: draft.provider, reasoning_effort: draft.effort, fast: draft.fast })
      }
      const title = text.split("\n")[0].slice(0, 80) || attachments[0]?.name || "New thread"
      store.set((s) => ({
        threads: [
          { id: id!, projectId: profile(), title, updatedAt: Date.now(), cast: [], status: "working" },
          ...s.threads,
        ],
      }))
      store.updateDetail(id, (d) => ({ ...d, loading: false }))
    } else {
      runtimeId = await ensureRuntime(id)
    }
    const threadIdFinal = id

    // A clarify question without fixed choices is answered by the next message.
    const openClarify = store.get().details[threadIdFinal]?.pending.find((x) => x.kind === "clarify" && !x.choices?.length)
    if (openClarify && text) {
      await backend.answer(threadIdFinal, openClarify, text)
      return threadIdFinal
    }

    store.updateDetail(threadIdFinal, (d) => ({
      ...d,
      messages: [...d.messages, { id: `u-${Date.now()}`, role: "user", text, attachments, createdAt: Date.now() }],
    }))
    patchThread(threadIdFinal, { status: "working", updatedAt: Date.now() })
    const run = runThreads()[threadIdFinal]
    if (run) rememberRunThread(threadIdFinal, { ...run, updatedAt: Date.now() })

    try {
      // Who answers: the @mentioned personality, else the thread's host.
      const projectId = run?.profile ?? store.get().threads.find((t) => t.id === threadIdFinal)?.projectId ?? profile()
      const cast = await prepareTurn(threadIdFinal, runtimeId, projectId, text)
      patchThread(threadIdFinal, { cast })
      await attach(runtimeId, attachments)
      await gw.call("prompt.submit", { session_id: runtimeId, text })
    } catch (e) {
      patchThread(threadIdFinal, { status: "idle" })
      throw e
    }
    return threadIdFinal
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
    const known = runThreads()
    const prev = store.get().runs[routineId] ?? []
    const runs: Run[] = res.runs.map((s) => ({
      id: s.id,
      routineId,
      startedAt: (s.started_at ?? 0) * 1000,
      status: s.is_active ? "running" : "ok",
      report: prev.find((r) => r.id === s.id)?.report ?? (s.message_count ? undefined : ""),
      threadId: known[s.id] ? s.id : undefined,
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
    rememberRunThread(runId, { routineId, profile: p, title, updatedAt: Date.now() })
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
    const p = thread?.projectId ?? runThreads()[threadId]?.profile ?? profile()

    // Optimistic: move it between the lists right away.
    store.set((s) => {
      const moving = thread ?? s.threads.find((t) => t.id === threadId)
      if (!moving) return {}
      const others = s.threads.filter((t) => t.projectId === p && t.id !== threadId).sort((a, b) => b.updatedAt - a.updatedAt)
      const leavingOpen = done && s.view.kind === "thread" && s.view.threadId === threadId
      return {
        threads: done ? s.threads.filter((t) => t.id !== threadId) : [{ ...moving, status: "idle" }, ...s.threads],
        done: done ? [{ ...moving, status: "idle" }, ...s.done] : s.done.filter((t) => t.id !== threadId),
        doneCount: Math.max(0, s.doneCount + (done ? 1 : -1)),
        // Marking the open thread done moves on to the next one.
        view: leavingOpen ? { kind: "thread", threadId: others[0]?.id ?? null } : s.view,
      }
    })
    const run = runThreads()[threadId]
    if (run) rememberRunThread(threadId, { ...run, done })
    if (done) recentlyDone.push({ threadId, wasOpen: st.view.kind === "thread" && st.view.threadId === threadId })
    else {
      forgetDone(threadId)
      toast.dismiss(doneToastId(threadId))
    }

    try {
      await gw.call("session.archive", { session_id: threadId, archived: done, profile: p })
    } catch (e) {
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
