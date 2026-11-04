import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { FileIcon, FileImage, FileSpreadsheet, FileText, FileVideo } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import type { Attachment, Message, Personality } from "@kitab/core/model"
import { bytes } from "@kitab/core/format"
import { Markdown } from "@/components/markdown"
import { WorkLog } from "@/components/work-log"

export function MessageList({
  messages,
  personalities,
  onOpenFile,
  openFile,
}: {
  messages: Message[]
  personalities: Personality[]
  /** Opens a non-media attachment in the side panel. */
  onOpenFile: (a: Attachment) => void
  openFile?: Attachment | null
}) {
  const list = useRef<HTMLDivElement>(null)
  // Whether to follow new content. Scrolling up lets go; scrolling back to the bottom takes hold again.
  const pinned = useRef(true)
  const [viewing, setViewing] = useState<Attachment | null>(null)
  const last = messages.at(-1)

  useLayoutEffect(() => {
    const root = list.current?.closest<HTMLElement>("[data-scroll-root]")
    if (!root || !list.current) return
    const follow = () => {
      if (pinned.current) root.scrollTop = root.scrollHeight
    }
    let lastTop = root.scrollTop
    const onScroll = () => {
      const fromBottom = root.scrollHeight - root.scrollTop - root.clientHeight
      if (fromBottom < 8) pinned.current = true
      else if (root.scrollTop < lastTop) pinned.current = false
      lastTop = root.scrollTop
    }
    // A wheel or trackpad flick upward lets go at once, before new content can pull the view back down.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && root.scrollHeight > root.clientHeight) pinned.current = false
    }
    follow()
    root.addEventListener("scroll", onScroll, { passive: true })
    root.addEventListener("wheel", onWheel, { passive: true })
    // Content grows while streaming (and when images load); the viewport shrinks as the composer grows.
    const resized = new ResizeObserver(follow)
    resized.observe(list.current)
    resized.observe(root)
    return () => {
      root.removeEventListener("scroll", onScroll)
      root.removeEventListener("wheel", onWheel)
      resized.disconnect()
    }
  }, [])

  // Sending a message brings you back to the bottom.
  useEffect(() => {
    if (last?.role !== "user") return
    pinned.current = true
    const root = list.current?.closest<HTMLElement>("[data-scroll-root]")
    if (root) root.scrollTop = root.scrollHeight
  }, [last?.id, last?.role])

  return (
    <div ref={list} className="mx-auto flex w-full max-w-chat min-w-0 flex-col gap-6 px-6 py-6">
      {messages.map((m) => (
        <MessageRow
          key={m.id}
          message={m}
          author={personalities.find((p) => p.id === m.personalityId)?.name}
          onView={setViewing}
          onOpenFile={onOpenFile}
          openFile={openFile}
        />
      ))}
      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-[90vw] sm:max-w-[90vw]">
          <DialogTitle className="truncate">{viewing?.name}</DialogTitle>
          {viewing?.kind === "image" && (
            <img src={viewing.url} alt={viewing.name} className="max-h-[80vh] w-full object-contain" />
          )}
          {viewing?.kind === "video" && <video src={viewing.url} controls autoPlay className="max-h-[80vh] w-full" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MessageRow({
  message: m,
  author,
  onView,
  onOpenFile,
  openFile,
}: {
  message: Message
  author?: string
  onView: (a: Attachment) => void
  onOpenFile: (a: Attachment) => void
  openFile?: Attachment | null
}) {
  const files = { onView, onOpenFile, openFile }
  if (m.role === "user") {
    return (
      <div className="flex min-w-0 flex-col items-end gap-2">
        {m.attachments?.length ? <Attachments items={m.attachments} {...files} align="end" /> : null}
        {m.text && (
          <div className="selectable max-w-[85%] rounded-2xl bg-message px-4 py-2 text-message-foreground wrap-anywhere whitespace-pre-wrap">{m.text}</div>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {author && <div className="text-xs font-medium text-muted-foreground">{author}</div>}
      <WorkLog message={m} />
      {m.attachments?.length ? <Attachments items={m.attachments} {...files} /> : null}
      {m.text ? (
        <Markdown text={m.text} />
      ) : m.streaming ? (
        <Spinner className="text-muted-foreground" />
      ) : null}
    </div>
  )
}

type FileHandlers = {
  onView: (a: Attachment) => void
  onOpenFile: (a: Attachment) => void
  openFile?: Attachment | null
}

function Attachments({ items, align = "start", ...handlers }: FileHandlers & { items: Attachment[]; align?: "start" | "end" }) {
  return (
    <div className={"flex max-w-[85%] flex-wrap gap-2 " + (align === "end" ? "justify-end" : "")}>
      {items.map((a, i) => (
        <AttachmentView key={a.path ?? a.url ?? i} a={a} {...handlers} />
      ))}
    </div>
  )
}

function AttachmentView({ a, onView, onOpenFile, openFile }: FileHandlers & { a: Attachment }) {
  const [failed, setFailed] = useState(false)
  if (a.kind === "image" && a.url && !failed) {
    return (
      <button onClick={() => onView(a)} className="overflow-hidden rounded-lg border" title={a.name}>
        <img src={a.url} alt={a.name} onError={() => setFailed(true)} className="max-h-64 max-w-80 object-cover" />
      </button>
    )
  }
  if (a.kind === "video" && a.url && !failed) {
    return <video src={a.url} controls onError={() => setFailed(true)} className="max-h-64 max-w-96 rounded-lg border" />
  }
  return <FileChip a={a} onOpen={onOpenFile} active={Boolean(openFile) && (openFile!.path ?? openFile!.url) === (a.path ?? a.url)} />
}

const SHEET = /\.(csv|tsv|xlsx?|numbers)$/i
const TEXT = /\.(md|txt|json|ya?ml|log|ts|tsx|js|py|html|css)$/i

/** A file reference; clicking it opens the file in the side panel. */
function FileChip({ a, onOpen, active }: { a: Attachment; onOpen: (a: Attachment) => void; active: boolean }) {
  const Icon =
    a.kind === "image" ? FileImage : a.kind === "video" ? FileVideo : SHEET.test(a.name) ? FileSpreadsheet : TEXT.test(a.name) ? FileText : FileIcon
  const available = Boolean(a.path || a.url)
  return (
    <button
      onClick={() => onOpen(a)}
      disabled={!available}
      title={a.path ?? a.name}
      aria-pressed={active}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-sm hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent aria-pressed:bg-muted"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{a.name}</span>
      {a.size ? <span className="text-xs text-muted-foreground">{bytes(a.size)}</span> : null}
    </button>
  )
}
