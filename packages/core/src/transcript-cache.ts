import { platform } from "./platform"
import type { Id, Message } from "./model"

// The last transcript seen for each recently opened thread, kept on this device so opening
// one shows it at once while the live session loads (which goes over SSH and takes a moment).
// What loads replaces it. Small on purpose: only the most recent threads, each trimmed.

const INDEX = "kitab.transcripts"
const entry = (threadId: Id) => `kitab.transcript.${threadId}`
/** Threads kept, most recently opened first. */
const MAX_THREADS = 40
/** Roughly how much of one thread is kept (in characters); older messages go first. */
const MAX_CHARS = 120_000

function readIndex(): Id[] {
  try {
    const ids = JSON.parse(platform().storage.get(INDEX) ?? "[]")
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []
  } catch {
    return []
  }
}

/** What's worth keeping: finished messages, without data the next launch can't use anyway. */
function trim(messages: Message[]): Message[] {
  const kept = messages
    // Unsent messages live only in this run; a reply still streaming is replaced as it loads.
    .filter((m) => !m.delivery && !m.streaming)
    .map((m) =>
      m.attachments?.length
        ? {
            ...m,
            // blob: links die with the app, and inline data would crowd everything else out.
            attachments: m.attachments.map((a) => (a.url && /^(blob|data):/.test(a.url) ? { ...a, url: undefined } : a)),
          }
        : m,
    )
  let size = 0
  let start = kept.length
  while (start > 0) {
    size += JSON.stringify(kept[start - 1]).length
    if (size > MAX_CHARS) break
    start--
  }
  return kept.slice(start)
}

export function readCachedTranscript(threadId: Id): Message[] | null {
  try {
    const raw = platform().storage.get(entry(threadId))
    const messages = raw ? JSON.parse(raw) : null
    return Array.isArray(messages) && messages.length ? messages : null
  } catch {
    return null
  }
}

export function writeCachedTranscript(threadId: Id, messages: Message[]) {
  const kept = trim(messages)
  if (!kept.length) return
  try {
    const { storage } = platform()
    storage.set(entry(threadId), JSON.stringify(kept))
    const ids = [threadId, ...readIndex().filter((x) => x !== threadId)]
    for (const old of ids.splice(MAX_THREADS)) storage.set(entry(old), null)
    storage.set(INDEX, JSON.stringify(ids))
  } catch {}
}
