import { useEffect, useMemo, useState } from "react"
import { ChevronRight, Code, Eye, ScanEye, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Markdown } from "@/components/markdown"
import { bytes } from "@/lib/format"
import type { Attachment } from "@/lib/model"

// A file opened from the transcript, docked to the right of the thread like an
// editor tab: a path breadcrumb on top, the contents below.

type Loaded =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; text: string | null; size: number; truncated: boolean }

const TABLE = /\.(csv|tsv)$/i
const MARKDOWN = /\.(md|markdown)$/i
const MAX_ROWS = 5000

export function FilePanel({ file, onClose }: { file: Attachment; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" })
  const rendered = TABLE.test(file.name) || MARKDOWN.test(file.name)
  const [source, setSource] = useState(false)

  useEffect(() => {
    if (file.kind !== "file") return
    let cancelled = false
    setLoaded({ state: "loading" })
    setSource(false)
    load(file)
      .then((r) => !cancelled && setLoaded({ state: "ready", ...r }))
      .catch((e) => !cancelled && setLoaded({ state: "error", message: cleanError(e) }))
    return () => {
      cancelled = true
    }
  }, [file])

  const crumbs = (file.path ?? file.name).replace(/^~\//, "").split("/").filter(Boolean)

  const quickLook = async () => {
    if (!file.path) return
    try {
      await window.hermes.files.quickLook(file.path, file.name)
    } catch (e) {
      toast.error(cleanError(e))
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="app-drag flex h-[52px] shrink-0 items-center gap-1 border-b pr-2 pl-4">
        <nav
          className="flex min-w-0 flex-1 items-center gap-1 text-sm text-muted-foreground"
          title={file.path ?? file.name}
        >
          {crumbs.map((c, i) => (
            <span
              key={i}
              className={"flex items-center gap-1 " + (i === crumbs.length - 1 ? "min-w-0 shrink-0" : "min-w-0 shrink")}
            >
              {i > 0 && <ChevronRight className="size-3.5 shrink-0" />}
              <span className={"truncate " + (i === crumbs.length - 1 ? "font-medium text-foreground" : "")}>{c}</span>
            </span>
          ))}
        </nav>
        {loaded.state === "ready" && loaded.text !== null && rendered && (
          <PanelButton label={source ? "Show preview" : "Show source"} onClick={() => setSource(!source)}>
            {source ? <Eye /> : <Code />}
          </PanelButton>
        )}
        {file.path && (
          <PanelButton label="Quick Look" onClick={quickLook}>
            <ScanEye />
          </PanelButton>
        )}
        <PanelButton label="Close" onClick={onClose}>
          <X />
        </PanelButton>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <Body file={file} loaded={loaded} source={source} onQuickLook={quickLook} />
      </div>
    </div>
  )
}

function PanelButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function Body({
  file,
  loaded,
  source,
  onQuickLook,
}: {
  file: Attachment
  loaded: Loaded
  source: boolean
  onQuickLook: () => void
}) {
  if (file.kind === "image" && file.url)
    return <img src={file.url} alt={file.name} className="m-auto max-h-full max-w-full object-contain p-4" />
  if (file.kind === "video" && file.url) return <video src={file.url} controls className="max-h-full w-full p-4" />
  if (loaded.state === "loading")
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </div>
    )
  if (loaded.state === "error") return <Message title="Couldn't open this file" detail={loaded.message} />
  if (loaded.text === null)
    return (
      <Message
        title="No preview"
        detail={`${file.name} is a binary file${loaded.size ? ` (${bytes(loaded.size)})` : ""}.`}
      >
        {file.path && (
          <Button variant="outline" size="sm" onClick={onQuickLook}>
            Open in Quick Look
          </Button>
        )}
      </Message>
    )

  const note = loaded.truncated ? `Showing the first 5 MB of ${bytes(loaded.size)}.` : undefined
  if (!source && TABLE.test(file.name))
    return <Table text={loaded.text} delimiter={/\.tsv$/i.test(file.name) ? "\t" : ","} note={note} />
  if (!source && MARKDOWN.test(file.name))
    return (
      <div className="px-6 py-5">
        {note && <Note>{note}</Note>}
        <Markdown text={loaded.text} />
      </div>
    )
  return <Source text={loaded.text} note={note} />
}

function Source({ text, note }: { text: string; note?: string }) {
  const lines = useMemo(() => text.replace(/\n$/, "").split("\n"), [text])
  return (
    <div className="py-3">
      {note && <Note>{note}</Note>}
      <table className="selectable font-mono text-xs leading-5">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="sticky left-0 bg-background pr-4 pl-4 text-right align-top text-muted-foreground/60 select-none">
                {i + 1}
              </td>
              <td className="pr-6 whitespace-pre">{line || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Table({ text, delimiter, note }: { text: string; delimiter: string; note?: string }) {
  const rows = useMemo(() => parseDelimited(text, delimiter), [text, delimiter])
  if (!rows.length) return <Message title="Empty file" />
  const [head, ...body] = rows
  const shown = body.slice(0, MAX_ROWS)
  return (
    <div>
      {(note || body.length > MAX_ROWS) && (
        <Note>
          {note}{" "}
          {body.length > MAX_ROWS && `Showing ${MAX_ROWS.toLocaleString()} of ${body.length.toLocaleString()} rows.`}
        </Note>
      )}
      <table className="selectable w-max border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 border-r border-b bg-muted px-2 py-1.5" />
            {head.map((h, i) => (
              <th
                key={i}
                className="sticky top-0 z-10 border-r border-b bg-muted px-3 py-1.5 text-left font-medium whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, ri) => (
            <tr key={ri} className="hover:bg-muted/50">
              <td className="sticky left-0 z-10 border-r border-b bg-background px-2 py-1 text-right text-muted-foreground/60 tabular-nums select-none">
                {ri + 1}
              </td>
              {head.map((_, ci) => (
                <td
                  key={ci}
                  className="max-w-96 truncate border-r border-b px-3 py-1 whitespace-nowrap tabular-nums"
                  title={r[ci]}
                >
                  {r[ci]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pb-2 text-xs text-muted-foreground">{children}</div>
}

function Message({ title, detail, children }: { title: string; detail?: string; children?: React.ReactNode }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {detail && <EmptyDescription>{detail}</EmptyDescription>}
      </EmptyHeader>
      {children}
    </Empty>
  )
}

async function load(file: Attachment): Promise<{ text: string | null; size: number; truncated: boolean }> {
  if (file.path) return window.hermes.files.read(file.path)
  // Just-attached files have no server path yet, only a blob: URL.
  if (file.url) {
    const blob = await (await fetch(file.url)).blob()
    const head = new Uint8Array(await blob.slice(0, 8192).arrayBuffer())
    if (head.includes(0)) return { text: null, size: blob.size, truncated: false }
    return { text: await blob.text(), size: blob.size, truncated: false }
  }
  throw new Error("This file isn't available.")
}

const cleanError = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e)

/** RFC 4180-ish: quoted fields, doubled quotes, newlines inside quotes. */
function parseDelimited(text: string, d: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') ((field += '"'), i++)
        else quoted = false
      } else field += c
    } else if (c === '"' && field === "") quoted = true
    else if (c === d) (row.push(field), (field = ""))
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      ;(row.push(field), rows.push(row), (row = []), (field = ""))
    } else field += c
  }
  if (field || row.length) (row.push(field), rows.push(row))
  if (rows[0]?.[0]?.charCodeAt(0) === 0xfeff) rows[0][0] = rows[0][0].slice(1)
  return rows
}
