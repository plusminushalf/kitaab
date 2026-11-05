import type { ComponentType, ReactNode } from "react"
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
import { appearance, THREAD_DETAIL_ITEMS, useAppearance } from "@/lib/appearance/store"
import { backend } from "@kitab/core/backend"
import { relativeTime } from "@kitab/core/format"
import type { Id } from "@kitab/core/model"
import { EFFORT_LABELS, shortModelName } from "@kitab/core/model-names"
import { store, useStore } from "@/lib/store"

/**
 * The header button and its card of facts about the thread (T3 Code's thread details).
 * Right-click the card to choose which rows it shows.
 */
export function ThreadDetails({ threadId }: { threadId: Id }) {
  const thread = useStore((s) => s.threads.find((t) => t.id === threadId) ?? s.done.find((t) => t.id === threadId))
  const isDone = useStore((s) => !s.threads.some((t) => t.id === threadId) && s.done.some((t) => t.id === threadId))
  const messages = useStore((s) => s.details[threadId]?.messages)
  const connection = useStore((s) => s.connection)
  const project = useStore((s) => s.projects.find((p) => p.id === thread?.projectId))
  const personalities = useStore((s) => s.personalities)
  const model = useStore((s) => s.threadModels[threadId] ?? s.defaultModel)
  const defaultEffort = useStore((s) => s.defaultEffort)
  const show = useAppearance((s) => s.settings.threadDetails)

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
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" />}
        aria-label="Thread details"
        title="Thread details"
      >
        <Info />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 rounded-2xl p-1.5">
        <ContextMenu>
          <ContextMenuTrigger className="flex flex-col">
            {show.machine && (
              <Row icon={local ? Laptop : Server}>
                {connection.state === "connected" ? connection.server : "Not connected"}
              </Row>
            )}
            {show.project && project && (
              <Row icon={() => <ProjectBadge name={project.name} className="size-4.5 text-[0.55rem]" />}>{project.name}</Row>
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
                    appearance.update({ threadDetails: { ...appearance.get().settings.threadDetails, [key]: !show[key] } })
                  }
                >
                  {label}
                </ContextMenuCheckboxItem>
              ))}
            </ContextMenuGroup>
          </ContextMenuContent>
        </ContextMenu>
      </PopoverContent>
    </Popover>
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
