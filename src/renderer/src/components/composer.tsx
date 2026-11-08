import type React from "react"
import { useEffect, useRef, useState, type PointerEvent } from "react"
import { ArrowUp, FileIcon, ListPlus, Paperclip, TextQuote, X } from "lucide-react"
import type { SendMode } from "@/lib/store"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import type { Attachment } from "@kitab/core/model"
import { bytes } from "@kitab/core/format"
import { Spinner } from "@/components/ui/spinner"
import { withCitations, type Citation } from "@/components/cite-selection"

export type Draft = { file: File; attachment: Attachment }

const SEND_LABELS: Record<SendMode, string> = {
  queue: "Queue: send when the reply finishes",
  interrupt: "Interrupt: stop the reply and send now",
}

export function fileToDraft(file: File): Draft {
  const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file"
  return { file, attachment: { kind, name: file.name, size: file.size, url: URL.createObjectURL(file) } }
}

/** An attachment back in the composer (a message that didn't send, taken back to edit). */
export function attachmentToDraft(attachment: Attachment): Draft {
  return { file: new File([], attachment.name), attachment }
}

const isImage = (d: Draft) => d.attachment.kind === "image"

/**
 * Pasting an image puts `[Image #N]` where you're typing: the Nth image in the message, the
 * order Hermes hands them to the model. The composer draws each tag as a pill and treats it as
 * one character; the pill's × (or Backspace) takes the tag out and keeps the image.
 *
 * In the text box the tag's space is a no-break space, so a tag never wraps across two lines
 * (the pill is drawn over it). It's sent with a plain space.
 */
const imageTag = (n: number) => `[Image\u00a0#${n}]`
const IMAGE_TAG = /\[Image[ \u00a0]#(\d+)\]/g
const plainTags = (text: string) => text.replace(IMAGE_TAG, "[Image #$1]")
const hasTag = (text: string, n: number) => [...text.matchAll(IMAGE_TAG)].some((m) => Number(m[1]) === n)

/** Image `n` was removed: drop its tags and shift later ones down so each still names its picture. */
function dropImageTag(text: string, n: number): string {
  return text
    .replace(new RegExp(`\\[Image[ \\u00a0]#${n}\\] ?`, "g"), "")
    .replace(IMAGE_TAG, (tag, k) => (Number(k) > n ? imageTag(Number(k) - 1) : tag))
}

type Tag = { start: number; end: number; n: number }

/** Tags that name an attached image, where they sit in the text. */
function tagsIn(text: string, images: number): Tag[] {
  return [...text.matchAll(IMAGE_TAG)]
    .map((m) => ({ start: m.index, end: m.index + m[0].length, n: Number(m[1]) }))
    .filter((t) => t.n >= 1 && t.n <= images)
}

const HEIGHT_KEY = "kitab.composerHeight"
const MIN_HEIGHT = 64

function readHeight(): number {
  try {
    return Number(localStorage.getItem(HEIGHT_KEY)) || MIN_HEIGHT
  } catch {
    return MIN_HEIGHT
  }
}

/** Someone the composer can @mention. The token typed is `@id`. */
export type Mentionable = { id: string; name: string; description?: string }

type MentionState = { start: number; end: number; query: string; index: number }

/** The `@word` the caret is in, if any. */
function mentionAt(text: string, caret: number): Omit<MentionState, "index"> | null {
  const m = /(^|[\s(])@([a-z0-9-]*)$/i.exec(text.slice(0, caret))
  if (!m) return null
  const start = caret - m[2].length - 1
  const rest = /^[a-z0-9-]*/i.exec(text.slice(caret))?.[0] ?? ""
  return { start, end: caret + rest.length, query: m[2].toLowerCase() }
}

export function Composer({
  placeholder,
  busy,
  blocked,
  enterSends = "queue",
  drafts,
  setDrafts,
  onSend,
  onStop,
  stopRequested,
  autoFocus,
  extras,
  mentionables = [],
  citations = [],
  setCitations,
  initialText = "",
  onTextChange,
}: {
  placeholder: string
  /** A reply is running: sending queues behind it or interrupts it. */
  busy?: boolean
  /** Sending is held (a message that didn't go is waiting to be retried or taken back). */
  blocked?: boolean
  /** What Enter (and the send button) does while busy; ⌘Enter does the other. */
  enterSends?: SendMode
  drafts: Draft[]
  setDrafts: (fn: (d: Draft[]) => Draft[]) => void
  /** Rejects when the message didn't go; the composer then puts it back. */
  onSend: (text: string, drafts: Draft[], how: SendMode) => Promise<unknown>
  onStop?: () => void
  /** Stop was pressed and the reply hasn't ended yet. */
  stopRequested?: boolean
  autoFocus?: boolean
  /** Controls shown in the bottom bar before the send button (e.g. the model picker). */
  extras?: React.ReactNode
  /** Typing @ offers these. */
  mentionables?: Mentionable[]
  /** Passages cited from the thread; sent as quotes ahead of the text. */
  citations?: Citation[]
  setCitations?: (fn: (c: Citation[]) => Citation[]) => void
  /** Unsent text from last time, and where to keep it. */
  initialText?: string
  onTextChange?: (text: string) => void
}) {
  const [text, setText] = useState(initialText)
  const [minHeight, setMinHeight] = useState(readHeight)
  const [mention, setMention] = useState<MentionState | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  const options = mention
    ? mentionables.filter(
        (p) => p.id.startsWith(mention.query) || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(mention.query)),
      )
    : []
  const choosing = mention !== null && options.length > 0

  const trackMention = (el: HTMLTextAreaElement) => {
    const found = mentionables.length ? mentionAt(el.value, el.selectionStart) : null
    setMention((prev) => (found ? { ...found, index: prev?.query === found.query ? prev.index : 0 } : null))
  }

  const pick = (p: Mentionable) => {
    if (!mention) return
    const insert = `@${p.id} `
    const next = text.slice(0, mention.start) + insert + text.slice(mention.end).replace(/^ /, "")
    const caret = mention.start + insert.length
    setText(next)
    setMention(null)
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(caret, caret)
    })
  }

  // Through the editor, so ⌘Z takes it back out.
  const insertAtCaret = (s: string) => {
    const el = input.current
    if (!el) return
    const start = el.selectionStart
    const before = el.value.slice(0, start)
    const after = el.value.slice(el.selectionEnd)
    const insert = (before && !/\s$/.test(before) ? " " : "") + s + (/^\s/.test(after) ? "" : " ")
    el.focus()
    if (!document.execCommand("insertText", false, insert)) {
      setText(before + insert + after)
      const caret = start + insert.length
      requestAnimationFrame(() => el.setSelectionRange(caret, caret))
    }
  }

  const removeDraft = (i: number) => {
    if (isImage(drafts[i])) {
      const n = drafts.slice(0, i).filter(isImage).length + 1
      setText((t) => dropImageTag(t, n))
    }
    setDrafts((all) => all.filter((_, j) => j !== i))
  }

  const imageCount = drafts.filter(isImage).length
  const tags = tagsIn(text, imageCount)
  const mirror = useRef<HTMLDivElement>(null)
  const lastCaret = useRef(0)

  // Through the editor, so ⌘Z puts it back.
  const deleteRange = (start: number, end: number) => {
    const el = input.current
    if (!el) return
    el.focus()
    el.setSelectionRange(start, end)
    if (!document.execCommand("delete")) {
      setText(el.value.slice(0, start) + el.value.slice(end))
      requestAnimationFrame(() => el.setSelectionRange(start, start))
    }
  }

  /** The pill's ×: the tag and one space next to it go; the image stays attached. */
  const removeTag = (t: Tag) => {
    const v = input.current?.value ?? text
    if (v[t.end] === " ") deleteRange(t.start, t.end + 1)
    else if (t.start > 0 && v[t.start - 1] === " ") deleteRange(t.start - 1, t.end)
    else deleteRange(t.start, t.end)
  }

  // A tag is one unit: the caret steps over it, and a selection takes all of it or none.
  const snapToTags = (el: HTMLTextAreaElement) => {
    const found = tagsIn(el.value, imageCount)
    let a = el.selectionStart
    let b = el.selectionEnd
    if (a === b) {
      const t = found.find((t) => a > t.start && a < t.end)
      if (t) {
        const prev = lastCaret.current
        a = b = prev <= t.start ? t.end : prev >= t.end ? t.start : a - t.start < t.end - a ? t.start : t.end
        el.setSelectionRange(a, b)
      }
      lastCaret.current = a
      return
    }
    for (const t of found) {
      if (a > t.start && a < t.end) a = t.start
      if (b > t.start && b < t.end) b = t.end
    }
    if (a !== el.selectionStart || b !== el.selectionEnd) el.setSelectionRange(a, b, el.selectionDirection)
  }
  const snap = useRef(snapToTags)
  snap.current = snapToTags
  // React's onSelect misses caret moves from the arrow keys; Chromium fires selectionchange on the box itself.
  useEffect(() => {
    const el = input.current
    if (!el) return
    const onChange = () => document.activeElement === el && snap.current(el)
    el.addEventListener("selectionchange", onChange)
    return () => el.removeEventListener("selectionchange", onChange)
  }, [])

  const textChanged = useRef(onTextChange)
  textChanged.current = onTextChange
  useEffect(() => textChanged.current?.(text), [text])

  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])

  // A new citation means you're about to write about it.
  const cited = useRef(citations.length)
  useEffect(() => {
    if (citations.length > cited.current) input.current?.focus()
    cited.current = citations.length
  }, [citations.length])

  // While a reply runs, Enter does `enterSends` and ⌘Enter the other.
  const canSend = !blocked && (text.trim().length > 0 || drafts.length > 0 || citations.length > 0)
  const otherMode: SendMode = enterSends === "queue" ? "interrupt" : "queue"
  const send = async (how: SendMode = enterSends) => {
    if (!canSend) return
    const saved = { text, drafts, citations }
    setCitations?.(() => [])
    setDrafts(() => [])
    setText("")
    setMention(null)
    try {
      await onSend(withCitations(plainTags(text).trim(), citations), drafts, how)
    } catch {
      // It didn't go (e.g. Hermes is disconnected): put it all back to edit, copy or resend.
      // Anything typed since stays, after it.
      setText((now) => (now.trim() ? `${saved.text.trimEnd()}\n\n${now}` : saved.text))
      setDrafts((now) => [...saved.drafts, ...now])
      setCitations?.((now) => [...saved.citations, ...now])
    }
  }

  const saveHeight = (h: number) => {
    setMinHeight(h)
    try {
      localStorage.setItem(HEIGHT_KEY, String(Math.round(h)))
    } catch {}
  }

  // Dragging the handle up makes the text area taller.
  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const startY = e.clientY
    const start = minHeight
    let next = start
    const move = (ev: globalThis.PointerEvent) => {
      next = Math.min(Math.max(start + startY - ev.clientY, MIN_HEIGHT), window.innerHeight * 0.6)
      setMinHeight(next)
    }
    const up = () => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      saveHeight(next)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
  }

  const showStop = busy && onStop && !canSend

  return (
    <div className="relative flex flex-col items-center gap-1.5">
      {choosing && (
        <div
          role="listbox"
          aria-label="Personalities"
          className="absolute inset-x-0 bottom-full z-20 mb-2 flex max-h-64 flex-col overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {options.map((p, i) => (
            <button
              key={p.id}
              role="option"
              aria-selected={i === Math.min(mention.index, options.length - 1)}
              className="flex items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              onMouseDown={(e) => {
                e.preventDefault()
                pick(p)
              }}
              onMouseEnter={() => setMention((m) => (m ? { ...m, index: i } : m))}
            >
              <span className="font-medium">{p.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">@{p.id}</span>
              {p.description && <span className="min-w-0 truncate text-xs text-muted-foreground">{p.description}</span>}
            </button>
          ))}
        </div>
      )}
      <div
        className="flex w-full cursor-text flex-col gap-2 rounded-2xl border border-input/60 bg-composer p-3 shadow-lg shadow-black/5 backdrop-blur-xl dark:shadow-black/20"
        onClick={(e) => {
          if (e.target === e.currentTarget) input.current?.focus()
        }}
      >
        {citations.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {citations.map((c) => (
              <CitationChip
                key={c.id}
                citation={c}
                onRemove={() => setCitations?.((all) => all.filter((x) => x.id !== c.id))}
              />
            ))}
          </div>
        )}
        {drafts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {drafts.map((d, i) => {
              const n = isImage(d) ? drafts.slice(0, i).filter(isImage).length + 1 : undefined
              return (
                <DraftTile
                  key={d.attachment.url}
                  draft={d}
                  number={n && (imageCount > 1 || hasTag(text, n)) ? n : undefined}
                  onRemove={() => removeDraft(i)}
                />
              )
            })}
          </div>
        )}
        <div className="relative">
        <textarea
          ref={input}
          rows={1}
          value={text}
          placeholder={placeholder}
          // With pills, the copy laid over the box draws the text; the box keeps the caret and selection.
          // Inline, not text-transparent: cn() would drop text-prompt (the size) as a clashing text-* class.
          style={{ minHeight, ...(tags.length > 0 && { color: "transparent", caretColor: "var(--foreground)" }) }}
          className="block field-sizing-content max-h-[40vh] w-full resize-none bg-transparent px-1 font-composer text-prompt leading-relaxed outline-none placeholder:text-placeholder"
          onChange={(e) => {
            setText(e.target.value)
            trackMention(e.target)
          }}
          onSelect={(e) => trackMention(e.currentTarget)}
          onScroll={(e) => {
            if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop
          }}
          onBlur={() => setMention(null)}
          onKeyDown={(e) => {
            if ((e.key === "Backspace" || e.key === "Delete") && !e.metaKey) {
              const el = e.currentTarget
              const p = el.selectionStart
              const t =
                p === el.selectionEnd &&
                tags.find((t) => (e.key === "Backspace" ? t.end === p : t.start === p))
              if (t) {
                e.preventDefault()
                deleteRange(t.start, t.end)
                return
              }
            }
            if (choosing && !e.nativeEvent.isComposing) {
              const n = options.length
              const index = Math.min(mention.index, n - 1)
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault()
                setMention({ ...mention, index: (index + (e.key === "ArrowDown" ? 1 : n - 1)) % n })
                return
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault()
                pick(options[index])
                return
              }
              if (e.key === "Escape") {
                e.preventDefault()
                e.stopPropagation()
                setMention(null)
                return
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send(e.metaKey || e.ctrlKey ? otherMode : enterSends)
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            if (!files.length) return
            e.preventDefault()
            const added = files.map(fileToDraft)
            const first = imageCount + 1
            const tags = added.filter(isImage).map((_, k) => imageTag(first + k))
            setDrafts((d) => [...d, ...added])
            if (tags.length) insertAtCaret(tags.join(" "))
          }}
        />
        {tags.length > 0 && (
          <div
            ref={mirror}
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden px-1 font-composer text-prompt leading-relaxed break-words whitespace-pre-wrap"
          >
            {withPills(text, tags, removeTag)}
            {/* Keeps a trailing newline's empty line, as the text box has it. */}
            {"\u200b"}
          </div>
        )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label="Attach files"
            title="Attach files"
            onClick={() => picker.current?.click()}
          >
            <Paperclip className="size-4.5" />
          </Button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              setDrafts((d) => [...d, ...files.map(fileToDraft)])
              e.target.value = ""
            }}
          />
          <div className="ml-auto flex items-center gap-2">
            {extras}
            {showStop ? (
              <Button
                size="icon-lg"
                variant="destructive"
                className="rounded-full bg-destructive text-white shadow-sm hover:bg-destructive/90 disabled:opacity-70"
                aria-label={stopRequested ? "Stopping…" : "Stop"}
                title={stopRequested ? "Stopping…" : "Stop"}
                disabled={stopRequested}
                onClick={onStop}
              >
                {stopRequested ? <Spinner className="size-4.5" /> : <span className="size-3 rounded-[3px] bg-current" />}
              </Button>
            ) : (
              <Button
                size="icon-lg"
                className="rounded-full shadow-sm"
                aria-label={busy ? SEND_LABELS[enterSends] : "Send"}
                title={busy ? `${SEND_LABELS[enterSends]} (↵) · ${SEND_LABELS[otherMode]} (⌘↵)` : "Send"}
                disabled={!canSend}
                onClick={(e) => void send(e.metaKey || e.ctrlKey ? otherMode : enterSends)}
              >
                {busy && enterSends === "queue" ? <ListPlus className="size-4.5" /> : <ArrowUp className="size-4.5" />}
              </Button>
            )}
          </div>
        </div>
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize composer"
        title="Drag to resize · double-click to reset"
        onPointerDown={startResize}
        onDoubleClick={() => saveHeight(MIN_HEIGHT)}
        className="app-no-drag h-1.5 w-10 shrink-0 cursor-row-resize rounded-full border border-input hover:bg-muted"
      />
    </div>
  )
}

/**
 * The composer's text with each tag drawn as a pill. The tag's own text stays in place,
 * invisible, so every line wraps exactly as it does in the text box underneath.
 */
function withPills(text: string, tags: Tag[], onRemove: (t: Tag) => void): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let at = 0
  for (const t of tags) {
    if (t.start > at) out.push(text.slice(at, t.start))
    out.push(
      <span key={t.start} className="relative">
        <span className="invisible">{text.slice(t.start, t.end)}</span>
        <span className="absolute -inset-x-0.5 -inset-y-px flex items-center justify-between gap-0.5 overflow-hidden rounded-md bg-muted pr-0.5 pl-1.5 font-sans text-xs font-medium whitespace-nowrap text-foreground ring-1 ring-border">
          <span className="truncate">Image #{t.n}</span>
          <button
            type="button"
            tabIndex={-1}
            title="Remove from text (keeps the image)"
            className="pointer-events-auto flex size-3.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            // Keeps focus (and the caret) in the text box.
            onMouseDown={(e) => {
              e.preventDefault()
              onRemove(t)
            }}
          >
            <X className="size-3" />
          </button>
        </span>
      </span>,
    )
    at = t.end
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}

function CitationChip({ citation: c, onRemove }: { citation: Citation; onRemove: () => void }) {
  return (
    <div className="group relative flex max-w-80 min-w-0 items-start gap-2 rounded-xl border bg-surface-raised px-3 py-2 text-xs">
      <TextQuote className="mt-px size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0" title={c.text}>
        <div className="line-clamp-2 text-muted-foreground">{c.text}</div>
        {c.comment.trim() && <div className="mt-0.5 line-clamp-2">{c.comment.trim()}</div>}
      </div>
      <button
        aria-label="Remove citation"
        title="Remove"
        className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-white/15 bg-black/85 text-white shadow-sm hover:bg-black"
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

function DraftTile({ draft: d, number, onRemove }: { draft: Draft; number?: number; onRemove: () => void }) {
  const a = d.attachment
  return (
    <div className="relative">
      {a.kind === "image" ? (
        <img src={a.url} alt={a.name} className="size-16 rounded-xl border object-cover" />
      ) : a.kind === "video" ? (
        <video src={a.url} className="size-16 rounded-xl border object-cover" muted />
      ) : (
        <div className="flex h-16 max-w-52 items-center gap-2 rounded-xl border bg-surface-raised px-3 text-xs">
          <FileIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate">{a.name}</div>
            <div className="text-muted-foreground">{bytes(a.size)}</div>
          </div>
        </div>
      )}
      {number !== undefined && (
        <span className="absolute bottom-1 left-1 rounded-md bg-black/70 px-1 font-mono text-[10px] leading-4 text-white">
          #{number}
        </span>
      )}
      <button
        aria-label={`Remove ${a.name}`}
        title="Remove"
        className={cn(
          "absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-white/15 bg-black/85 text-white shadow-sm hover:bg-black",
        )}
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
