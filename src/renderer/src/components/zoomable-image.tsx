import { useEffect, useRef, useState, type PointerEvent } from "react"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "cn"

const MIN = 1
const MAX = 8
const STEP = 1.5

type View = { scale: number; x: number; y: number }
const FIT: View = { scale: 1, x: 0, y: 0 }

/**
 * An enlarged image you can look into: pinch on the trackpad (or −/+, or the + − 0 keys) to
 * zoom, scroll or drag to move around, double-click to zoom in there or back out.
 */
export function ZoomableImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(FIT)
  const current = useRef(view)
  current.current = view

  // Keep the picture covering the box: no panning past its edges.
  const clamp = (v: View): View => {
    const el = box.current
    if (!el || v.scale <= MIN) return FIT
    const { width: w, height: h } = el.getBoundingClientRect()
    return {
      scale: v.scale,
      x: Math.min(0, Math.max(w - w * v.scale, v.x)),
      y: Math.min(0, Math.max(h - h * v.scale, v.y)),
    }
  }

  /** Zoom to `scale` keeping the point (px, py) of the box under the same spot. */
  const zoomTo = (scale: number, px?: number, py?: number) => {
    const el = box.current
    if (!el) return
    const v = current.current
    const next = Math.min(MAX, Math.max(MIN, scale))
    const rect = el.getBoundingClientRect()
    const cx = px ?? rect.width / 2
    const cy = py ?? rect.height / 2
    const k = next / v.scale
    setView(clamp({ scale: next, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }))
  }

  // A trackpad pinch arrives as a wheel event with ctrlKey. It has to be a non-passive
  // listener to stop the page from handling it.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect()
      const v = current.current
      if (e.ctrlKey) {
        e.preventDefault()
        zoomTo(v.scale * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top)
      } else if (v.scale > MIN) {
        e.preventDefault()
        setView(clamp({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "+" || e.key === "=") zoomTo(current.current.scale * STEP)
      else if (e.key === "-" || e.key === "_") zoomTo(current.current.scale / STEP)
      else if (e.key === "0") setView(FIT)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const drag = useRef<{ x: number; y: number; view: View } | null>(null)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || view.scale <= MIN) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, view }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    setView(clamp({ ...d.view, x: d.view.x + e.clientX - d.x, y: d.view.y + e.clientY - d.y }))
  }
  const endDrag = () => {
    drag.current = null
  }

  const zoomed = view.scale > MIN

  return (
    <div className="relative">
      <div
        ref={box}
        className={cn("overflow-hidden select-none", zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(e) => {
          if (zoomed) return setView(FIT)
          const rect = e.currentTarget.getBoundingClientRect()
          zoomTo(STEP * STEP, e.clientX - rect.left, e.clientY - rect.top)
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: "0 0" }}
          className={cn("w-full object-contain", className)}
        />
      </div>
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-white/15 bg-black/75 p-0.5 text-white shadow-lg backdrop-blur">
        <Button
          size="icon-sm"
          variant="ghost"
          className="rounded-full text-white hover:bg-white/15 hover:text-white"
          aria-label="Zoom out"
          title="Zoom out (−)"
          disabled={!zoomed}
          onClick={() => zoomTo(view.scale / STEP)}
        >
          <Minus className="size-4" />
        </Button>
        <button
          className="min-w-12 rounded-full px-1.5 py-1 text-center text-xs tabular-nums hover:bg-white/15"
          title="Fit (0)"
          onClick={() => setView(FIT)}
        >
          {Math.round(view.scale * 100)}%
        </button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="rounded-full text-white hover:bg-white/15 hover:text-white"
          aria-label="Zoom in"
          title="Zoom in (+)"
          disabled={view.scale >= MAX}
          onClick={() => zoomTo(view.scale * STEP)}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  )
}
