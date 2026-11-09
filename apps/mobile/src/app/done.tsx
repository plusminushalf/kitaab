import { useMemo } from "react"
import { FlatList } from "react-native"
import { backend } from "@kitab/core/backend"
import { NO_PROJECT } from "@kitab/core/model"
import { useStore } from "@/lib/store"
import { useProfileProjects } from "@/components/profile-menu"
import { ThreadCard } from "@/components/thread-row"
import { Empty } from "@/components/ui"

/** Threads marked done, each with its project and model as in the thread list. Swipe one to bring it back. */
export default function Done() {
  const all = useStore((s) => s.done)
  const profileId = useStore((s) => s.profileId)
  const done = useMemo(() => all.filter((t) => t.profileId === profileId), [all, profileId])
  const projects = useProfileProjects()
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      data={done}
      keyExtractor={(t) => t.id}
      renderItem={({ item }) => (
        <ThreadCard
          thread={item}
          project={projectNames.get(item.projectId) ?? NO_PROJECT}
          action={{ label: "Restore", icon: "arrow.uturn.backward", run: () => void backend.setDone(item.id, false) }}
        />
      )}
      ListEmptyComponent={<Empty icon="checkmark.circle" title="Nothing done yet" body="Swipe a thread to mark it done." />}
    />
  )
}
