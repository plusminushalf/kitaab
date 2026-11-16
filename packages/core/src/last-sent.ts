import { http, platform } from "./platform"
import type { Id, Thread } from "./model"

// When you last wrote in each thread, which is what orders the thread list. Hermes's activity
// time moves whenever it replies, and every minute or so while it works, so ordering by it
// kept swapping threads that were running. Hermes doesn't list when you last wrote, so it's
// read from each thread's timeline (your prompts, with their times), read again only once the
// thread's activity time has moved, and kept on this device so a launch doesn't read them all.

const KEY = "kitab.lastSent"
const MAX = 1000
/** Timelines read at once. */
const PARALLEL = 4

/** at: your last message (ms, 0 for none). active: the thread's updatedAt when `at` was read. */
type Entry = { at: number; active: number }

let known: Map<Id, Entry> | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
const reading = new Set<Id>()

function entries(): Map<Id, Entry> {
  if (known) return known
  known = new Map()
  try {
    const raw = JSON.parse(platform().storage.get(KEY) ?? "{}")
    for (const [id, e] of Object.entries<any>(raw ?? {}))
      if (typeof e?.at === "number" && typeof e?.active === "number") known.set(id, { at: e.at, active: e.active })
  } catch {}
  return known
}

function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const all = [...entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX)
    try {
      platform().storage.set(KEY, JSON.stringify(Object.fromEntries(all)))
    } catch {}
  }, 500)
}

/** The list's order: when you last wrote, else (no message of yours) when the thread last moved. */
export const sentAt = (t: Thread): number => t.lastSentAt || t.updatedAt

export function lastSentAt(id: Id): number | undefined {
  return entries().get(id)?.at || undefined
}

/** You just sent a message in `id`. Returns its time. */
export function noteSent(id: Id): number {
  const now = Date.now()
  const e = entries().get(id)
  // Keep `active`: the thread's next move reads the timeline, which then has this message.
  entries().set(id, { at: now, active: e?.active ?? 0 })
  save()
  return now
}

const q = encodeURIComponent

/** The time of your newest prompt in a thread (ms), or 0. */
async function readNewest(profile: string, id: Id): Promise<number> {
  let after = 0
  let newest = 0
  // A page holds 500 prompts; a thread with more takes another read or two.
  for (let page = 0; page < 10; page++) {
    const res = await http().get<{ entries: { timestamp: number }[]; pagination?: { has_more?: boolean; next_cursor?: number | null } }>(
      `/api/sessions/${q(id)}/timeline?profile=${q(profile)}&limit=500&after_row_id=${after}`,
    )
    const last = res.entries?.at(-1)
    if (last && typeof last.timestamp === "number") newest = last.timestamp * 1000
    const next = res.pagination?.next_cursor
    if (!res.pagination?.has_more || typeof next !== "number") break
    after = next
  }
  return newest
}

/**
 * Reads when you last wrote in the threads that moved since it was last read. Resolves to the
 * ones whose time it now knows. A thread that can't be read keeps what it had.
 */
export async function readLastSent(profile: string, threads: Thread[]): Promise<Map<Id, number>> {
  const due = threads.filter((t) => !reading.has(t.id) && entries().get(t.id)?.active !== t.updatedAt)
  const got = new Map<Id, number>()
  for (const t of due) reading.add(t.id)
  let next = 0
  const worker = async () => {
    while (next < due.length) {
      const t = due[next++]
      try {
        const at = await readNewest(profile, t.id)
        // Sent from here a moment ago: Hermes may not have saved it yet.
        const best = Math.max(at, entries().get(t.id)?.at ?? 0)
        entries().set(t.id, { at: best, active: t.updatedAt })
        if (best) got.set(t.id, best)
      } catch {
      } finally {
        reading.delete(t.id)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, due.length) }, worker))
  if (due.length) save()
  return got
}
