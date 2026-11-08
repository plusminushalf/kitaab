import { http, platform, toast } from "./platform"
import { Gateway, type GatewayEvent, type ServerRequest } from "./gateway"
import type { Attachment, Id, Message, PendingQuestion, Routine, Run, Thread, ToolCall } from "./model"
import { store, type Backend, type ModelChoice, type SendMode } from "./store"
import { humanSchedule } from "./schedule"
import { applySpeakers, castOf, forgetSessions, noteSession, prepareTurn, readLibrary, speakerFor, threadCast } from "./personalities"
import { claimCreatedSkills, noteToolStart } from "./skills"
import { setFileAccess } from "./server-files"
import { previewText, splitUserText } from "./user-text"
import { syncKitabContext } from "./kitab-context"
import { migrateLocal, readThreadMeta, runOrigin, runThreads, saveThreadMeta, threadMeta } from "./thread-meta"
import { onSubagentEvent, reconcileSubagents } from "./subagents"
import { readMyModel, resolveDefault, usableMyModel, writeMyModel } from "./default-model"
import { inOrder, readProjectOrder, writeProjectOrder } from "./project-order"
import { addReasoning, addText, addTool, breakText, partsOf, updateTool } from "./turn"
import { enqueue, isPaused, putBack, readEnterSends, setPaused, take, writeEnterSends } from "./queue"
import { readCachedTranscript, writeCachedTranscript } from "./transcript-cache"

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
  // A reply that has ended has nothing left to stop.
  if (patch.status === "idle") patch = { ...patch, stopping: undefined }
  store.set((s) => ({ threads: s.threads.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
}

function lastAssistant(threadId: Id, fn: (m: Message) => Message) {
  store.updateDetail(threadId, (d) => {
    const messages = [...d.messages]
    // The reply still running gets the update, even when a message you sent since sits below it.
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && messages[i].streaming) {
        messages[i] = fn(messages[i])
        return { ...d, messages }
      }
    }
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

/** Hermes stores threads started from Kitaab (Mac or iPhone) as source "desktop". Sessions from
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
  for (const t of fresh) unlisted.delete(t.id)
  store.set((s) => ({
    // Keep live status for threads we're already tracking.
    threads: [
      ...s.threads.filter((t) => t.projectId !== p && !fresh.some((f) => f.id === t.id)),
      // Threads made here that the server doesn't list yet (it lists a thread once a message
      // is saved): dropping them would make a thread you just started blink out of the list.
      ...s.threads.filter((t) => t.projectId === p && (isLocalThread(t.id) || unlisted.has(t.id)) && !fresh.some((f) => f.id === t.id)),
      ...fresh.map((t) => {
        const known = s.threads.find((k) => k.id === t.id)
        return known && known.status !== "idle" ? { ...t, status: known.status, stopping: known.stopping } : t
      }),
    ],
  }))
}

async function loadRoutines() {
  const res = await api<any[] | { jobs: any[] }>(`/api/cron/jobs?profile=all`)
  const jobs = Array.isArray(res) ? res : res.jobs
  store.set({ routines: jobs.map(toRoutine) })
}

/** The thread last open in each project, so switching back reopens it. */
const lastThread = new Map<Id, Id>()

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
      // Nothing runs once a turn ends: a reply left marked running would show "Working…" forever.
      store.updateDetail(threadId, (d) =>
        d.messages.some((m) => m.streaming)
          ? { ...d, messages: d.messages.map((m) => (m.streaming ? { ...m, streaming: false, endedAt: m.endedAt ?? Date.now() } : m)) }
          : d,
      )
      if (p.status === "error" && p.error) toast.error(String(p.error))
      patchThread(threadId, { status: "idle", updatedAt: Date.now() })
      cacheSoon(threadId)
      sendNextQueued(threadId)
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

const ANSWERED = new Set(["approval", "clarify", "secret", "sudo"])

function onRequest(req: ServerRequest) {
  const threadId = req.params?.session_id ? storedOf.get(req.params.session_id) : undefined
  if (!threadId || !ANSWERED.has(req.method)) {
    gw.respondError(req.id, -32601, `${req.method} isn't supported by this app yet`)
    return
  }
  showRequest(threadId, req)
}

/**
 * A `secret` request: from Kitaab's request_secret tool (metadata.kitaab, see kitaab-plugin.ts)
 * or from Hermes itself, when a skill needs a key it saves in the project's .env.
 */
function secretQuestion(req: ServerRequest): PendingQuestion {
  const p = req.params ?? {}
  const m = p.metadata ?? {}
  const name = m.name || p.env_var
  if (m.kitaab) {
    const replacing = m.replaces ? ", replacing the current value" : ""
    const destination =
      m.destination === "env_file"
        ? `Goes into ${m.path} as ${name}${replacing}`
        : m.destination === "hermes"
          ? `Goes into Hermes's settings for this project (${m.path}) as ${name}${replacing}`
          : m.path
            ? `Saved to ${m.path}${m.replaces ? ", replacing it" : ""}`
            : "Kept in a private file on the server, for Hermes to use in a command"
    return { id: req.id, kind: "secret", title: m.label || p.prompt || "Hermes needs a secret", detail: m.reason || undefined, destination }
  }
  return {
    id: req.id,
    kind: "secret",
    title: p.prompt || `Hermes needs ${p.env_var}`,
    detail: m.help || (m.skill_name ? `The ${m.skill_name} skill needs it.` : undefined),
    destination: `Goes into Hermes's settings for this project as ${p.env_var}`,
  }
}

function showRequest(threadId: Id, req: ServerRequest) {
  openRequests.set(req.id, { threadId, req })
  let question: PendingQuestion
  if (req.method === "secret") {
    question = secretQuestion(req)
  } else if (req.method === "sudo") {
    question = {
      id: req.id,
      kind: "secret",
      title: "Hermes needs your sudo password",
      command: req.params.command || undefined,
      destination: "Used for this command only, not saved",
    }
  } else if (req.method === "approval") {
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

// ---- sending while a reply runs -------------------------------------------------

/** Threads being stopped so a message can go right away; their queue waits until it has. */
const stopping = new Set<Id>()

const statusOf = (threadId: Id) => store.get().threads.find((t) => t.id === threadId)?.status
const replying = (threadId: Id) => {
  const status = statusOf(threadId)
  return status === "working" || status === "needs-you"
}

/** Resolves true once the thread's reply has ended, or false after `ms`. */
function untilIdle(threadId: Id, ms: number): Promise<boolean> {
  if (!replying(threadId)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (ended: boolean) => {
      clearTimeout(timer)
      off()
      resolve(ended)
    }
    const off = store.subscribe(() => {
      if (!replying(threadId)) done(true)
    })
    const timer = setTimeout(() => done(false), ms)
  })
}

/** Sends the next queued message once the thread's reply has ended. */
function sendNextQueued(threadId: Id) {
  if (stopping.has(threadId) || replying(threadId) || isPaused(threadId)) return
  const next = take(threadId)
  if (!next) return
  backend.send(threadId, next.text, next.attachments).catch((e) => {
    putBack(threadId, next)
    toast.error(`Couldn't send your queued message: ${e instanceof Error ? e.message : e}`)
  })
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
  // What you sent that hasn't landed (or didn't) isn't in the transcript yet: keep it below.
  store.updateDetail(threadId, (d) => ({ ...d, messages: [...messages, ...d.messages.filter((m) => m.delivery)], loading: false, stale: false }))
  writeCachedTranscript(threadId, messages)
  if (r.running) patchThread(threadId, { status: "working" })
  for (const req of r.open_requests ?? []) showRequest(threadId, req)
  return r.session_id
}

/**
 * An image that's already on the server (a cited reply image): Hermes reads it from its path.
 * The path is quoted, the way Hermes's attach input takes one with spaces. If Hermes won't take
 * it that way, the bytes go up instead.
 */
async function attachServerImage(runtimeId: string, a: Attachment) {
  try {
    if (a.path!.includes('"')) throw new Error("unquotable path")
    await gw.call("image.attach", { session_id: runtimeId, path: `"${a.path}"` })
  } catch (e) {
    if (!a.url) throw e
    await gw.call("image.attach_bytes", { session_id: runtimeId, content_base64: await blobToBase64(a.url), filename: a.name })
  }
}

async function attach(runtimeId: string, attachments: Attachment[]) {
  // Images first, in order: the composer's `[Image #N]` tags count them, and a PDF's pages
  // are queued as images too, so one sent earlier would shift the count.
  const ordered = [...attachments.filter((a) => a.kind === "image"), ...attachments.filter((a) => a.kind !== "image")]
  for (const a of ordered) {
    if (a.kind === "image" && a.path && !/^(blob|data):/.test(a.url ?? "")) {
      await attachServerImage(runtimeId, a)
      continue
    }
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

// ---- opening threads --------------------------------------------------------------

/** How long Stop may take to land before the thread stops saying "Stopping…". */
const STOP_PATIENCE_MS = 20_000
const stopTimers = new Map<Id, ReturnType<typeof setTimeout>>()

/**
 * A thread with nothing loaded yet shows what this device last saw of it while the live
 * session loads. Marked stale, so the view still loads it (and replaces this).
 */
function showCached(threadId: Id) {
  if (store.get().details[threadId]?.messages.length || isLocalThread(threadId)) return
  const cached = readCachedTranscript(threadId)
  if (cached) store.updateDetail(threadId, (d) => ({ ...d, messages: cached, stale: !d.loading }))
}

// Opening a thread fills it from the cache in the same update, before the view draws, so it
// never flashes empty first. (The view then loads it for real.)
let shownView: unknown
store.subscribe(() => {
  const { view } = store.get()
  if (view === shownView) return
  shownView = view
  if (view.kind === "thread" && view.threadId) showCached(view.threadId)
})

const cacheTimers = new Map<Id, ReturnType<typeof setTimeout>>()
/** Saves a thread's transcript once a turn has ended (soon, not on every streamed word). */
function cacheSoon(threadId: Id) {
  clearTimeout(cacheTimers.get(threadId))
  cacheTimers.set(
    threadId,
    setTimeout(() => {
      cacheTimers.delete(threadId)
      const messages = store.get().details[threadId]?.messages
      if (messages) writeCachedTranscript(threadId, messages)
    }, 1000),
  )
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
  for (const t of store.get().threads) if (t.status !== "idle" && !isLocalThread(t.id)) liveBeforeDrop.add(t.id)
  store.set((s) => {
    return {
      connection: { state: "error", message: `Disconnected: ${reason}` },
      // No live events reach us now, so nothing would ever clear "working".
      threads: s.threads.map((t) => (t.status === "idle" ? t : { ...t, status: "idle", stopping: undefined })),
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
  readProjectOrder(profiles)
  const projects = inOrder(
    profiles.map((p) => ({
      id: p.name as string,
      name: (p.display_name as string) || (p.name === "default" ? "Default" : (p.name as string)),
      personalityIds: castOf(p),
    })),
  )
  store.set({ projects, personalities: readLibrary(profiles) })
  readThreadMeta(profiles)
  readMyModel(profiles)
  void migrateLocal()
  // Tells Hermes it's talking through Kitaab, in every project (see kitab-context.ts).
  void syncKitabContext(profiles).catch((e) => console.warn("[kitab-context]", e))
  let saved: string | null = null
  try {
    saved = platform().storage.get("projectId")
  } catch {}
  const pick = projects.find((p) => p.id === saved)?.id ?? projects.find((p) => p.id === "default")?.id ?? projects[0]?.id
  if (pick) await backend.selectProject(pick)
  resumeLive()
}

/** Hermes profile names: lowercase letters, digits, "-" and "_", starting with a letter or digit, at most 64. */
export function projectIdFor(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+/, "")
    .slice(0, 64)
    .replace(/-+$/, "")
}

/** Re-reads the library, each project's cast and thread details (they can change on another device). */
async function refreshProfiles() {
  const { profiles } = await gw.call<{ profiles: any[] }>("profiles.list", { include_sessions: false })
  readThreadMeta(profiles)
  readMyModel(profiles)
  // The order can change on another device too.
  readProjectOrder(profiles)
  store.set((s) => ({
    personalities: readLibrary(profiles),
    projects: inOrder(
      s.projects.map((pr) => {
        const row = profiles.find((p) => p.name === pr.id)
        return row ? { ...pr, personalityIds: castOf(row) } : pr
      }),
    ),
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

// ---- sending ------------------------------------------------------------------------
// What you send shows at once: the message, and for a new thread the thread itself, before
// Hermes has either. A new thread lives under a local id until session.create names it; then
// everything kept under the local id moves to the stored one. If something doesn't go, it
// stays where it is, marked failed, until you retry it or take it back.

// Never a prefix Hermes uses itself: it names sessions "local-<hex>" (routine runs among
// them), and a stored session taken for a local one is never loaded and never sent to.
const LOCAL = "kitaab-draft-"

/** A thread started here that Hermes hasn't made yet. */
export const isLocalThread = (id: Id | null | undefined): boolean => !!id?.startsWith(LOCAL)

/** Threads made here that the server doesn't list yet (it lists them once a message is saved). */
const unlisted = new Set<Id>()
/** Local id → stored id, and back, for threads made here. */
const became = new Map<Id, Id>()
const madeAs = new Map<Id, Id>()
/** A local thread's session.create in flight, so a retry can't make a second one. */
const creating = new Map<Id, Promise<Id>>()
const renamed = new Set<(from: Id, to: Id) => void>()

/** The id a thread was first shown under. Keying a view by it keeps the view put when a new thread gets its real id. */
export function viewIdentity(id: Id): Id {
  return madeAs.get(id) ?? id
}

/** Calls `l` when a thread started here gets its real id. */
export function onThreadRenamed(l: (from: Id, to: Id) => void): () => void {
  renamed.add(l)
  return () => void renamed.delete(l)
}

let sendSeq = 0
const newLocalId = () => `${LOCAL}${Date.now().toString(36)}-${(sendSeq++).toString(36)}`
const titleFor = (text: string, attachments: Attachment[]) => text.split("\n")[0].slice(0, 80) || attachments[0]?.name || "New thread"
const projectOfThread = (threadId: Id) =>
  runOrigin(threadId)?.projectId ?? store.get().threads.find((t) => t.id === threadId)?.projectId ?? profile()

function rekey<T>(rec: Record<Id, T>, from: Id, to: Id): Record<Id, T> {
  if (!(from in rec)) return rec
  const { [from]: v, ...rest } = rec
  return { ...rest, [to]: v }
}

function omit<T>(rec: Record<Id, T>, id: Id): Record<Id, T> {
  if (!(id in rec)) return rec
  const { [id]: _, ...rest } = rec
  return rest
}

/** Moves everything kept under a local thread id to the id Hermes gave it. */
function renameThread(from: Id, to: Id) {
  became.set(from, to)
  madeAs.set(to, from)
  store.set((s) => ({
    // A refresh may already list it under the new id: the copy we've been showing wins.
    threads: s.threads.some((t) => t.id === from)
      ? s.threads.filter((t) => t.id !== to).map((t) => (t.id === from ? { ...t, id: to } : t))
      : s.threads,
    details: rekey(s.details, from, to),
    threadModels: rekey(s.threadModels, from, to),
    queued: rekey(s.queued, from, to),
    subagents: rekey(s.subagents, from, to),
    view: s.view.kind === "thread" && s.view.threadId === from ? { ...s.view, threadId: to } : s.view,
  }))
  store.retargetHistory(from, to)
  for (const [p, id] of lastThread) if (id === from) lastThread.set(p, to)
  renamed.forEach((l) => l(from, to))
}

/** Removes a thread that only exists here (never made, or made but nothing in it). */
function dropUnsavedThread(id: Id) {
  unlisted.delete(id)
  store.set((s) => ({
    threads: s.threads.filter((t) => t.id !== id),
    details: omit(s.details, id),
    threadModels: omit(s.threadModels, id),
    queued: omit(s.queued, id),
    view: s.view.kind === "thread" && s.view.threadId === id ? { kind: "thread", threadId: null } : s.view,
  }))
}

/** Makes a Hermes session for a new thread. */
async function startSession(projectId: Id): Promise<{ id: Id; runtimeId: string; info: any }> {
  const r = await gw.call<any>("session.create", { profile: projectId })
  const id = r.stored_session_id as string
  runtimeOf.set(id, r.session_id)
  storedOf.set(r.session_id, id)
  noteSession(r.session_id, r.info)
  unlisted.add(id)
  return { id, runtimeId: r.session_id, info: r.info }
}

/** Puts a new session on the model its thread was started with, if one was picked. */
async function applyStartModel(id: Id, runtimeId: string, info: any, pick: ModelChoice | null) {
  if (pick) {
    const same = info?.model === pick.model && (info?.provider ?? "") === pick.provider
    const applied = await applyModel(runtimeId, pick, same).catch((e) => {
      toast.error(`Model: ${e.message ?? e}`)
      return false
    })
    if (applied) return rememberModel(id, { model: pick.model, provider: pick.provider, reasoning_effort: pick.effort, fast: pick.fast })
  }
  rememberModel(id, info)
}

/** Makes the Hermes session for a thread started here and moves it to its stored id. */
function createThread(localId: Id): Promise<Id> {
  let flight = creating.get(localId)
  if (!flight) {
    flight = (async () => {
      const projectId = store.get().threads.find((t) => t.id === localId)?.projectId ?? profile()
      const s = await startSession(projectId)
      renameThread(localId, s.id)
      // Picked in the composer, or changed while it was being made (see setModel).
      const pick = store.get().threadModels[s.id] ?? null
      await applyStartModel(s.id, s.runtimeId, s.info, pick)
      return s.id
    })()
    creating.set(localId, flight)
    const done = () => creating.delete(localId)
    flight.then(done, done)
  }
  return flight
}

/** A message already showing in a thread, on its way to Hermes. */
type Outgoing = { threadId: Id; messageId: Id; text: string; attachments: Attachment[]; interrupt: boolean }

function setDelivery(threadId: Id, messageId: Id, delivery?: Message["delivery"], error?: string) {
  if (!store.get().details[threadId]) return
  store.updateDetail(threadId, (d) => ({
    ...d,
    messages: d.messages.map((m) => (m.id === messageId ? { ...m, delivery, deliveryError: error } : m)),
  }))
}

/**
 * Shows a message in the thread right away and works out what sending does: answers an open
 * question, waits in the queue behind a running reply, or goes now (the Outgoing returned).
 */
function begin(threadId: Id, text: string, attachments: Attachment[], how: SendMode, fresh: boolean): Outgoing | null {
  // An open clarify question is answered by the next message (a custom answer when it has choices).
  const openClarify = store.get().details[threadId]?.pending.find((x) => x.kind === "clarify")
  if (openClarify && text) {
    void backend.answer(threadId, openClarify, text)
    return null
  }
  // A reply is running: hold the message until it ends, or stop it and send now. A thread
  // made just now is already marked "working" for this very message, so it never waits.
  const interrupt = !fresh && replying(threadId)
  if (interrupt && how === "queue") {
    enqueue(threadId, text, attachments)
    return null
  }
  const messageId = `u-${Date.now()}-${(sendSeq++).toString(36)}`
  store.updateDetail(threadId, (d) => ({
    ...d,
    ...(fresh ? { loading: false } : {}),
    messages: [...d.messages, { id: messageId, role: "user", text, attachments, createdAt: Date.now(), delivery: "sending" }],
  }))
  // Interrupting: the running reply stays "working" until it has stopped (deliver waits for that).
  patchThread(threadId, interrupt ? { updatedAt: Date.now() } : { status: "working", updatedAt: Date.now() })
  return { threadId, messageId, text, attachments, interrupt }
}

/** Gets a message that's already showing to Hermes. Resolves to the thread's id (its stored one, for a thread started here). */
async function deliver(o: Outgoing): Promise<Id> {
  const id = isLocalThread(o.threadId) ? await createThread(o.threadId) : o.threadId
  const runtimeId = await ensureRuntime(id)
  let ended = true
  if (o.interrupt && replying(id)) {
    stopping.add(id)
    patchThread(id, { stopping: true })
    try {
      await gw.call("session.interrupt", { session_id: runtimeId })
      ended = await untilIdle(id, 10_000)
    } finally {
      stopping.delete(id)
    }
  }
  // Sending again picks the queue back up after a Stop.
  setPaused(id, false)
  patchThread(id, { status: "working", updatedAt: Date.now() })
  // Who answers: the @mentioned personality, else the thread's host.
  const cast = await prepareTurn(id, runtimeId, projectOfThread(id), o.text)
  patchThread(id, { cast })
  await attach(runtimeId, o.attachments)
  // A reply that wouldn't stop: Hermes runs this right after it, rather than steering it.
  await gw.call("prompt.submit", { session_id: runtimeId, text: o.text, ...(ended ? {} : { queued: true }) })
  setDelivery(id, o.messageId, undefined)
  return id
}

/** It didn't go: it stays in the thread, marked, and the thread waits for you to retry or take it back. */
function failed(o: Outgoing, e: unknown) {
  const id = became.get(o.threadId) ?? o.threadId
  const why = e instanceof Error ? e.message : String(e)
  patchThread(id, { status: "idle" })
  setDelivery(id, o.messageId, "failed", why)
  // What's queued behind it waits too.
  setPaused(id, true)
  toast.error(isLocalThread(id) ? `Couldn't start the thread: ${why}` : `Couldn't send your message: ${why}`, {
    id: unsentToastId(o.messageId),
  })
}

const unsentToastId = (messageId: Id) => `unsent:${messageId}`

const hasFailed = (threadId: Id) => store.get().details[threadId]?.messages.some((m) => m.delivery === "failed") ?? false

export const backend: Backend = {
  // Single-flight: overlapping calls (StrictMode, menu, reconnect) share one attempt.
  connect() {
    readEnterSends()
    connecting ??= connectOnce().finally(() => (connecting = null))
    return connecting
  },
  async selectProject(id) {
    try {
      platform().storage.set("projectId", id)
    } catch {}
    const { projectId: from, view } = store.get()
    const changed = from !== id
    store.set({ projectId: id })
    if (changed) {
      // Coming back to a project reopens the thread you had open there.
      if (from && view.kind === "thread") {
        if (view.threadId) lastThread.set(from, view.threadId)
        else lastThread.delete(from)
      }
      store.go({ kind: "thread", threadId: lastThread.get(id) ?? null })
    }
    await Promise.all([
      loadThreads(id).catch((e) => toast.error(`Threads: ${e.message ?? e}`)),
      loadDone(id).catch(() => {}),
      loadModels(id).catch(() => {}),
      loadRoutines().catch((e) => toast.error(`Routines: ${e.message ?? e}`)),
      changed ? refreshProfiles().catch(() => {}) : undefined,
    ])
  },

  async createProject(name) {
    const id = projectIdFor(name)
    if (!id) throw new Error("Use letters or numbers in the name")
    if (store.get().projects.some((p) => p.id === id)) throw new Error(`A project called ${id} already exists`)
    // Cloned from Default so it starts with the same model, keys and skills.
    await gw.call("profiles.create", { name: id, clone_from: "default" })
    const { profiles } = await gw.call<{ profiles: any[] }>("profiles.list", { include_sessions: false })
    const row = profiles.find((p) => p.name === id)
    store.set((s) => ({
      projects: [
        ...s.projects.filter((p) => p.id !== id),
        { id, name: (row?.display_name as string) || id, personalityIds: row ? castOf(row) : [] },
      ],
    }))
    // Tells Hermes it's talking through Kitaab in the new project too.
    void syncKitabContext(profiles).catch((e) => console.warn("[kitab-context]", e))
    await backend.selectProject(id)
    return id
  },

  async setProjectOrder(ids) {
    await writeProjectOrder(gw, ids)
  },

  async loadThread(threadId) {
    // Not on the server yet: everything there is to show is already here.
    if (isLocalThread(threadId)) return store.updateDetail(threadId, (d) => ({ ...d, loading: false, stale: false }))
    showCached(threadId)
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

  async send(threadId, text, attachments, how = "queue") {
    let id = threadId
    if (!id) {
      // The iPhone shows its own copy of the message until the thread exists, so it waits for Hermes.
      const pick = store.get().draftModel ?? usableMyModel()
      const s = await startSession(profile())
      id = s.id
      await applyStartModel(s.id, s.runtimeId, s.info, pick)
      store.set((st) => ({
        threads: withFirst(st.threads, { id: s.id, projectId: profile(), title: titleFor(text, attachments), updatedAt: Date.now(), cast: [], status: "working" }),
      }))
    }
    const o = begin(id, text, attachments, how, !threadId)
    if (!o) return id
    try {
      return await deliver(o)
    } catch (e) {
      patchThread(id, { status: "idle" })
      // The composer (or the queue) puts the text back; leaving it in the thread too would look sent.
      store.updateDetail(id, (d) => ({ ...d, messages: d.messages.filter((m) => m.id !== o.messageId) }))
      throw e
    }
  },

  post(threadId, text, attachments, how = "queue") {
    if (threadId) {
      // A message that didn't go holds the thread until you retry or take it back.
      if (hasFailed(threadId)) return threadId
      const o = begin(threadId, text, attachments, how, false)
      if (o) deliver(o).catch((e) => failed(o, e))
      return threadId
    }
    const id = newLocalId()
    // The composer's pick for this thread, else your default from Settings.
    const pick = store.get().draftModel ?? usableMyModel()
    store.set((s) => ({
      threads: withFirst(s.threads, { id, projectId: profile(), title: titleFor(text, attachments), updatedAt: Date.now(), cast: [], status: "working" }),
      threadModels: pick ? { ...s.threadModels, [id]: pick } : s.threadModels,
    }))
    const o = begin(id, text, attachments, how, true)!
    deliver(o).catch((e) => failed(o, e))
    return id
  },

  retry(threadId, messageId) {
    const m = store.get().details[threadId]?.messages.find((x) => x.id === messageId && x.delivery === "failed")
    if (!m) return
    const interrupt = replying(threadId)
    setDelivery(threadId, messageId, "sending")
    if (!interrupt) patchThread(threadId, { status: "working", updatedAt: Date.now() })
    const o: Outgoing = { threadId, messageId, text: m.text, attachments: m.attachments ?? [], interrupt }
    // The notice about it failing is old news now.
    toast.dismiss(unsentToastId(messageId))
    deliver(o).catch((e) => failed(o, e))
  },

  unsend(threadId, messageId) {
    const messages = store.get().details[threadId]?.messages ?? []
    const m = messages.find((x) => x.id === messageId && x.delivery === "failed")
    if (!m) return null
    toast.dismiss(unsentToastId(messageId))
    // A thread with nothing else in it was never really started: it goes too.
    if ((isLocalThread(threadId) || unlisted.has(threadId)) && messages.length === 1) dropUnsavedThread(threadId)
    else store.updateDetail(threadId, (d) => ({ ...d, messages: d.messages.filter((x) => x.id !== messageId) }))
    return { text: m.text, attachments: m.attachments ?? [] }
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
    // Stop means stop: what's queued waits until you send or remove it.
    setPaused(threadId, true)
    const runtimeId = runtimeOf.get(threadId)
    if (!runtimeId) return
    // Says so at once; the reply ending (message.complete) clears it.
    if (replying(threadId)) {
      patchThread(threadId, { stopping: true })
      clearTimeout(stopTimers.get(threadId))
      stopTimers.set(
        threadId,
        // A stop that never lands mustn't say "Stopping…" forever.
        setTimeout(() => patchThread(threadId, { stopping: undefined }), STOP_PATIENCE_MS),
      )
    }
    try {
      await gw.call("session.interrupt", { session_id: runtimeId })
    } catch (e) {
      patchThread(threadId, { stopping: undefined })
      toast.error(`Couldn't stop it: ${e instanceof Error ? e.message : e}`)
    }
  },

  async sendQueuedNow(threadId, queuedId) {
    const item = take(threadId, queuedId)
    if (!item) return
    try {
      await backend.send(threadId, item.text, item.attachments, "interrupt")
    } catch (e) {
      putBack(threadId, item)
      toast.error(`Couldn't send it: ${e instanceof Error ? e.message : e}`)
    }
  },

  unqueue(threadId, queuedId) {
    take(threadId, queuedId)
  },

  setEnterSends(mode) {
    writeEnterSends(mode)
  },

  async answer(threadId, question, value) {
    const open = openRequests.get(question.id)
    if (!open) return removePending(threadId, question.id)
    if (open.req.method === "approval") {
      gw.respond(question.id, { choice: value })
    } else if (open.req.method === "secret" || open.req.method === "sudo") {
      // Straight onto the socket: never into the store, the thread or a log. "" means skipped.
      gw.respond(question.id, { value })
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
    // A thread that never got made has nothing to archive: it just goes.
    if (isLocalThread(threadId)) return dropUnsavedThread(threadId)
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
    // Still being made: it starts on this model (see createThread).
    if (isLocalThread(threadId)) {
      store.set((s) => ({ threadModels: { ...s.threadModels, [threadId]: choice } }))
      return
    }
    // The picker shows it at once; it goes back if Hermes doesn't switch (or you decline the cost).
    const before = store.get().threadModels[threadId]
    const sameModel = before?.model === choice.model && before?.provider === choice.provider
    store.set((s) => ({ threadModels: { ...s.threadModels, [threadId]: choice } }))
    const undo = () =>
      store.set((s) => {
        // You've picked again since: that pick stands.
        if (s.threadModels[threadId] !== choice) return {}
        const threadModels = { ...s.threadModels }
        if (before) threadModels[threadId] = before
        else delete threadModels[threadId]
        return { threadModels }
      })
    try {
      const runtimeId = await ensureRuntime(threadId)
      if (!(await applyModel(runtimeId, choice, sameModel))) undo()
    } catch (e) {
      undo()
      toast.error(`Couldn't switch model: ${e instanceof Error ? e.message : e}`)
    }
  },
}
