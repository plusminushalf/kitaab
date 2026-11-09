import { useEffect, useRef, useSyncExternalStore } from "react"
import { onThreadRenamed } from "@kitab/core/backend"
import { store } from "@/lib/store"
import type { Id, Thread } from "@kitab/core/model"

/**
 * What Ctrl+Tab does. "recent" walks threads in the order you last had them open, like
 * switching apps with ⌘Tab: tap it to flip between the last two, or hold Ctrl and keep
 * pressing Tab to go further back. "list" moves down the thread list as shown.
 */
export type CtrlTabMode = "recent" | "list"

const KEY = "kitab.ctrlTab"
const listeners = new Set<() => void>()
let mode: CtrlTabMode = read()

function read(): CtrlTabMode {
  try {
    return localStorage.getItem(KEY) === "list" ? "list" : "recent"
  } catch {
    return "recent"
  }
}

/** Saved on this device. */
export function setCtrlTabMode(next: CtrlTabMode) {
  mode = next
  try {
    localStorage.setItem(KEY, next)
  } catch {}
  listeners.forEach((l) => l())
}

export function useCtrlTabMode(): CtrlTabMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => mode,
  )
}

// Threads you've had open, most recent first. Only kept for this session.
let recent: Id[] = []
// While Ctrl is held after a Ctrl+Tab, the list being walked and where we are in it.
// The walk doesn't count as opening threads until Ctrl comes up.
let walk: { ids: Id[]; at: number } | null = null

function touch(id: Id) {
  recent = [id, ...recent.filter((x) => x !== id)].slice(0, 200)
}

function openedThread(): Id | null {
  const v = store.get().view
  return v.kind === "thread" ? v.threadId : null
}

function endWalk() {
  if (!walk) return
  walk = null
  const id = openedThread()
  if (id) touch(id)
}

/**
 * Ctrl+Tab and Ctrl+Shift+Tab between threads. `shown` is the thread list as the sidebar
 * shows it (sort and search applied); list mode follows it and wraps, recent mode puts
 * threads in the order you last opened them, then the ones you haven't opened this
 * session, in list order.
 */
export function useThreadSwitching(shown: Thread[], projectThreads: Thread[]) {
  const latest = useRef({ shown, projectThreads })
  latest.current = { shown, projectThreads }

  // Remember the order threads are opened in.
  useEffect(() => {
    const first = openedThread()
    if (first) touch(first)
    let last = first
    const unsubscribe = store.subscribe(() => {
      const id = openedThread()
      if (id === last) return
      last = id
      if (id && !walk) touch(id)
    })
    const unrename = onThreadRenamed((from, to) => {
      recent = recent.map((x) => (x === from ? to : x))
      if (walk) walk.ids = walk.ids.map((x) => (x === from ? to : x))
    })
    return () => {
      unsubscribe()
      unrename()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // In case Ctrl came up somewhere we didn't hear it.
      if (!e.ctrlKey) endWalk()
      if (e.key !== "Tab" || !e.ctrlKey || e.metaKey || e.altKey) return
      // Ctrl+Tab never moves focus here, even when there's nowhere to go.
      e.preventDefault()
      if (store.get().settings) return
      const by = e.shiftKey ? -1 : 1
      const active = openedThread()
      const { shown, projectThreads } = latest.current

      if (mode === "list") {
        if (!shown.length) return
        const i = shown.findIndex((t) => t.id === active)
        const next = i === -1 ? (by === 1 ? 0 : shown.length - 1) : (i + by + shown.length) % shown.length
        if (shown[next].id !== active) store.go({ kind: "thread", threadId: shown[next].id })
        return
      }

      if (!walk) {
        const here = new Set(projectThreads.map((t) => t.id))
        const ids = new Set(recent.filter((id) => here.has(id)))
        for (const t of [...shown, ...projectThreads]) ids.add(t.id)
        if (!ids.size) return
        const list = [...ids]
        walk = { ids: list, at: active ? list.indexOf(active) : -1 }
      }
      const n = walk.ids.length
      walk.at = walk.at === -1 ? (by === 1 ? 0 : n - 1) : (walk.at + by + n) % n
      const target = walk.ids[walk.at]
      if (target !== active) store.go({ kind: "thread", threadId: target })
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") endWalk()
    }
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("keyup", onKeyUp, true)
    window.addEventListener("blur", endWalk)
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("keyup", onKeyUp, true)
      window.removeEventListener("blur", endWalk)
    }
  }, [])
}
