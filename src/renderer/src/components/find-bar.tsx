import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { ChevronDown, ChevronUp, X } from "lucide-react"
import { Button } from "@/components/ui/button"

// Painted with the CSS Custom Highlight API, so the thread's DOM is never touched.
const ALL = "kitab-find"
const CURRENT = "kitab-find-current"

const supported = typeof CSS !== "undefined" && "highlights" in CSS

function paint(ranges: Range[], current: number) {
  if (!supported) return
  if (!ranges.length) return clearPaint()
  CSS.highlights.set(ALL, new Highlight(...ranges))
  const now = new Highlight(ranges[current])
  now.priority = 1
  CSS.highlights.set(CURRENT, now)
}

function clearPaint() {
  if (!supported) return
  CSS.highlights.delete(ALL)
  CSS.highlights.delete(CURRENT)
}

/**
 * Every match of `query` in the text under `root`, ignoring case. The text nodes are read as
 * one string, so a match can run across formatting (bold, links, highlighted code).
 */
function findAll(root: HTMLElement, query: string): Range[] {
  if (!query) return []
  const nodes: Text[] = []
  const starts: number[] = []
  let text = ""
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    if (!t.data) continue
    nodes.push(t)
    starts.push(text.length)
    text += t.data
  }

  // Maps an offset in the joined string to its text node; offsets only grow, so the cursor does too.
  let at = 0
  const locate = (offset: number, end: boolean): [Text, number] => {
    while (at < nodes.length - 1 && (end ? starts[at + 1] < offset : starts[at + 1] <= offset)) at++
    return [nodes[at], offset - starts[at]]
  }

  const ranges: Range[] = []
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const range = document.createRange()
    range.setStart(...locate(m.index, false))
    range.setEnd(...locate(m.index + m[0].length, true))
    ranges.push(range)
  }
  return ranges
}

/** Scrolls `root` so the range sits in the middle third of the view, if it isn't already visible. */
function reveal(root: HTMLElement, range: Range) {
  const r = range.getBoundingClientRect()
  const view = root.getBoundingClientRect()
  if (r.top >= view.top + 24 && r.bottom <= view.bottom - 24) return
  root.scrollTop += r.top - view.top - view.height / 3
}

/** The first match at or below the top of the view, so a new search starts where you're reading. */
function firstVisible(root: HTMLElement, ranges: Range[]): number {
  const top = root.getBoundingClientRect().top
  const i = ranges.findIndex((r) => r.getBoundingClientRect().bottom >= top)
  return i === -1 ? 0 : i
}

/**
 * ⌘F in a thread: a small bar over the top right of the messages. Enter and ⌘G go to the next
 * match, Shift+Enter and ⇧⌘G to the previous one, Escape closes it. Matches follow the thread
 * as it streams; text inside a collapsed work log isn't on the page, so it isn't searched.
 */
export function FindBar({
  root,
  focusSignal,
  onClose,
}: {
  root: RefObject<HTMLElement | null>
  /** Changes each time ⌘F is pressed, to focus and select the field again. */
  focusSignal: number
  onClose: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [ranges, setRanges] = useState<Range[]>([])
  const [current, setCurrent] = useState(0)
  // Read by the DOM observer without re-subscribing it on every keystroke.
  const state = useRef({ query, current })
  state.current = { query, current }

  useLayoutEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusSignal])

  // A new query: search, and go to the first match from where you're reading.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const found = findAll(el, query)
    const i = found.length ? firstVisible(el, found) : 0
    setRanges(found)
    setCurrent(i)
    if (found.length) reveal(el, found[i])
  }, [query, root])

  // The thread changes under the bar (streaming, a work log opened): search again, staying put.
  useEffect(() => {
    const el = root.current
    if (!el) return
    let frame = 0
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const { query, current } = state.current
        const found = findAll(el, query)
        setRanges(found)
        setCurrent(Math.min(current, Math.max(found.length - 1, 0)))
      })
    })
    observer.observe(el, { subtree: true, childList: true, characterData: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [root])

  useEffect(() => paint(ranges, current), [ranges, current])
  useEffect(() => clearPaint, [])

  const step = useCallback(
    (by: 1 | -1) => {
      const el = root.current
      if (!el || !ranges.length) return
      const next = (current + by + ranges.length) % ranges.length
      setCurrent(next)
      reveal(el, ranges[next])
    },
    [current, ranges, root],
  )

  useEffect(
    () =>
      window.hermes.onMenu((command) => {
        if (command === "find-next") step(1)
        else if (command === "find-previous") step(-1)
      }),
    [step],
  )

  return (
    <div
      role="search"
      className="absolute top-2 right-[calc(var(--details-w,0px)+1rem)] z-20 flex items-center gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <input
        ref={input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          } else if (e.key === "Escape") {
            // Don't let it reach the window too, where Escape also closes the file panel.
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
        placeholder="Find in thread"
        aria-label="Find in thread"
        spellCheck={false}
        className="h-7 w-48 min-w-0 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
      />
      <span className="min-w-12 px-1 text-right text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {query ? (ranges.length ? `${current + 1}/${ranges.length}` : "0/0") : ""}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Previous match"
        title="Previous match (⇧⌘G)"
        disabled={!ranges.length}
        onClick={() => step(-1)}
      >
        <ChevronUp />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Next match"
        title="Next match (⌘G)"
        disabled={!ranges.length}
        onClick={() => step(1)}
      >
        <ChevronDown />
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="Close" title="Close (Esc)" onClick={onClose}>
        <X />
      </Button>
    </div>
  )
}
