import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { store } from "@/lib/store"

// Two-finger trackpad swipe to go back/forward, like Safari and Chrome.
// macOS delivers the swipe as horizontal wheel events; we add them up and
// navigate once they pass a threshold, showing an arrow at the edge meanwhile.
// Also: mouse back/forward buttons.

const THRESHOLD = 180 // px of horizontal travel
const IDLE_MS = 160 // a gap this long ends the gesture

type Gesture = { axis: "x" | "y" | null; dx: number; done: boolean; timer?: ReturnType<typeof setTimeout> }

/** True when something under the pointer can itself scroll sideways in that direction. */
function scrollsHorizontally(target: EventTarget | null, dx: number): boolean {
  for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el)
    if (!/(auto|scroll)/.test(style.overflowX) || el.scrollWidth <= el.clientWidth) continue
    if (dx < 0 && el.scrollLeft > 0) return true
    if (dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true
  }
  return false
}

export function SwipeIndicator() {
  const [progress, setProgress] = useState(0) // -1…1, negative = forward
  const g = useRef<Gesture>({ axis: null, dx: 0, done: false })

  useEffect(() => {
    const reset = () => {
      g.current = { axis: null, dx: 0, done: false }
      setProgress(0)
    }

    const onWheel = (e: WheelEvent) => {
      const s = g.current
      clearTimeout(s.timer)
      s.timer = setTimeout(reset, IDLE_MS)
      if (s.done) return

      // Decide the axis from the first clear movement; vertical scrolling is left alone.
      if (!s.axis) {
        if (Math.abs(e.deltaX) < 2 && Math.abs(e.deltaY) < 2) return
        s.axis = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5 ? "x" : "y"
        if (s.axis === "x" && scrollsHorizontally(e.target, e.deltaX)) s.axis = "y"
      }
      if (s.axis !== "x") return

      // Fingers moving right (negative deltaX) means back.
      s.dx -= e.deltaX
      const back = s.dx > 0
      if (back ? !store.canGoBack() : !store.canGoForward()) {
        setProgress(0)
        return
      }
      const p = Math.max(-1, Math.min(1, s.dx / THRESHOLD))
      setProgress(p)
      if (Math.abs(p) >= 1) {
        s.done = true
        if (back) store.back()
        else store.forward()
        setTimeout(() => setProgress(0), 120)
      }
    }

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) store.back()
      if (e.button === 4) store.forward()
    }

    window.addEventListener("wheel", onWheel, { passive: true })
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("wheel", onWheel)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [])

  if (progress === 0) return null
  const back = progress > 0
  const amount = Math.abs(progress)
  const ready = amount >= 1
  const Icon = back ? ChevronLeft : ChevronRight

  return (
    <div
      className="pointer-events-none fixed top-1/2 z-50 -translate-y-1/2"
      style={{
        [back ? "left" : "right"]: -40 + amount * 56,
        opacity: Math.min(1, amount * 1.5),
      }}
    >
      <div
        className={
          "flex size-10 items-center justify-center rounded-full border shadow-sm transition-colors " +
          (ready ? "bg-primary text-primary-foreground" : "bg-popover text-popover-foreground")
        }
      >
        <Icon className="size-5" />
      </div>
    </div>
  )
}
