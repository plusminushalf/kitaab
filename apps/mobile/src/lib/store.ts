import { useSyncExternalStore } from "react"
import { store, type State } from "@kitab/core/store"

export * from "@kitab/core/store"

/** React binding for the shared store (kept out of the core so it never imports React). */
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()))
}
