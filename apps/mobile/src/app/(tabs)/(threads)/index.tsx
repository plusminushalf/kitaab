import { useMemo, useState } from "react"
import { Pressable, RefreshControl, SectionList, Text, View } from "react-native"
import { router, Stack } from "expo-router"
import { backend } from "@kitab/core/backend"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { ConnectionBanner } from "@/components/connection-banner"
import { ProfileMenu, useProfileProjects } from "@/components/profile-menu"
import { ThreadRow } from "@/components/thread-row"
import { Empty, HeaderButton, Icon } from "@/components/ui"

export default function Threads() {
  const c = useColors()
  const profileId = useStore((s) => s.profileId)
  const all = useStore((s) => s.threads)
  const doneCount = useStore((s) => s.doneCount)
  const connected = useStore((s) => s.connection.state === "connected")
  const [query, setQuery] = useState("")
  const [refreshing, setRefreshing] = useState(false)

  const projects = useProfileProjects()
  const threads = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((t) => t.profileId === profileId)
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.preview?.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [all, profileId, query])
  // One section per project with threads, General first. Only General: one untitled list.
  const sections = useMemo(() => {
    if (projects.length === 1) return threads.length ? [{ key: projects[0].id, title: "", data: threads }] : []
    return projects
      .map((p) => ({ key: p.id, title: p.name, data: threads.filter((t) => t.projectId === p.id) }))
      .filter((sec) => sec.data.length > 0)
  }, [projects, threads])

  async function refresh() {
    if (!profileId) return void backend.connect()
    setRefreshing(true)
    await backend.selectProfile(profileId).finally(() => setRefreshing(false))
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Threads",
          headerLeft: () => <ProfileMenu />,
          headerRight: () => (
            <View style={{ flexDirection: "row", gap: 18, alignItems: "center" }}>
              <HeaderButton icon="gearshape" label="Settings" onPress={() => router.push("/settings")} />
              <HeaderButton icon="square.and.pencil" label="New thread" onPress={() => router.push("/thread/new")} />
            </View>
          ),
          headerSearchBarOptions: { placeholder: "Search threads", onChangeText: (e) => setQuery(e.nativeEvent.text), hideWhenScrolling: true },
        }}
      />
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
        keyExtractor={(t) => t.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Text style={{ color: c.textMuted, fontSize: 13, fontWeight: "600", paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 }}>
              {section.title}
            </Text>
          ) : null
        }
        renderItem={({ item }) => <ThreadRow thread={item} action={{ label: "Done", icon: "checkmark", run: () => void backend.setDone(item.id, true) }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListHeaderComponent={<ConnectionBanner />}
        ListEmptyComponent={
          connected ? (
            <Empty icon="bubble.left.and.bubble.right" title={query ? "No matching threads" : "No threads yet"} body={query ? undefined : "Start one with the compose button. Threads you start on the Mac show up here too."} />
          ) : undefined
        }
        ListFooterComponent={
          doneCount > 0 && !query ? (
            <Pressable onPress={() => router.push("/done")} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 16 }}>
              <Icon name="checkmark.circle" size={16} color={c.textMuted} />
              <Text style={{ flex: 1, color: c.textMuted, fontSize: 15 }}>Done</Text>
              <Text style={{ color: c.textMuted, fontSize: 15 }}>{doneCount}</Text>
              <Icon name="chevron.right" size={12} color={c.textMuted} />
            </Pressable>
          ) : undefined
        }
      />
    </>
  )
}
