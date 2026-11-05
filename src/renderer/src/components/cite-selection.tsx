import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import { TextQuote } from "lucide-react"
import { Button } from "@/components/ui/button"

/** A passage quoted from the thread, with what you want to say about it. */
export type Citation = { id: string; text: string; comment: string }

/** Prepends citations to a message as markdown quotes, each followed by its comment. */
export function withCitations(text: string, citations: Citation[]): string {
  const blocks = citations.map((c) => {
    const quote = c.text
      .split("\n")
      .map((line) => (line.trim() ? `> ${line}` : ">"))
      .join("\n")
    return c.comment.trim() ? `${quote}\n\n${c.comment.trim()}` : quote
  })
  return [...blocks, text].filter(Boolean).join("\n\n")
}

// While the comment box has focus the page selection is gone; this paints it instead.
const HIGHLIGHT = "kitab-cite"

function paint(range: Range | null) {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return
  if (range) CSS.highlights.set(HIGHLIGHT, new Highlight(range))
  else CSS.highlights.delete(HIGHLIGHT)
}

/** The selection inside `root`, if it covers readable text. */
function selectionIn(root: HTMLElement): Range | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  if (!start?.closest(".selectable")) return null
  return sel.toString().trim() ? range : null
}

/** Where the selection ends on screen: the last line it touches. */
function endOf(range: Range): DOMRect | null {
  const rects = [...range.getClientRects()].filter((r) => r.width > 0)
  return rects.at(-1) ?? null
}

/**
 * Selecting text in the thread offers "Cite"; that opens a box for an optional
 * comment, and saving hands the passage and comment to the composer.
 */
export function CiteSelection({ root, onCite }: { root: RefObject<HTMLElement | null>; onCite: (c: Citation) => void }) {
  const [range, setRange] = useState<Range | null>(null)
  const [editing, setEditing] = useState<{ range: Range; text: string } | null>(null)
  const [, setTick] = useState(0)

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
    if (!el || (!range && !editing)) return
    const move = () => setTick((t) => t + 1)
    el.addEventListener("scroll", move, { passive: true })
    window.addEventListener("resize", move)
    return () => {
      el.removeEventListener("scroll", move)
      window.removeEventListener("resize", move)
    }
  }, [root, range, editing])

  useEffect(() => {
    paint(editing?.range ?? null)
    return () => paint(null)
  }, [editing])

  const close = () => setEditing(null)

  if (editing) {
    const rect = endOf(editing.range)
    return rect
      ? createPortal(
          <CommentBox
            anchor={rect}
            onCancel={close}
            onSave={(comment) => {
              onCite({ id: crypto.randomUUID(), text: editing.text, comment })
              close()
            }}
          />,
          document.body,
        )
      : null
  }

  const rect = range && endOf(range)
  if (!range || !rect) return null
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
        if (!text) return
        setEditing({ range: range.cloneRange(), text })
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
