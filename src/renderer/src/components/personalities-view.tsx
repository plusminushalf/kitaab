import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { PageHeader } from "@/components/page-header"
import { useStore } from "@/lib/store"

export function PersonalitiesView() {
  const personalities = useStore((s) => s.personalities)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Personalities" />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {personalities.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyTitle>No personalities</EmptyTitle>
              <EmptyDescription>Personalities are the cast your threads and routines use.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="mx-auto max-w-3xl gap-2 p-6">
            {personalities.map((p) => (
              <Item key={p.id} variant="outline">
                <ItemContent>
                  <ItemTitle>{p.name}</ItemTitle>
                  {p.description && <ItemDescription className="line-clamp-2">{p.description}</ItemDescription>}
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}
      </div>
    </div>
  )
}
