import { GENERAL } from "@kitab/core/model"
import { useSyncExternalStore } from "react"
import { onThreadRenamed } from "@kitab/core/backend"
import type { Draft } from "@/components/composer"
import type { Citation } from "@/components/cite-selection"

/**
 * What you've written but not sent, per thread (and per profile and project for a new thread), so it's
 * still there when you come back. Text is also saved across restarts; attachments and
 * citations last until the app quits.
 */
export type ComposerDraft = { text: string; drafts: Draft[]; citations: Citation[] }

const KEY = "kitab.composerDrafts"
const EMPTY: ComposerDraft = { text: "", drafts: [], citations: [] }

const saved = new Map<string, ComposerDraft>()
const listeners = new Set<() => void>()

try {
  const texts = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>
  for (const [k, text] of Object.entries(texts)) if (typeof text === "string") saved.set(k, { ...EMPTY, text })
} catch {}

const hasContent = (d: ComposerDraft) => d.text.trim() !== "" || d.drafts.length > 0 || d.citations.length > 0

function persist() {
  try {
    const texts: Record<string, string> = {}
    for (const [k, d] of saved) if (d.text.trim()) texts[k] = d.text
    localStorage.setItem(KEY, JSON.stringify(texts))
  } catch {}
}

export const draftKey = (threadId: string | null, profileId: string | null, projectId?: string) =>
  threadId ?? (projectId && projectId !== GENERAL ? `new:${profileId ?? ""}:${projectId}` : `new:${profileId ?? ""}`)

export function readDraft(key: string): ComposerDraft {
  return saved.get(key) ?? EMPTY
}

export function writeDraft(key: string, patch: Partial<ComposerDraft>) {
  const prev = readDraft(key)
  const next = { ...prev, ...patch }
  const had = hasContent(prev)
  if (hasContent(next)) saved.set(key, next)
  else saved.delete(key)
  if (patch.text !== undefined && patch.text !== prev.text) persist()
  if (had !== hasContent(next)) listeners.forEach((l) => l())
}

// A thread started here gets its real id once Hermes has made it: what you typed meanwhile follows.
onThreadRenamed((from, to) => {
  const d = saved.get(from)
  if (!d) return
  saved.delete(from)
  saved.set(to, d)
  persist()
})

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** Whether something unsent is waiting in this thread's composer. */
export function useHasDraft(key: string): boolean {
  return useSyncExternalStore(subscribe, () => hasContent(readDraft(key)))
}
