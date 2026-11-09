import { useSyncExternalStore } from "react"
import {
  acceleratorLabel,
  resolveBindings,
  type ShortcutId,
  type ShortcutOverrides,
} from "../../../shared/shortcuts"

// The live bindings, for hints across the app and the Settings → Shortcuts page.
// The main process owns them (it builds the menu bar); this mirrors what it saved.

let overrides: ShortcutOverrides = {}
let bindings = resolveBindings(overrides)
const listeners = new Set<() => void>()

function apply(next: ShortcutOverrides) {
  overrides = next
  bindings = resolveBindings(next)
  listeners.forEach((l) => l())
}

void window.hermes.shortcuts.get().then(apply)

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export const shortcuts = {
  overrides: () => overrides,
  bindings: () => bindings,
  async set(id: ShortcutId, accelerator: string) {
    apply(await window.hermes.shortcuts.set({ ...overrides, [id]: accelerator }))
  },
  async reset(id: ShortcutId) {
    const { [id]: _, ...rest } = overrides
    apply(await window.hermes.shortcuts.set(rest))
  },
  async resetAll() {
    apply(await window.hermes.shortcuts.set({}))
  },
}

export function useShortcutBindings(): Record<ShortcutId, string> {
  return useSyncExternalStore(subscribe, () => bindings)
}

/** "⇧⌘S" for a command, or "" when it has no shortcut. */
export function useShortcutLabel(id: ShortcutId): string {
  return acceleratorLabel(useShortcutBindings()[id])
}

/** "New thread (⌘N)", or just the label when there's no shortcut. */
export function withShortcut(label: string, shortcut: string): string {
  return shortcut ? `${label} (${shortcut})` : label
}
