import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import { TextQuote } from "lucide-react"
import { Button } from "@/components/ui/button"

/** An image from the thread, cited. `path` is where it lives on the Hermes server, when it does. */
export type CitedImage = { name: string; url: string; path?: string }

/** A passage (text, images or both) quoted from the thread, with what you want to say about it. */
export type Citation = { id: string; text: string; comment: string; images?: CitedImage[] }

/**
 * Prepends citations to a message as markdown quotes, each followed by its comment. A cited
 * image is sent attached, after the composer's own images, and its quote names it as
 * `[Image #N]` counting from `firstImage`.
 */
export function withCitations(text: string, citations: Citation[], firstImage = 1): string {
  let n = firstImage
  const blocks = citations.map((c) => {
    const lines = c.text ? c.text.split("\n") : []
    const refs = (c.images ?? []).map(() => `[Image #${n++}]`)
    if (refs.length) lines.push(refs.join(" "))
    const quote = lines.map((line) => (line.trim() ? `> ${line}` : ">")).join("\n")
    return c.comment.trim() ? `${quote}\n\n${c.comment.trim()}` : quote
  })
  return [...blocks, text].filter(Boolean).join("\n\n")
}

/** Every cited image, in the order withCitations numbers them. */
export const citedImages = (citations: Citation[]) => citations.flatMap((c) => c.images ?? [])

/**
 * Marks a thread image as citable. Only images Kitaab can hand to Hermes qualify: ones on the
 * server (by path), and ones on this Mac (blob: or data:). A web image would need downloading.
 */
export function citable(name: string, path?: string, url?: string): Record<string, string> {
  if (!path && !/^(blob|data):/.test(url ?? "")) return {}
  return { "data-cite": "", "data-cite-name": name, ...(path && { "data-cite-path": path }) }
}

const CITABLE = "img[data-cite]"

function toCited(img: HTMLImageElement): CitedImage {
  return { name: img.dataset.citeName || "image", url: img.currentSrc || img.src, path: img.dataset.citePath || undefined }
}

/** Citable images the selection runs across. */
function imagesIn(root: HTMLElement, range: Range): CitedImage[] {
  return [...root.querySelectorAll<HTMLImageElement>(CITABLE)].filter((img) => range.intersectsNode(img)).map(toCited)
}

// While the comment box has focus the page selection is gone; this paints it instead.
const HIGHLIGHT = "kitab-cite"

function paint(range: Range | null) {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return
  if (range) CSS.highlights.set(HIGHLIGHT, new Highlight(range))
  else CSS.highlights.delete(HIGHLIGHT)
}

/** The selection inside `root`, if it covers readable text or a citable image. */
function selectionIn(root: HTMLElement): Range | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  if (imagesIn(root, range).length) return range
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  if (!start?.closest(".selectable")) return null
  return sel.toString().trim() ? range : null
}

/** Where the selection ends on screen: the last line it touches. */
function endOf(range: Range): DOMRect | null {
  const rects = [...range.getClientRects()].filter((r) => r.width > 0)
  return rects.at(-1) ?? null
}

/** What's being cited while the comment box is open: a selection, or one image. */
type Editing = { text: string; images: CitedImage[] } & ({ range: Range; image?: never } | { image: HTMLImageElement; range?: never })

/**
 * Selecting text (and any images in it) in the thread offers "Cite", and so does hovering an
 * image; that opens a box for an optional comment, and saving hands it all to the composer.
 */
export function CiteSelection({ root, onCite }: { root: RefObject<HTMLElement | null>; onCite: (c: Citation) => void }) {
  const [range, setRange] = useState<Range | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [hovered, setHovered] = useState<HTMLImageElement | null>(null)
  const leaving = useRef<number | undefined>(undefined)
  const [, setTick] = useState(0)

  // Hovering a citable image offers Cite in its corner. A short grace period lets the
  // pointer move from the image onto the button.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const over = (e: MouseEvent) => {
      const img = (e.target as Element | null)?.closest?.<HTMLImageElement>(CITABLE)
      if (!img) return
      window.clearTimeout(leaving.current)
      setHovered(img)
    }
    const out = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.(CITABLE)) return
      window.clearTimeout(leaving.current)
      leaving.current = window.setTimeout(() => setHovered(null), 150)
    }
    el.addEventListener("mouseover", over)
    el.addEventListener("mouseout", out)
    return () => {
      el.removeEventListener("mouseover", over)
      el.removeEventListener("mouseout", out)
      window.clearTimeout(leaving.current)
    }
  }, [root])

  // Follow the selection: show Cite once you let go of the mouse (or Shift+arrows).
  useEffect(() => {
    const el = root.current
    if (!el) return
    const check = () => setRange(selectionIn(el))
    const onUp = () => requestAnimationFrame(check)
    const onChange = () => {
      if (!selectionIn(el)) setRange(null)
    }
    document.addEventListener("pointerup", onUp)
    document.addEventListener("keyup", onUp)
    document.addEventListener("selectionchange", onChange)
    return () => {
      document.removeEventListener("pointerup", onUp)
      document.removeEventListener("keyup", onUp)
      document.removeEventListener("selectionchange", onChange)
    }
  }, [root])

  // Stay attached to the text as the thread scrolls or the window resizes.
  useEffect(() => {
    const el = root.current
    if (!el || (!range && !editing && !hovered)) return
    const move = () => setTick((t) => t + 1)
    el.addEventListener("scroll", move, { passive: true })
    window.addEventListener("resize", move)
    return () => {
      el.removeEventListener("scroll", move)
      window.removeEventListener("resize", move)
    }
  }, [root, range, editing, hovered])

  // Mark what's being cited: the selection, or the image.
  useEffect(() => {
    paint(editing?.range ?? null)
    editing?.image?.setAttribute("data-citing", "")
    return () => {
      paint(null)
      editing?.image?.removeAttribute("data-citing")
    }
  }, [editing])

  const close = () => setEditing(null)

  if (editing) {
    const rect = editing.range ? endOf(editing.range) : editing.image.getBoundingClientRect()
    return rect
      ? createPortal(
          <CommentBox
            anchor={rect}
            onCancel={close}
            onSave={(comment) => {
              onCite({ id: crypto.randomUUID(), text: editing.text, comment, images: editing.images })
              close()
            }}
          />,
          document.body,
        )
      : null
  }

  const rect = range && endOf(range)
  if (!range || !rect) {
    const box = hovered?.isConnected ? hovered.getBoundingClientRect() : null
    if (!hovered || !box || box.width < 48 || box.height < 32) return null
    return createPortal(
      <Button
        size="xs"
        variant="outline"
        className="fixed z-50 bg-popover shadow-md backdrop-blur-xl"
        style={{ top: box.top + 6, left: Math.max(8, box.right - 64) }}
        onMouseEnter={() => window.clearTimeout(leaving.current)}
        onMouseLeave={() => (leaving.current = window.setTimeout(() => setHovered(null), 150))}
        onClick={() => {
          setEditing({ image: hovered, text: "", images: [toCited(hovered)] })
          setHovered(null)
        }}
      >
        <TextQuote />
        Cite
      </Button>,
      document.body,
    )
  }
  return createPortal(
    <Button
      size="xs"
      variant="outline"
      className="fixed z-50 bg-popover shadow-md backdrop-blur-xl"
      style={{ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.right - 32, window.innerWidth - 80)) }}
      // Keep the selection: a plain click would collapse it before we read it.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const text = window.getSelection()?.toString().trim() ?? ""
        const images = root.current ? imagesIn(root.current, range) : []
        if (!text && !images.length) return
        setEditing({ range: range.cloneRange(), text, images })
        setRange(null)
      }}
    >
      <TextQuote />
      Cite
    </Button>,
    document.body,
  )
}

const BOX_WIDTH = 360
const BOX_HEIGHT = 120

function CommentBox({
  anchor,
  onSave,
  onCancel,
}: {
  anchor: DOMRect
  onSave: (comment: string) => void
  onCancel: () => void
}) {
  const [comment, setComment] = useState("")
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    input.current?.focus()
    window.getSelection()?.removeAllRanges()
  }, [])

  // Clicking elsewhere or pressing Escape drops it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onCancel()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
    document.addEventListener("pointerdown", onDown, true)
    window.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      window.removeEventListener("keydown", onKey, true)
    }
  }, [onCancel])

  // Below the selection, or above it when there's no room.
  const below = anchor.bottom + 8 + BOX_HEIGHT < window.innerHeight
  const top = below ? anchor.bottom + 8 : Math.max(8, anchor.top - 8 - BOX_HEIGHT)
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - BOX_WIDTH - 8))

  return (
    <div
      ref={box}
      data-slot="popover-content"
      className="fixed z-50 flex flex-col gap-2 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
      style={{ top, left, width: BOX_WIDTH }}
    >
      <textarea
        ref={input}
        rows={2}
        value={comment}
        placeholder="Add an optional comment…"
        aria-label="Comment on the cited text"
        className="field-sizing-content max-h-40 w-full resize-none bg-transparent text-sm outline-none placeholder:text-placeholder"
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            onSave(comment)
          }
        }}
      />
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(comment)}>
          Save
        </Button>
      </div>
    </div>
  )
}
