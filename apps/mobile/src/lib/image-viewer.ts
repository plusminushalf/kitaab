import { useSyncExternalStore } from "react"

// The image open full screen (components/image-viewer.tsx), if any. One viewer for the
// whole app, mounted in the root layout, so any thumbnail can open it.

export type ViewedImage = { uri: string; alt?: string }

let viewed: ViewedImage | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function openImage(image: ViewedImage) {
  viewed = image
  emit()
}

export function closeImage() {
  viewed = null
  emit()
}

export function useViewedImage(): ViewedImage | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => viewed,
  )
}
