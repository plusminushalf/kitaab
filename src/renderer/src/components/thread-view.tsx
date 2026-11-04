import { useEffect, useState, type DragEvent, type PointerEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ModelPicker } from "@/components/model-picker"
import { Composer, fileToDraft, type Draft } from "@/components/composer"
import { FilePanel } from "@/components/file-panel"
import { MessageList } from "@/components/message-list"
import { PageHeader } from "@/components/page-header"
import { ThreadDetails } from "@/components/thread-details"
import { backend } from "@/lib/backend"
import type { Attachment, Id, PendingQuestion } from "@/lib/model"
import { store, useStore } from "@/lib/store"

export function ThreadView({ threadId }: { threadId: Id | null }) {
  const thread = useStore((s) => s.threads.find((t) => t.id === threadId))
  const detail = useStore((s) => (threadId ? s.details[threadId] : undefined))
  const personalities = useStore((s) => s.personalities)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [dragging, setDragging] = useState(false)
  const [openFile, setOpenFile] = useState<Attachment | null>(null)

  useEffect(() => {
    if (threadId && !detail) void backend.loadThread(threadId)
  }, [threadId, detail])

  useEffect(() => setDrafts([]), [threadId])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = [...e.dataTransfer.files]
    if (files.length) setDrafts((d) => [...d, ...files.map(fileToDraft)])
  }

  const send = async (text: string, sent: Draft[]) => {
    setDrafts(() => [])
    try {
      const id = await backend.send(
        threadId,
        text,
        sent.map((d) => d.attachment),
      )
      if (id !== threadId) store.go({ kind: "thread", threadId: id })
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err))
    }
  }

  const project = useStore((s) => s.projects.find((p) => p.id === (thread?.projectId ?? s.projectId)))
  const busy = thread?.status === "working"

  return (
    <div className="flex h-full min-h-0">
      <div
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
          {threadId && <ThreadDetails threadId={threadId} />}
        </PageHeader>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
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
              messages={detail.messages}
              personalities={personalities}
              onOpenFile={setOpenFile}
              openFile={openFile}
            />
          ) : (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyTitle>
                  {threadId ? (detail?.loading ? "Loading…" : "Nothing here yet") : "Start a thread"}
                </EmptyTitle>
                <EmptyDescription>Drop images, video or files anywhere to attach them.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>

        <div className="mx-auto w-full max-w-chat px-6 pb-3">
          {threadId && detail?.pending.map((q) => <QuestionCard key={q.id} threadId={threadId} question={q} />)}
          <Composer
            placeholder={threadId ? "Reply…" : "Ask anything…"}
            busy={busy}
            drafts={drafts}
            setDrafts={setDrafts}
            onSend={send}
            onStop={threadId ? () => void backend.interrupt(threadId) : undefined}
            autoFocus
            extras={<ModelPicker threadId={threadId} />}
          />
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

function QuestionCard({ threadId, question }: { threadId: Id; question: PendingQuestion }) {
  const choices = question.choices?.length ? question.choices : ["Allow", "Deny"]
  return (
    <Card size="sm" className="mb-3">
      <CardHeader>
        <CardTitle>{question.title}</CardTitle>
        {question.detail && (
          <CardDescription className="selectable font-mono text-xs whitespace-pre-wrap">
            {question.detail}
          </CardDescription>
        )}
        <CardAction className="flex gap-2">
          {choices.map((c, i) => (
            <Button
              key={c}
              size="sm"
              variant={i === 0 ? "default" : "outline"}
              onClick={() => void backend.answer(threadId, question, c)}
            >
              {c}
            </Button>
          ))}
        </CardAction>
      </CardHeader>
    </Card>
  )
}
