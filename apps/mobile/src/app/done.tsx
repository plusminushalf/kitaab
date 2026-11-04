import { useMemo } from "react"
import { FlatList } from "react-native"
import { backend } from "@kitab/core/backend"
import { useStore } from "@/lib/store"
import { ThreadRow } from "@/components/thread-row"
import { Empty } from "@/components/ui"

/** Threads marked done. Swipe one to bring it back. */
export default function Done() {
  const all = useStore((s) => s.done)
  const projectId = useStore((s) => s.projectId)
  const done = useMemo(() => all.filter((t) => t.projectId === projectId), [all, projectId])
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      data={done}
      keyExtractor={(t) => t.id}
      renderItem={({ item }) => <ThreadRow thread={item} action={{ label: "Restore", icon: "arrow.uturn.backward", run: () => void backend.setDone(item.id, false) }} />}
      ListEmptyComponent={<Empty icon="checkmark.circle" title="Nothing done yet" body="Swipe a thread to mark it done." />}
    />
  )
}
