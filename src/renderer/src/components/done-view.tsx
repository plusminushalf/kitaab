import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { PageHeader } from "@/components/page-header"
import { backend } from "@kitab/core/backend"
import { relativeTime } from "@kitab/core/format"
import { store, useStore } from "@/lib/store"
import { useShortcutLabel } from "@/lib/shortcuts"

/** Threads marked done. Open one to read it, or bring it back to the list. */
export function DoneView() {
  const done = useStore((s) => s.done)
  const doneKey = useShortcutLabel("mark-done")
  const count = useStore((s) => s.doneCount)

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
              <Item key={t.id} variant="outline" size="sm">
                <ItemContent
                  className="cursor-default"
                  onClick={() => store.go({ kind: "thread", threadId: t.id })}
                >
                  <ItemTitle>{t.title}</ItemTitle>
                  <ItemDescription>{relativeTime(t.updatedAt)}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button size="sm" variant="ghost" onClick={() => void backend.setDone(t.id, false)}>
                    <RotateCcw />
                    Not done
                  </Button>
                </ItemActions>
              </Item>
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
