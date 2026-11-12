import { useEffect, useMemo, useState } from "react"
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native"
import { router, Stack } from "expo-router"
import { MenuView } from "@expo/ui/community/menu"
import * as Haptics from "expo-haptics"
import { backend } from "@kitab/core/backend"
import { GENERAL, NO_PROJECT, type Thread } from "@kitab/core/model"
import type { ThreadScope } from "@kitab/core/store"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { adoptUnknown, setPrefs, sortThreads, toggleCollapsed, usePrefs, type ThreadSort } from "@/lib/prefs"
import { ConnectionBanner } from "@/components/connection-banner"
import { ProfileMenu, promptNewProject, startNewThread, useProfileProjects } from "@/components/profile-menu"
import { ProjectFolder } from "@/components/project-folder"
import { ThreadCard, ThreadRow, type RowAction } from "@/components/thread-row"
import { Empty, HeaderButton, Icon } from "@/components/ui"

const SORTS: { id: ThreadSort; title: string }[] = [
  { id: "activity", title: "Last activity" },
  { id: "status", title: "Status" },
  { id: "title", title: "Title" },
]

const doneAction = (t: Thread): RowAction => ({ label: "Done", icon: "checkmark", run: () => void backend.setDone(t.id, true) })

/**
 * The open profile's threads, laid out as on the Mac (Settings → Threads list): one list of
 * cards across every project, each saying where it lives, or Dia-style project folders. A
 * profile with only General has no projects to show, so it's a plain list either way.
 */
export default function Threads() {
  const c = useColors()
  const profileId = useStore((s) => s.profileId)
  const all = useStore((s) => s.threads)
  const doneCount = useStore((s) => s.doneCount)
  const connected = useStore((s) => s.connection.state === "connected")
  const threadScope = useStore((s) => s.threadScope)
  const showRoutineReports = useStore((s) => s.showRoutineReports)
  const { layout, sort, collapsed } = usePrefs()
  const [query, setQuery] = useState("")
  const [refreshing, setRefreshing] = useState(false)

  const projects = useProfileProjects()
  const profileThreads = useMemo(() => all.filter((t) => t.profileId === profileId), [all, profileId])
  // Threads seen for the first time count as read, so only later replies show as new.
  useEffect(() => adoptUnknown(profileThreads), [profileThreads])

  const q = query.trim().toLowerCase()
  const searching = q.length > 0
  const threads = useMemo(
    () => sortThreads(searching ? profileThreads.filter((t) => t.title.toLowerCase().includes(q) || t.preview?.toLowerCase().includes(q)) : profileThreads, sort),
    [profileThreads, q, searching, sort],
  )
  const flat = projects.length === 1
  const folders = !flat && layout === "folders"
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])

  // Each project with its threads, General first. Searching hides projects with no match and
  // opens the rest; an empty General folder is left out.
  const shut = useMemo(() => new Set(profileId ? (collapsed[profileId] ?? []) : []), [collapsed, profileId])
  const groups = useMemo(
    () =>
      folders
        ? projects
            .map((p) => ({ project: p, all: profileThreads.filter((t) => t.projectId === p.id), threads: threads.filter((t) => t.projectId === p.id) }))
            .filter((g) => (searching ? g.threads.length > 0 : g.project.id !== GENERAL || g.all.length > 0))
        : [],
    [folders, projects, profileThreads, threads, searching],
  )

  async function refresh() {
    if (!profileId) return void backend.connect()
    setRefreshing(true)
    await backend.selectProfile(profileId).finally(() => setRefreshing(false))
  }

  const common = {
    contentInsetAdjustmentBehavior: "automatic" as const,
    refreshControl: <RefreshControl refreshing={refreshing} onRefresh={refresh} />,
    ListHeaderComponent: <ConnectionBanner />,
    ListEmptyComponent: connected ? (
      <Empty
        icon="bubble.left.and.bubble.right"
        title={searching ? "No matching threads" : "No threads yet"}
        body={searching ? undefined : "Start one with the compose button. Threads you start on the Mac show up here too."}
      />
    ) : undefined,
    ListFooterComponent:
      doneCount > 0 && !searching ? (
        <Pressable onPress={() => router.push("/done")} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 16, marginTop: folders ? 8 : 0 }}>
          <Icon name="checkmark.circle" size={16} color={c.textMuted} />
          <Text style={{ flex: 1, color: c.textMuted, fontSize: 15 }}>Done</Text>
          <Text style={{ color: c.textMuted, fontSize: 15 }}>{doneCount}</Text>
          <Icon name="chevron.right" size={12} color={c.textMuted} />
        </Pressable>
      ) : undefined,
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Threads",
          headerLeft: () => <ProfileMenu />,
          headerRight: () => (
            <View style={{ flexDirection: "row", gap: 18, alignItems: "center" }}>
              <ListMenu sort={sort} scope={threadScope} reports={showRoutineReports} connected={connected} />
              <HeaderButton icon="gearshape" label="Settings" onPress={() => router.push("/settings")} />
              <HeaderButton icon="square.and.pencil" label="New thread" onPress={startNewThread} />
            </View>
          ),
          headerSearchBarOptions: { placeholder: "Search threads", onChangeText: (e) => setQuery(e.nativeEvent.text), hideWhenScrolling: true },
        }}
      />
      {folders ? (
        <FlatList
          key="folders"
          {...common}
          data={groups}
          keyExtractor={(g) => g.project.id}
          renderItem={({ item: g }) => (
            <ProjectFolder
              project={g.project}
              threads={g.threads}
              allThreads={g.all}
              open={searching || !shut.has(g.project.id)}
              onToggle={() => profileId && toggleCollapsed(profileId, g.project.id)}
              showEmpty={connected}
            />
          )}
        />
      ) : (
        <FlatList
          key={flat ? "flat" : "cards"}
          {...common}
          data={threads}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) =>
            flat ? <ThreadRow thread={item} action={doneAction(item)} /> : <ThreadCard thread={item} project={projectNames.get(item.projectId) ?? NO_PROJECT} action={doneAction(item)} />
          }
        />
      )}
    </>
  )
}

/** The list's options: how threads are sorted, which ones show, and adding a project. */
function ListMenu({ sort, scope, reports, connected }: { sort: ThreadSort; scope: ThreadScope; reports: boolean; connected: boolean }) {
  const on = (b: boolean) => (b ? ("on" as const) : ("off" as const))
  return (
    <MenuView
      actions={[
        {
          id: "sort",
          title: "Sort threads by",
          displayInline: true,
          subactions: SORTS.map((s) => ({ id: `sort:${s.id}`, title: s.title, state: s.id === sort ? ("on" as const) : ("off" as const) })),
        },
        {
          id: "show",
          title: "Show",
          displayInline: true,
          subactions: [
            // Conversations started in Telegram, the CLI and the rest, not in Kitaab.
            { id: "other-apps", title: "Other apps", state: on(scope === "all") },
            // Reports routines delivered to Telegram and other chats; they only come from other apps.
            { id: "routine-reports", title: "Routine reports", state: on(reports && scope === "all"), attributes: { disabled: scope !== "all" } },
          ],
        },
        { id: "new-project", title: "Add project…", image: "folder.badge.plus", attributes: { disabled: !connected } },
      ]}
      onPressAction={({ nativeEvent }) => {
        const id = nativeEvent.event
        if (id === "new-project") return promptNewProject(true)
        if (id === "other-apps") {
          void Haptics.selectionAsync()
          return void backend.setThreadScope(scope === "all" ? "kitaab" : "all")
        }
        if (id === "routine-reports") {
          void Haptics.selectionAsync()
          return void backend.setShowRoutineReports(!reports)
        }
        if (id.startsWith("sort:")) {
          void Haptics.selectionAsync()
          setPrefs({ sort: id.slice(5) as ThreadSort })
        }
      }}
    >
      <View style={{ padding: 4 }} accessibilityLabel="Sort, filter and add project">
        <Icon name="line.3.horizontal.decrease" size={20} />
      </View>
    </MenuView>
  )
}
