import { useMemo } from "react"
import { Alert, Text, View } from "react-native"
import { router } from "expo-router"
import { MenuView } from "@expo/ui/community/menu"
import * as Haptics from "expo-haptics"
import { backend } from "@kitab/core/backend"
import { toast } from "@kitab/core/platform"
import { GENERAL, NO_PROJECT, type Project } from "@kitab/core/model"
import { store, useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { Icon } from "./ui"

/** Header control: which profile you're in, and switching to another. */
export function ProfileMenu() {
  const c = useColors()
  const profiles = useStore((s) => s.profiles)
  const profileId = useStore((s) => s.profileId)
  const current = profiles.find((p) => p.id === profileId)

  return (
    <MenuView
      title="Profiles"
      actions={[
        ...profiles.map((p) => ({ id: `profile:${p.id}`, title: p.name, state: p.id === profileId ? ("on" as const) : ("off" as const) })),
        { id: "new-project", title: "New project…", image: "folder.badge.plus", displayInline: true },
        { id: "settings", title: "Profile settings", image: "slider.horizontal.3", displayInline: true },
      ]}
      onPressAction={({ nativeEvent }) => {
        const id = nativeEvent.event
        if (id === "settings") return router.push("/profile")
        if (id === "new-project") return promptNewProject(true)
        if (id.startsWith("profile:")) {
          void Haptics.selectionAsync()
          void backend.selectProfile(id.slice(8))
        }
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 8 }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
          {current?.name ?? "Kitaab"}
        </Text>
        <Icon name="chevron.down" size={11} weight="semibold" color={c.textMuted} />
      </View>
    </MenuView>
  )
}

/** The open profile's projects, General first. */
export function useProfileProjects(): Project[] {
  const profileId = useStore((s) => s.profileId)
  const projects = useStore((s) => (s.profileId ? s.projects[s.profileId] : undefined))
  return useMemo(() => [{ id: GENERAL, profileId: profileId ?? "", name: NO_PROJECT, folders: [] }, ...(projects ?? [])], [profileId, projects])
}

/** Opens the new-project form. `thenThread` opens a new thread in the project once it's made. */
export function promptNewProject(thenThread = false) {
  router.push(thenThread ? "/project/new?then=thread" : "/project/new")
}

/**
 * The compose button: asks which project the thread goes in (as ⌘N does on the Mac). A
 * profile with only General has nothing to ask, so it goes straight to the new thread.
 */
export function startNewThread() {
  const s = store.get()
  const projects = s.profileId ? (s.projects[s.profileId] ?? []) : []
  router.push(projects.length ? "/new-thread" : "/thread/new")
}

/** A new thread in `projectId`: it becomes the picked project first. */
export function newThreadIn(projectId: string) {
  backend.selectProject(projectId)
  router.push("/thread/new")
}

/** Takes a project off the list, after asking. Its threads stay, with no project. */
export function confirmRemoveProject(project: Project, then?: () => void) {
  Alert.alert(`Remove ${project.name}?`, "Its threads stay, with no project. Its folder and threads stay on the server.", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Remove",
      style: "destructive",
      onPress: () =>
        backend.removeProject(project.id).then(
          () => {
            toast(`Removed ${project.name}`)
            then?.()
          },
          (e) => toast.error(`Couldn't remove it: ${e instanceof Error ? e.message : String(e)}`),
        ),
    },
  ])
}

/** "in General ▾" under a new thread's title: which project it starts in, and changing that. */
export function NewThreadProjectMenu() {
  const c = useColors()
  const projects = useProfileProjects()
  const projectId = useStore((s) => s.projectId)
  const current = projects.find((p) => p.id === projectId) ?? projects[0]
  return (
    <MenuView
      title="Start it in"
      actions={[
        ...projects.map((p) => ({ id: `project:${p.id}`, title: p.name, state: p.id === current.id ? ("on" as const) : ("off" as const) })),
        { id: "new", title: "New project…", image: "folder.badge.plus", displayInline: true },
      ]}
      onPressAction={({ nativeEvent }) => {
        const id = nativeEvent.event
        if (id === "new") return promptNewProject()
        if (id.startsWith("project:")) {
          void Haptics.selectionAsync()
          backend.selectProject(id.slice(8))
        }
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
        <Text style={{ color: c.textMuted, fontSize: 12 }} numberOfLines={1}>
          {current.id === GENERAL ? NO_PROJECT : `in ${current.name}`}
        </Text>
        <Icon name="chevron.down" size={9} weight="semibold" color={c.textMuted} />
      </View>
    </MenuView>
  )
}
