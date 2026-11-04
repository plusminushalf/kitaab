import type React from "react"
import { useEffect, useRef, useState, type PointerEvent } from "react"
import { ArrowUp, FileIcon, ListPlus, Paperclip, X } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import type { Attachment } from "@/lib/model"
import { bytes } from "@/lib/format"

export type Draft = { file: File; attachment: Attachment }

export function fileToDraft(file: File): Draft {
  const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file"
  return { file, attachment: { kind, name: file.name, size: file.size, url: URL.createObjectURL(file) } }
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
  drafts,
  setDrafts,
  onSend,
  onStop,
  autoFocus,
  extras,
  mentionables = [],
}: {
  placeholder: string
  busy?: boolean
  drafts: Draft[]
  setDrafts: (fn: (d: Draft[]) => Draft[]) => void
  onSend: (text: string, drafts: Draft[]) => void
  onStop?: () => void
  autoFocus?: boolean
  /** Controls shown in the bottom bar before the send button (e.g. the model picker). */
  extras?: React.ReactNode
  /** Typing @ offers these. */
  mentionables?: Mentionable[]
}) {
  const [text, setText] = useState("")
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

  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])

  // Sending while a reply runs is fine: Hermes queues or steers it.
  const canSend = text.trim().length > 0 || drafts.length > 0
  const send = () => {
    if (!canSend) return
    onSend(text.trim(), drafts)
    setText("")
    setMention(null)
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

  const stopping = busy && onStop && !canSend

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
        {drafts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {drafts.map((d, i) => (
              <DraftTile key={d.attachment.url} draft={d} onRemove={() => setDrafts((all) => all.filter((_, j) => j !== i))} />
            ))}
          </div>
        )}
        <textarea
          ref={input}
          rows={1}
          value={text}
          placeholder={placeholder}
          style={{ minHeight }}
          className="field-sizing-content max-h-[40vh] w-full resize-none bg-transparent px-1 font-composer text-prompt leading-relaxed outline-none placeholder:text-placeholder"
          onChange={(e) => {
            setText(e.target.value)
            trackMention(e.target)
          }}
          onSelect={(e) => trackMention(e.currentTarget)}
          onBlur={() => setMention(null)}
          onKeyDown={(e) => {
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
              send()
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            if (files.length) {
              e.preventDefault()
              setDrafts((d) => [...d, ...files.map(fileToDraft)])
            }
          }}
        />
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
            {stopping ? (
              <Button
                size="icon-lg"
                variant="destructive"
                className="rounded-full bg-destructive text-white shadow-sm hover:bg-destructive/90"
                aria-label="Stop"
                title="Stop"
                onClick={onStop}
              >
                <span className="size-3 rounded-[3px] bg-current" />
              </Button>
            ) : (
              <Button
                size="icon-lg"
                className="rounded-full shadow-sm"
                aria-label={busy ? "Send now (queues behind the current reply)" : "Send"}
                title={busy ? "Send (steers the running reply)" : "Send"}
                disabled={!canSend}
                onClick={send}
              >
                {busy ? <ListPlus className="size-4.5" /> : <ArrowUp className="size-4.5" />}
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

function DraftTile({ draft: d, onRemove }: { draft: Draft; onRemove: () => void }) {
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
