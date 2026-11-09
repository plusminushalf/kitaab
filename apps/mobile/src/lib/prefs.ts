import { useSyncExternalStore } from "react"
import type { Id, Thread } from "@kitab/core/model"
import { kv } from "./kv"

// This iPhone's own list preferences (not synced): how the threads list is laid out and
// sorted, which project folders are shut, and which threads you've seen since they moved.

/** "list": one list of cards across projects (the Mac's default). "folders": Dia-style project folders. */
export type ThreadsLayout = "list" | "folders"
export type ThreadSort = "activity" | "status" | "title"

type Prefs = {
  layout: ThreadsLayout
  sort: ThreadSort
  /** Folded-shut project folders, per profile. */
  collapsed: Record<Id, Id[]>
}

const KEY = "prefs"
const DEFAULTS: Prefs = { layout: "list", sort: "activity", collapsed: {} }

let prefs: Prefs = { ...DEFAULTS, ...kv.json<Partial<Prefs>>(KEY, {}) }
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch }
  kv.set(KEY, JSON.stringify(prefs))
  listeners.forEach((l) => l())
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, () => prefs)
}

export function toggleCollapsed(profileId: Id, projectId: Id) {
  const mine = new Set(prefs.collapsed[profileId] ?? [])
  if (mine.has(projectId)) mine.delete(projectId)
  else mine.add(projectId)
  setPrefs({ collapsed: { ...prefs.collapsed, [profileId]: [...mine] } })
}

const STATUS_RANK: Record<Thread["status"], number> = { "needs-you": 0, working: 1, idle: 2 }

/** Threads in the chosen order (a sorted copy). */
export function sortThreads(list: Thread[], sort: ThreadSort): Thread[] {
  return [...list].sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "status"
        ? STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.updatedAt - a.updatedAt
        : b.updatedAt - a.updatedAt,
  )
}

// Seen threads: for each, the `updatedAt` it had when you last had it open. A thread seen
// for the first time counts as read, so a fresh install doesn't light up every card.

const SEEN_KEY = "seenThreads"
const MAX_SEEN = 2000
let seen: Record<Id, number> = kv.json<Record<Id, number>>(SEEN_KEY, {})
const seenListeners = new Set<() => void>()
let saveTimer: ReturnType<typeof setTimeout> | undefined

function saveSeen(next: Record<Id, number>) {
  const ids = Object.keys(next)
  if (ids.length > MAX_SEEN) {
    // Forget the threads that moved longest ago.
    ids.sort((a, b) => next[a] - next[b])
    for (const id of ids.slice(0, ids.length - MAX_SEEN)) delete next[id]
  }
  seen = next
  seenListeners.forEach((l) => l())
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => kv.set(SEEN_KEY, JSON.stringify(seen)), 500)
}

/** Marks a thread read as of `at` (its updatedAt now). */
export function markSeen(id: Id, at: number) {
  if (seen[id] !== undefined && seen[id] >= at) return
  saveSeen({ ...seen, [id]: at })
}

/** Threads not seen before count as read from here on. */
export function adoptUnknown(threads: Thread[]) {
  const fresh = threads.filter((t) => seen[t.id] === undefined)
  if (!fresh.length) return
  const next = { ...seen }
  for (const t of fresh) next[t.id] = t.updatedAt
  saveSeen(next)
}

/** True when the thread moved after you last had it open. */
export function useUnseen(t: Thread): boolean {
  const at = useSyncExternalStore(
    (l) => {
      seenListeners.add(l)
      return () => void seenListeners.delete(l)
    },
    () => seen[t.id],
  )
  // A second of slack: the list's timestamps and the live ones round differently.
  return at !== undefined && t.updatedAt > at + 1000
}
