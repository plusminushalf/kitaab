import { useSyncExternalStore } from "react"
import type { Id, Thread } from "@kitab/core/model"

// Which threads have moved since you last looked, on this device: for each thread, the
// `updatedAt` it had when you last had it open. A thread seen for the first time counts
// as read, so a fresh install doesn't light up every card.

const KEY = "kitab.seenThreads"
const MAX = 2000

function read(): Record<Id, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    return v && typeof v === "object" && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

let seen = read()
const listeners = new Set<() => void>()

function save(next: Record<Id, number>) {
  const ids = Object.keys(next)
  if (ids.length > MAX) {
    // Forget the threads that moved longest ago.
    ids.sort((a, b) => next[a] - next[b])
    for (const id of ids.slice(0, ids.length - MAX)) delete next[id]
  }
  seen = next
  try {
    localStorage.setItem(KEY, JSON.stringify(seen))
  } catch {}
  listeners.forEach((l) => l())
}

/** Marks a thread read as of `at` (its updatedAt now). */
export function markSeen(id: Id, at: number) {
  if (seen[id] !== undefined && seen[id] >= at) return
  save({ ...seen, [id]: at })
}

/** Threads not seen before count as read from here on. */
export function adoptUnknown(threads: Thread[]) {
  const fresh = threads.filter((t) => seen[t.id] === undefined)
  if (!fresh.length) return
  const next = { ...seen }
  for (const t of fresh) next[t.id] = t.updatedAt
  save(next)
}

/** True when the thread moved after you last had it open. */
export function useUnseen(t: Thread): boolean {
  const at = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => seen[t.id],
  )
  // A second of slack: the list's timestamps and the live ones round differently.
  return at !== undefined && t.updatedAt > at + 1000
}
