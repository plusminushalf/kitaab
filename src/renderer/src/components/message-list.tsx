import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { CircleAlert, FileIcon, FileImage, FileSpreadsheet, FileText, FileVideo } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ZoomableImage } from "@/components/zoomable-image"
import type { Attachment, Message, Personality } from "@kitab/core/model"
import { bytes } from "@kitab/core/format"
import { CodeBlock, Markdown } from "@/components/markdown"
import { WorkLog } from "@/components/work-log"
import { splitTurn } from "@kitab/core/turn"

export function MessageList({
  messages,
  personalities,
  onOpenFile,
  openFile,
  stopping,
}: {
  messages: Message[]
  personalities: Personality[]
  /** Stop was pressed: the running reply says it's stopping. */
  stopping?: boolean
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
          stopping={stopping}
        />
      ))}
      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-[90vw] sm:max-w-[90vw]">
          <DialogTitle className="truncate">{viewing?.name}</DialogTitle>
          {viewing?.kind === "image" && (
            <ZoomableImage src={viewing.url!} alt={viewing.name} className="max-h-[80vh]" />
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
  stopping,
}: {
  message: Message
  author?: string
  stopping?: boolean
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
          <div className="selectable flex max-w-[85%] flex-col gap-2 rounded-2xl bg-message px-4 py-2 text-message-foreground wrap-anywhere whitespace-pre-wrap">
            {userBlocks(m.text).map((b, i) =>
              b.kind === "code" ? (
                <CodeBlock key={i} code={b.text} lang={b.lang} className="rounded-md border border-border whitespace-normal" />
              ) : b.kind === "quote" ? (
                <blockquote key={i} className="border-l-2 border-current/30 pl-2.5 opacity-70">
                  <InlineCode text={b.text} />
                </blockquote>
              ) : (
                <div key={i}>
                  <InlineCode text={b.text} />
                </div>
              ),
            )}
          </div>
        )}
        <DeliveryNote message={m} />
      </div>
    )
  }

  const { work, answer } = splitTurn(m)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {author && <div className="text-xs font-medium text-muted-foreground">{author}</div>}
      <WorkLog message={m} work={work} stopping={stopping} />
      {m.attachments?.length ? <Attachments items={m.attachments} {...files} /> : null}
      {answer ? <Markdown text={answer} /> : null}
    </div>
  )
}

/** How long a message can take to land before it says it's still sending. Most land well before. */
const SLOW_SEND_MS = 1200

/** Under a message you sent: "Sending…" when it's slow to land, "Not sent" when it didn't. */
function DeliveryNote({ message: m }: { message: Message }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (m.delivery !== "sending") return setSlow(false)
    const timer = setTimeout(() => setSlow(true), SLOW_SEND_MS)
    return () => clearTimeout(timer)
  }, [m.delivery])
  if (m.delivery === "failed") {
    return (
      <div className="-mt-1 flex items-center gap-1 text-xs text-destructive" title={m.deliveryError}>
        <CircleAlert className="size-3" />
        Not sent
      </div>
    )
  }
  if (m.delivery === "sending" && slow) return <div className="-mt-1 text-xs text-muted-foreground">Sending…</div>
  return null
}

type UserBlock = { kind: "text" | "quote"; text: string } | { kind: "code"; text: string; lang?: string }

/** Splits your message into ``` fenced code, `> ` quoted passages (from citing), and the rest. */
function userBlocks(text: string): UserBlock[] {
  const blocks: UserBlock[] = []
  let prose: string[] = []
  let fence: { marker: string; lang?: string; lines: string[] } | null = null
  const flushProse = () => {
    for (const b of quoteBlocks(prose.join("\n"))) blocks.push({ kind: b.quote ? "quote" : "text", text: b.text })
    prose = []
  }
  for (const line of text.split("\n")) {
    if (fence) {
      if (line.trim().startsWith(fence.marker) && line.trim().replace(/[`~]/g, "") === "") {
        blocks.push({ kind: "code", text: fence.lines.join("\n"), lang: fence.lang })
        fence = null
      } else fence.lines.push(line)
      continue
    }
    // A backtick fence's info string can't hold backticks (so ```one line``` stays text).
    const open = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)(.*)$/.exec(line)
    if (open && !(open[1][0] === "`" && open[3].includes("`"))) {
      flushProse()
      fence = { marker: open[1], lang: open[2]?.toLowerCase() || undefined, lines: [] }
    } else prose.push(line)
  }
  // An unclosed fence runs to the end, as in markdown.
  if (fence) blocks.push({ kind: "code", text: fence.lines.join("\n"), lang: fence.lang })
  flushProse()
  return blocks.filter((b) => b.kind === "code" || b.text)
}

/** Text with its `inline code` spans set in mono. */
function InlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`)/)
  if (parts.length === 1) return text
  return parts.map((p, i) =>
    p.length > 2 && p.startsWith("`") && p.endsWith("`") ? (
      <code key={i} className="rounded bg-current/10 px-1 py-0.5 font-mono text-[0.9em]">
        {p.slice(1, -1)}
      </code>
    ) : (
      p
    ),
  )
}

/** Splits text into its `> ` quoted passages (from citing) and the rest. */
function quoteBlocks(text: string): { quote: boolean; text: string }[] {
  const blocks: { quote: boolean; lines: string[] }[] = []
  for (const line of text.split("\n")) {
    const quote = /^>( |$)/.test(line)
    const body = quote ? line.replace(/^> ?/, "") : line
    const last = blocks.at(-1)
    if (last && last.quote === quote) last.lines.push(body)
    else blocks.push({ quote, lines: [body] })
  }
  return blocks
    .map((b) => ({ quote: b.quote, text: b.lines.join("\n").replace(/^\n+|\n+$/g, "") }))
    .filter((b) => b.text)
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
  // Per link: a thread shown from the cache may hold a stale one, and loading it brings a fresh one.
  const [failedUrl, setFailedUrl] = useState<string>()
  const failed = failedUrl !== undefined && failedUrl === a.url
  const setFailed = () => setFailedUrl(a.url)
  if (a.kind === "image" && a.url && !failed) {
    return (
      <button onClick={() => onView(a)} className="overflow-hidden rounded-lg border" title={a.name}>
        <img src={a.url} alt={a.name} onError={setFailed} className="max-h-64 max-w-80 object-cover" />
      </button>
    )
  }
  if (a.kind === "video" && a.url && !failed) {
    return <video src={a.url} controls onError={setFailed} className="max-h-64 max-w-96 rounded-lg border" />
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
