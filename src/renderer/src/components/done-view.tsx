import { useMemo } from "react"
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item"
import { PageHeader } from "@/components/page-header"
import { ProjectBadge } from "@/components/project-badge"
import { providerIcon, providerTint } from "@/components/model-picker"
import { useProfileProjects } from "@/components/project-menu"
import { backend } from "@kitab/core/backend"
import { relativeTime, sourceName } from "@kitab/core/format"
import { NO_PROJECT, type Thread } from "@kitab/core/model"
import { modelName, shortModelName } from "@kitab/core/model-names"
import { store, useStore } from "@/lib/store"
import { useShortcutLabel } from "@/lib/shortcuts"
import { cn } from "@/lib/utils"

/** Threads marked done. Open one to read it, or bring it back to the list. */
export function DoneView() {
  const done = useStore((s) => s.done)
  const doneKey = useShortcutLabel("mark-done")
  const count = useStore((s) => s.doneCount)
  const projects = useProfileProjects()
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Done">
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {done.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyTitle>Nothing done yet</EmptyTitle>
              <EmptyDescription>Hover a thread and click the tick{doneKey ? `, or press ${doneKey},` : ""} to mark it done.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="mx-auto max-w-3xl gap-2 p-6">
            {done.map((t) => (
              <DoneItem key={t.id} thread={t} project={projectNames.get(t.projectId) ?? NO_PROJECT} />
            ))}
            {count > done.length && (
              <p className="px-1 text-xs text-muted-foreground">Showing the latest {done.length} of {count}.</p>
            )}
          </ItemGroup>
        )}
      </div>
    </div>
  )
}

/** A done thread: its title, then the project it's in, the model it ran on and when it last moved. */
function DoneItem({ thread: t, project }: { thread: Thread; project: string }) {
  // The model picked in this app wins; otherwise what Hermes's list says it last ran on.
  const picked = useStore((s) => s.threadModels[t.id])
  const model = (picked?.model ?? t.model)?.split("/").pop()
  const slug = `${picked?.provider ?? t.provider ?? ""}/${model ?? ""}`
  const Mark = providerIcon(slug)
  return (
    <Item variant="outline" size="sm">
      <ItemContent className="cursor-default" onClick={() => store.go({ kind: "thread", threadId: t.id })}>
        <ItemTitle>{t.title}</ItemTitle>
        <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <ProjectBadge name={project} className="size-4 text-[0.5rem]" />
          <span className="min-w-0 truncate">{project}</span>
          {sourceName(t.source) && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0">{sourceName(t.source)}</span>
            </>
          )}
          {model && (
            <>
              <span aria-hidden>·</span>
              <Mark className={cn("size-3.5 shrink-0", providerTint(slug))} />
              <span title={modelName(model)} className="shrink-0">
                {shortModelName(model)}
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <span className="shrink-0 tabular-nums">{relativeTime(t.updatedAt)}</span>
        </div>
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="ghost" onClick={() => void backend.setDone(t.id, false)}>
          <RotateCcw />
          Not done
        </Button>
      </ItemActions>
    </Item>
  )
}
