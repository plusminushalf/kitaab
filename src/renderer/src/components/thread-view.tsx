import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent, type RefObject } from "react"
import { Button } from "@/components/ui/button"
import { CircleAlert, CornerDownLeft, KeyRound, ListPlus, Lock, X } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ModelPicker } from "@/components/model-picker"
import { CiteSelection, type Citation } from "@/components/cite-selection"
import { attachmentToDraft, Composer, fileToDraft, type Draft } from "@/components/composer"
import { FilePanel } from "@/components/file-panel"
import { FindBar } from "@/components/find-bar"
import { MessageList } from "@/components/message-list"
import { PageHeader } from "@/components/page-header"
import { PinnedThreadDetails, ThreadDetails, useDetailsPinned } from "@/components/thread-details"
import { useSubagentPolling } from "@/components/thread-agents"
import { backend, isLocalThread, viewIdentity } from "@kitab/core/backend"
import type { Attachment, Id, PendingQuestion } from "@kitab/core/model"
import { store, useStore, type SendMode } from "@/lib/store"
import { draftKey, readDraft, writeDraft } from "@/lib/composer-drafts"

export function ThreadView({ threadId }: { threadId: Id | null }) {
  const thread = useStore((s) => s.threads.find((t) => t.id === threadId))
  const detail = useStore((s) => (threadId ? s.details[threadId] : undefined))
  const personalities = useStore((s) => s.personalities)
  const projectId = useStore((s) => thread?.projectId ?? s.projectId)
  const castIds = useStore((s) => s.projects.find((p) => p.id === projectId)?.personalityIds)
  const mentionables = useMemo(() => personalities.filter((p) => castIds?.includes(p.id)), [personalities, castIds])
  const host = thread?.cast.length ? personalities.find((p) => p.id === thread.cast[0]) : undefined
  // Mounted per thread (App keys it), so the key is fixed for this view's life.
  const key = draftKey(threadId, projectId)
  const [drafts, setDrafts] = useState<Draft[]>(() => readDraft(key).drafts)
  const [citations, setCitations] = useState<Citation[]>(() => readDraft(key).citations)
  const scrollRoot = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [openFile, setOpenFile] = useState<Attachment | null>(null)
  const connected = useStore((s) => s.connection.state === "connected")
  const column = useRef<HTMLDivElement>(null)
  const roomForDetails = useRoomForDetails(column)
  const detailsPinned = useDetailsPinned()
  const showPinned = !!threadId && roomForDetails && detailsPinned
  useSubagentPolling(threadId)
  const [finding, setFinding] = useState(false)
  // Bumped on every ⌘F, so pressing it again refocuses the open bar.
  const [findFocus, setFindFocus] = useState(0)
  // Bumped to remount the composer with text put back into its saved draft.
  const [composerEpoch, setComposerEpoch] = useState(0)
  // A message that didn't send holds the thread until it's retried or taken back to edit.
  const unsent = detail?.messages.find((m) => m.delivery === "failed")

  useEffect(
    () =>
      window.hermes.onMenu((command) => {
        if (command !== "find" || store.get().settings) return
        setFinding(true)
        setFindFocus((n) => n + 1)
      }),
    [],
  )

  // Wait for the connection: loading while it's down fails and would leave an empty thread behind.
  useEffect(() => {
    if (threadId && connected && (!detail || detail.stale)) void backend.loadThread(threadId)
  }, [threadId, connected, detail])

  useEffect(() => writeDraft(key, { drafts, citations }), [key, drafts, citations])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = [...e.dataTransfer.files]
    if (files.length) setDrafts((d) => [...d, ...files.map(fileToDraft)])
  }

  // Shows at once and goes in the background; if it doesn't go, it stays in the thread marked
  // failed (see UnsentNotice). A new thread opens right away under a local id.
  const send = async (text: string, sent: Draft[], how: SendMode) => {
    // Cleared here, not left to the composer: a new thread opens in this same update, so this
    // view is gone before the composer could save its emptied box, and the text would come back.
    writeDraft(key, { text: "", drafts: [], citations: [] })
    const id = backend.post(
      threadId,
      text,
      sent.map((d) => d.attachment),
      how,
    )
    if (id !== threadId) store.go({ kind: "thread", threadId: id })
  }

  // Takes the failed message back into the composer, ahead of anything typed since.
  const editUnsent = () => {
    if (!threadId || !unsent) return
    const back = backend.unsend(threadId, unsent.id)
    if (!back) return
    const restored = back.attachments.map(attachmentToDraft)
    // A thread that never got made went with it: edit it as a new thread again.
    if (!store.get().threads.some((t) => t.id === threadId)) {
      const target = draftKey(null, projectId)
      const prev = readDraft(target)
      writeDraft(target, { text: joinText(back.text, prev.text), drafts: [...restored, ...prev.drafts] })
      store.go({ kind: "thread", threadId: null })
      return
    }
    writeDraft(key, { text: joinText(back.text, readDraft(key).text) })
    setDrafts((d) => [...restored, ...d])
    setComposerEpoch((n) => n + 1)
  }

  const project = useStore((s) => s.projects.find((p) => p.id === (thread?.projectId ?? s.projectId)))
  // A reply is running. While Hermes asks a question, your next message answers it instead.
  const answering = detail?.pending.some((q) => q.kind === "clarify")
  const busy = thread?.status === "working" || (thread?.status === "needs-you" && !answering)
  const enterSends = useStore((s) => s.enterSends)
  // Being loaded: from scratch, or behind what this device last saw of it (see showCached).
  const loading = !!threadId && !isLocalThread(threadId) && (!detail || detail.loading || !!detail.stale)

  return (
    <div className="flex h-full min-h-0">
      <div
        ref={column}
        className="relative flex h-full min-h-0 min-w-80 flex-1 flex-col"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault()
            setDragging(true)
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false)
        }}
        onDrop={onDrop}
      >
        <PageHeader title={thread?.title ?? "New thread"} subtitle={project?.name}>
          {loading && detail?.messages.length ? (
            <Spinner className="size-3.5 text-muted-foreground" aria-label="Bringing it up to date" />
          ) : null}
          {threadId && <ThreadDetails threadId={threadId} inline={roomForDetails} />}
        </PageHeader>

        {/* The pinned card floats over the scroller's right side (which is padded by
            --details-w), so the scrollbar sits at the window edge, not beside the card. */}
        <div
          className="relative flex min-h-0 flex-1"
          style={{ "--details-w": showPinned ? "304px" : "0px" } as CSSProperties}
        >
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {finding && <FindBar root={scrollRoot} focusSignal={findFocus} onClose={() => setFinding(false)} />}
            <CiteSelection root={scrollRoot} onCite={(c) => setCitations((all) => [...all, c])} />
            <div ref={scrollRoot} data-scroll-root className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-(--details-w)">
              {thread?.fromRun && (
                <div className="mx-auto max-w-chat px-6 pt-4">
                  <Button
                    variant="link"
                    size="sm"
                    className="px-0"
                    onClick={() => store.go({ kind: "run", ...thread.fromRun! })}
                  >
                    From a routine run →
                  </Button>
                </div>
              )}
              {threadId && detail?.messages.length ? (
                <MessageList
                  key={viewIdentity(threadId)}
                  messages={detail.messages}
                  personalities={personalities}
                  onOpenFile={setOpenFile}
                  openFile={openFile}
                  stopping={thread?.stopping}
                />
              ) : threadId && (loading || !connected) ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                  <Spinner className="size-5" aria-label={connected ? "Loading" : "Reconnecting"} />
                  {!connected && <span>Reconnecting…</span>}
                </div>
              ) : (
                <Empty className="h-full">
                  <EmptyHeader>
                    <EmptyTitle>{threadId ? "Nothing here yet" : "Start a thread"}</EmptyTitle>
                    <EmptyDescription>Drop images, video or files anywhere to attach them.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>

            <div className="pr-(--details-w)">
            <div className="mx-auto w-full max-w-chat px-6 pb-3">
              {threadId && detail?.pending.length ? (
                // Capped so a long command can't push the thread and the composer off screen.
                <div className="max-h-[55vh] overflow-y-auto">
                  {detail.pending.map((q) => (
                    <QuestionCard key={q.id} threadId={threadId} question={q} />
                  ))}
                </div>
              ) : null}
              {threadId && <QueuedMessages threadId={threadId} />}
              {threadId && unsent && (
                <UnsentNotice
                  starting={isLocalThread(threadId)}
                  error={unsent.deliveryError}
                  onRetry={() => backend.retry(threadId, unsent.id)}
                  onEdit={editUnsent}
                />
              )}
              <Composer
                key={composerEpoch}
                placeholder={
                  host
                    ? `Reply to ${host.name}…`
                    : mentionables.length
                      ? `${threadId ? "Reply" : "Ask anything"}, or type @ to bring in a personality…`
                      : threadId
                        ? "Reply…"
                        : "Ask anything…"
                }
                mentionables={mentionables}
                busy={busy}
                blocked={!!unsent}
                enterSends={enterSends}
                drafts={drafts}
                setDrafts={setDrafts}
                citations={citations}
                setCitations={setCitations}
                initialText={readDraft(key).text}
                onTextChange={(text) => writeDraft(key, { text })}
                onSend={send}
                onStop={threadId ? () => void backend.interrupt(threadId) : undefined}
                stopRequested={thread?.stopping}
                autoFocus
                extras={<ModelPicker threadId={threadId} />}
              />
            </div>
            </div>
          </div>
          {showPinned && <PinnedThreadDetails threadId={threadId} />}
        </div>

        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/80 text-sm font-medium">
            Drop to attach
          </div>
        )}
      </div>
      {openFile && <SidePanel file={openFile} onClose={() => setOpenFile(null)} />}
    </div>
  )
}

/** The details card's column, and the least room the chat may be left with beside it. */
const DETAILS_COLUMN = 288 + 16
const MIN_CHAT = 480

/** Whether the thread is wide enough to keep the details card in a column beside the chat. */
function useRoomForDetails(column: RefObject<HTMLElement | null>) {
  const [room, setRoom] = useState(false)
  useEffect(() => {
    const el = column.current
    if (!el) return
    const measure = () => setRoom(el.clientWidth >= DETAILS_COLUMN + MIN_CHAT)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [column])
  return room
}

const WIDTH_KEY = "kitab.filePanelWidth"

/** The file panel docked on the right, resizable by dragging its left edge. */
function SidePanel({ file, onClose }: { file: Attachment; onClose: () => void }) {
  const [width, setWidth] = useState(() => {
    try {
      return Number(localStorage.getItem(WIDTH_KEY)) || 560
    } catch {
      return 560
    }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startWidth = width
    let next = startWidth
    const move = (ev: globalThis.PointerEvent) => {
      next = Math.min(Math.max(startWidth + startX - ev.clientX, 320), window.innerWidth * 0.75)
      setWidth(next)
    }
    const up = () => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(next)))
      } catch {}
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
  }

  return (
    <aside className="relative h-full min-h-0 shrink-0 border-l" style={{ width, maxWidth: "75%" }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file panel"
        onPointerDown={startResize}
        className="app-no-drag absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize hover:bg-border/60"
      />
      <FilePanel file={file} onClose={onClose} />
    </aside>
  )
}

const joinText = (a: string, b: string) => (b.trim() ? `${a.trimEnd()}\n\n${b}` : a)

/** A message that didn't go. Until it's retried or taken back, nothing else can be sent here. */
function UnsentNotice({
  starting,
  error,
  onRetry,
  onEdit,
}: {
  /** The thread itself hasn't been made yet. */
  starting: boolean
  error?: string
  onRetry: () => void
  onEdit: () => void
}) {
  return (
    <div role="alert" className="mb-2 flex items-center gap-2.5 rounded-xl border border-destructive/40 bg-destructive/5 py-1.5 pr-1.5 pl-3 text-sm">
      <CircleAlert className="size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{starting ? "Couldn’t start this thread" : "Your message didn’t send"}</div>
        <div className="truncate text-xs text-muted-foreground" title={error}>
          {error ? `${error}. ` : ""}Retry it, or edit it to send again.
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={onEdit} title="Take it back into the box below to change it">
        Edit
      </Button>
      <Button size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

/** Messages waiting for the running reply to finish, oldest first. Each can go now or be dropped. */
function QueuedMessages({ threadId }: { threadId: Id }) {
  const queue = useStore((s) => s.queued[threadId])
  if (!queue?.items.length) return null
  return (
    <div className="mb-2 flex flex-col rounded-xl border bg-card p-1.5 text-sm">
      <div className="px-2 pt-0.5 pb-1 text-xs text-muted-foreground">
        {queue.paused ? "Queued · held because the reply was stopped" : "Queued · sends when the reply finishes"}
      </div>
      {queue.items.map((q) => {
        const files = q.attachments.length
        const first = q.text.trim().split("\n")[0]
        return (
          <div key={q.id} className="flex items-center gap-2 rounded-lg py-0.5 pr-0.5 pl-2 hover:bg-accent/50">
            <ListPlus className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={q.text}>
              {first || `${files} ${files === 1 ? "file" : "files"}`}
              {first && files ? <span className="text-muted-foreground"> · {files} {files === 1 ? "file" : "files"}</span> : null}
            </span>
            <Button
              size="xs"
              variant="ghost"
              title="Interrupt the reply and send this now"
              onClick={() => void backend.sendQueuedNow(threadId, q.id)}
            >
              Send now
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              className="text-muted-foreground"
              aria-label="Remove from queue"
              title="Remove"
              onClick={() => backend.unqueue(threadId, q.id)}
            >
              <X />
            </Button>
          </div>
        )
      })}
    </div>
  )
}

function QuestionCard({ threadId, question }: { threadId: Id; question: PendingQuestion }) {
  const [custom, setCustom] = useState("")
  const answer = (value: string) => void backend.answer(threadId, question, value)

  if (question.kind === "secret") return <SecretCard threadId={threadId} question={question} />

  if (question.kind === "approval") {
    const choices = question.choices?.length ? question.choices : ["Allow", "Deny"]
    return (
      <Card size="sm" className="mb-3">
        <CardHeader>
          <CardTitle className="selectable">{question.title}</CardTitle>
          {question.detail && (
            <CardDescription className="selectable max-h-60 overflow-y-auto font-mono text-xs break-all whitespace-pre-wrap">
              {question.detail}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {choices.map((c, i) => (
            <Button key={c} size="sm" variant={i === 0 ? "default" : "outline"} onClick={() => answer(c)}>
              {c}
            </Button>
          ))}
        </CardContent>
      </Card>
    )
  }

  const choices = question.choices ?? []
  const submitCustom = () => {
    const v = custom.trim()
    if (v) answer(v)
  }
  return (
    <Card size="sm" className="mb-3">
      <CardHeader>
        <CardTitle className="selectable leading-snug">{question.title}</CardTitle>
        {question.detail && (
          <CardDescription className="selectable whitespace-pre-wrap">{question.detail}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {choices.map((c, i) => (
          <button
            key={c}
            type="button"
            onClick={() => answer(c)}
            className="group flex w-full items-start gap-2.5 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:border-ring/60 hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground tabular-nums group-hover:text-foreground">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 break-words">{c}</span>
          </button>
        ))}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submitCustom()
          }}
        >
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={choices.length ? "Or type your own answer…" : "Type your answer…"}
            aria-label="Your own answer"
          />
          <Button type="submit" size="sm" disabled={!custom.trim()}>
            <CornerDownLeft />
            Send
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * Hermes asks for a secret or a sudo password. The value lives only in this field: it goes
 * straight to the server, which puts it where it belongs, and never reaches the thread or the model.
 */
function SecretCard({ threadId, question }: { threadId: Id; question: PendingQuestion }) {
  const [value, setValue] = useState("")
  const [sent, setSent] = useState(false)
  const submit = (v: string) => {
    if (sent) return
    setSent(true)
    setValue("")
    void backend.answer(threadId, question, v)
  }
  return (
    <Card size="sm" className="mb-3">
      <CardHeader>
        <CardTitle className="selectable flex items-center gap-2 leading-snug">
          <KeyRound className="size-4 shrink-0 text-muted-foreground" />
          {question.title}
        </CardTitle>
        {question.detail && (
          <CardDescription className="selectable whitespace-pre-wrap">{question.detail}</CardDescription>
        )}
        {question.command && (
          <CardDescription className="selectable max-h-60 overflow-y-auto font-mono text-xs break-all whitespace-pre-wrap">
            {question.command}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) submit(value)
          }}
        >
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste or type it here"
            aria-label={question.title}
            autoComplete="off"
            spellCheck={false}
            disabled={sent}
          />
          <Button type="submit" size="sm" disabled={sent || !value.trim()}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={sent} onClick={() => submit("")}>
            Skip
          </Button>
        </form>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lock className="mt-px size-3 shrink-0" />
          <span className="selectable">
            {question.destination ? `${question.destination}. ` : ""}The agent never sees it, and it isn't kept in this thread.
          </span>
        </p>
      </CardContent>
    </Card>
  )
}
