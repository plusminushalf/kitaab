import { useMemo, useState } from "react"
import { Pressable, RefreshControl, SectionList, Text, View } from "react-native"
import { router, Stack } from "expo-router"
import { backend } from "@kitab/core/backend"
import { GENERAL, type Project } from "@kitab/core/model"
import { MenuView } from "@expo/ui/community/menu"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { ConnectionBanner } from "@/components/connection-banner"
import { ProfileMenu, promptNewProject, useProfileProjects } from "@/components/profile-menu"
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
  // One section per project, General first. Only General: one untitled list. A project with
  // no threads still shows (so a new one is there to start in), except while searching.
  const searching = query.trim().length > 0
  const sections = useMemo(() => {
    if (projects.length === 1) return threads.length ? [{ project: projects[0], title: "", data: threads }] : []
    return projects
      .map((p) => ({ project: p, title: p.name, data: threads.filter((t) => t.projectId === p.id) }))
      .filter((sec) => sec.data.length > 0 || (!searching && sec.project.id !== GENERAL))
  }, [projects, threads, searching])

  /** A new thread in `projectId`: it becomes the picked project first. */
  function newThreadIn(projectId: string) {
    backend.selectProject(projectId)
    router.push("/thread/new")
  }

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
        renderSectionHeader={({ section }) => (section.title ? <ProjectHeader project={section.project} onNewThread={() => newThreadIn(section.project.id)} /> : null)}
        renderSectionFooter={({ section }) =>
          section.title && !section.data.length ? <Text style={{ color: c.textMuted, fontSize: 14, paddingHorizontal: 16, paddingVertical: 8 }}>No threads yet</Text> : null
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

/** A project's name over its threads. Tap for a new thread in it, or to edit the project. */
function ProjectHeader({ project, onNewThread }: { project: Project; onNewThread: () => void }) {
  const c = useColors()
  const general = project.id === GENERAL
  return (
    <MenuView
      title={general ? "General" : project.folder}
      actions={[
        { id: "new-thread", title: "New thread here", image: "square.and.pencil" },
        general
          ? { id: "new-project", title: "New project…", image: "folder.badge.plus" }
          : { id: "edit", title: "Rename or remove…", image: "pencil" },
      ]}
      onPressAction={({ nativeEvent }) => {
        const id = nativeEvent.event
        if (id === "new-thread") onNewThread()
        else if (id === "new-project") promptNewProject(true)
        else if (id === "edit") router.push(`/project/${encodeURIComponent(project.id)}`)
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 }}>
        <Icon name={general ? "tray" : "folder"} size={13} color={c.textMuted} />
        <Text style={{ color: c.textMuted, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>
          {project.name}
        </Text>
        <Icon name="chevron.down" size={9} weight="semibold" color={c.textMuted} />
      </View>
    </MenuView>
  )
}
