import { useSyncExternalStore, type ComponentType, type ReactNode } from "react"
import { toast } from "sonner"
import {
  Bot,
  CalendarClock,
  Check,
  Clock,
  Copy,
  Hash,
  Info,
  Laptop,
  MessageSquare,
  Repeat,
  Server,
  Undo2,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ProjectBadge } from "@/components/project-badge"
import { AgentsSection, useActiveAgentCount, useSubagents } from "@/components/thread-agents"
import { appearance, THREAD_DETAIL_ITEMS, useAppearance } from "@/lib/appearance/store"
import { backend } from "@kitab/core/backend"
import { relativeTime } from "@kitab/core/format"
import type { Id } from "@kitab/core/model"
import { EFFORT_LABELS, shortModelName } from "@kitab/core/model-names"
import { store, useStore } from "@/lib/store"

// ---- pinned or not -----------------------------------------------------------------
// With room beside the chat the card stays open in the right gutter (T3 Code's inline
// placement) until you close it; without room it opens from the header as a popover.

const PINNED_KEY = "kitab.threadDetailsPinned"
const pinListeners = new Set<() => void>()
let pinned = (() => {
  try {
    return localStorage.getItem(PINNED_KEY) !== "false"
  } catch {
    return true
  }
})()

function setPinned(v: boolean) {
  pinned = v
  try {
    localStorage.setItem(PINNED_KEY, String(v))
  } catch {}
  pinListeners.forEach((l) => l())
}

export function useDetailsPinned(): boolean {
  return useSyncExternalStore(
    (l) => {
      pinListeners.add(l)
      return () => void pinListeners.delete(l)
    },
    () => pinned,
  )
}

/**
 * The header button for the thread's details card (T3 Code's thread details).
 * `inline`: there's room to show the card beside the chat, so the button pins it.
 */
export function ThreadDetails({ threadId, inline }: { threadId: Id; inline: boolean }) {
  const isPinned = useDetailsPinned()
  const working = useActiveAgentCount(threadId)
  const badge = working > 0 && !(inline && isPinned) && (
    <span className="pointer-events-none absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[0.55rem] font-semibold text-primary-foreground tabular-nums">
      {working}
    </span>
  )
  const label = working ? `Thread details · ${working} ${working === 1 ? "agent" : "agents"} working` : "Thread details"

  if (inline) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        className={"relative " + (isPinned ? "bg-accent text-accent-foreground" : "text-muted-foreground")}
        aria-label={label}
        aria-pressed={isPinned}
        title={label}
        onClick={() => setPinned(!isPinned)}
      >
        <Info />
        {badge}
      </Button>
    )
  }
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-sm" className="relative text-muted-foreground" />}
        aria-label={label}
        title={label}
      >
        <Info />
        {badge}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        // Focusing the first button would ring "Previous agents" every time the card opens.
        initialFocus={false}
        className="max-h-[calc(100vh-80px)] w-80 gap-0 overflow-y-auto rounded-2xl p-1.5"
      >
        <DetailsBody threadId={threadId} />
      </PopoverContent>
    </Popover>
  )
}

/** The card in its own column right of the chat, as T3 Code keeps it: the chat centers in what's left. */
export function PinnedThreadDetails({ threadId }: { threadId: Id }) {
  const known = useStore((s) => s.threads.some((t) => t.id === threadId) || s.done.some((t) => t.id === threadId))
  if (!known) return null
  return (
    // Floats over the thread's scroller; only the card takes the pointer, so wheeling
    // anywhere else (including the scrollbar at the window edge) scrolls the thread.
    <aside className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-[304px] flex-col overflow-y-auto pt-3 pr-4 pb-3">
      <div
        data-slot="popover-content"
        className="pointer-events-auto flex flex-col rounded-2xl bg-popover p-1.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
      >
        <DetailsBody threadId={threadId} />
      </div>
    </aside>
  )
}

/** The card's rows. Right-click to choose which ones it shows. */
function DetailsBody({ threadId }: { threadId: Id }) {
  const thread = useStore((s) => s.threads.find((t) => t.id === threadId) ?? s.done.find((t) => t.id === threadId))
  const isDone = useStore((s) => !s.threads.some((t) => t.id === threadId) && s.done.some((t) => t.id === threadId))
  const messages = useStore((s) => s.details[threadId]?.messages)
  const connection = useStore((s) => s.connection)
  const project = useStore((s) => s.projects.find((p) => p.id === thread?.projectId))
  const personalities = useStore((s) => s.personalities)
  const model = useStore((s) => s.threadModels[threadId] ?? s.defaultModel)
  const defaultEffort = useStore((s) => s.defaultEffort)
  const show = useAppearance((s) => s.settings.threadDetails)
  const agents = useSubagents(threadId)

  if (!thread) return null
  const cast = thread.cast.map((id) => personalities.find((p) => p.id === id)?.name ?? id)
  const startedAt = messages?.[0]?.createdAt
  const effort = model?.effort ?? defaultEffort
  const copyId = () => {
    void navigator.clipboard.writeText(threadId)
    toast.success("Thread ID copied")
  }
  const local = connection.state === "connected" && /^(localhost|127\.|::1)/.test(connection.server)

  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex flex-col">
        {show.machine && (
          <Row icon={local ? Laptop : Server}>
            {connection.state === "connected" ? connection.server : "Not connected"}
          </Row>
        )}
        {show.project && project && (
          <Row icon={() => <ProjectBadge name={project.name} className="size-4.5 text-[0.55rem]" />}>
            {project.name}
          </Row>
        )}
        {show.model && model && (
          <Row icon={Bot}>
            {shortModelName(model.model)}
            {effort && <span className="text-muted-foreground"> · {EFFORT_LABELS[effort] ?? effort}</span>}
          </Row>
        )}
        {show.personalities && cast.length > 0 && <Row icon={Users}>{cast.join(", ")}</Row>}
        {show.routine && thread.fromRun && (
          <Row icon={Repeat} onClick={() => store.go({ kind: "run", ...thread.fromRun! })}>
            From a routine run
          </Row>
        )}
        {show.messages && messages && (
          <Row icon={MessageSquare}>
            {messages.length} {messages.length === 1 ? "message" : "messages"}
          </Row>
        )}
        {show.created && startedAt && <Row icon={CalendarClock}>Started {relativeTime(startedAt)}</Row>}
        {show.updated && <Row icon={Clock}>Last activity {relativeTime(thread.updatedAt)}</Row>}
        {show.id && (
          <Row icon={Hash} onClick={copyId} trailing={<Copy className="size-4 text-muted-foreground" />}>
            <span className="font-mono text-xs">{threadId}</span>
          </Row>
        )}
        {show.agents && agents.length > 0 && (
          <>
            <div className="mx-2 my-1.5 h-px bg-border" />
            <AgentsSection threadId={threadId} />
          </>
        )}
        <div className="mx-2 my-1.5 h-px bg-border" />
        <Row icon={isDone ? Undo2 : Check} onClick={() => void backend.setDone(threadId, !isDone)}>
          {isDone ? "Mark as not done" : "Mark as done"}
        </Row>
        <Row icon={Copy} onClick={copyId}>
          Copy thread ID
        </Row>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">
        <ContextMenuGroup>
          <ContextMenuLabel>Show in thread details</ContextMenuLabel>
          {THREAD_DETAIL_ITEMS.map(([key, label]) => (
            <ContextMenuCheckboxItem
              key={key}
              checked={show[key]}
              onCheckedChange={() =>
                appearance.update({
                  threadDetails: {
                    ...appearance.get().settings.threadDetails,
                    [key]: !show[key],
                  },
                })
              }
            >
              {label}
            </ContextMenuCheckboxItem>
          ))}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function Row({
  icon: Icon,
  children,
  onClick,
  trailing,
}: {
  icon: ComponentType<{ className?: string }>
  children: ReactNode
  onClick?: () => void
  trailing?: ReactNode
}) {
  const body = (
    <>
      <Icon className="size-4.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </>
  )
  const cls = "flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm"
  return onClick ? (
    <button className={cls + " hover:bg-accent hover:text-accent-foreground"} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls + " selectable"}>{body}</div>
  )
}
