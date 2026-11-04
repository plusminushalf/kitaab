import { useSyncExternalStore } from "react"
import type { NoticeKind, NoticeOptions } from "@kitab/core/platform"

// Notices from the shared core, shown as a small banner (components/toasts.tsx).

export type Toast = { id: string; kind: NoticeKind; message: string; action?: NoticeOptions["action"] }

let toasts: Toast[] = []
const listeners = new Set<() => void>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const emit = () => listeners.forEach((l) => l())

export function showToast(kind: NoticeKind, message: string, options?: NoticeOptions) {
  const id = options?.id ?? `t${Date.now()}${Math.random()}`
  toasts = [...toasts.filter((t) => t.id !== id), { id, kind, message, action: options?.action }].slice(-3)
  emit()
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => dismissToast(id), options?.action ? 6000 : kind === "error" ? 5000 : 3000))
}

export function dismissToast(id: string) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => toasts,
  )
}
