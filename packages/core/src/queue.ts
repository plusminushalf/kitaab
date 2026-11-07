import { platform } from "./platform"
import { store, type Queue, type QueuedMessage, type SendMode } from "./store"
import type { Attachment, Id } from "./model"

// Messages sent while a reply is running wait here, in the app, not in Hermes's own queue.
// Hermes merges queued messages into one, drops them all when the turn is stopped, and by
// default steers the running reply with a mid-turn message instead of waiting. Holding them
// here keeps each one its own turn, in order, and lets you see, send or remove them.

const KEY = "kitab.enterSends"

/** Loads what Enter does while a reply is running, saved on this device. */
export function readEnterSends() {
  try {
    const v = platform().storage.get(KEY)
    if (v === "queue" || v === "interrupt") store.set({ enterSends: v })
  } catch {}
}

export function writeEnterSends(mode: SendMode) {
  store.set({ enterSends: mode })
  try {
    platform().storage.set(KEY, mode)
  } catch {}
}

function update(threadId: Id, fn: (q: Queue) => Queue) {
  store.set((s) => {
    const next = fn(s.queued[threadId] ?? { items: [], paused: false })
    const queued = { ...s.queued }
    // An empty queue goes away, and with it any pause.
    if (next.items.length) queued[threadId] = next
    else delete queued[threadId]
    return { queued }
  })
}

let seq = 0

export function enqueue(threadId: Id, text: string, attachments: Attachment[]) {
  const item: QueuedMessage = { id: `q-${Date.now()}-${seq++}`, text, attachments }
  update(threadId, (q) => ({ ...q, items: [...q.items, item] }))
}

/** Takes one message out of the queue. */
export function take(threadId: Id, id?: string): QueuedMessage | undefined {
  const items = store.get().queued[threadId]?.items ?? []
  const item = id ? items.find((x) => x.id === id) : items[0]
  if (item) update(threadId, (q) => ({ ...q, items: q.items.filter((x) => x !== item) }))
  return item
}

/** Puts back a message that didn't go, first in line, and holds the queue until you act on it. */
export function putBack(threadId: Id, item: QueuedMessage) {
  update(threadId, (q) => ({ items: [item, ...q.items], paused: true }))
}

export function setPaused(threadId: Id, paused: boolean) {
  if (store.get().queued[threadId]) update(threadId, (q) => ({ ...q, paused }))
}

export const isPaused = (threadId: Id) => store.get().queued[threadId]?.paused ?? false
