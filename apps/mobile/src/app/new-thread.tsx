import { useMemo, useState } from "react"
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import * as Haptics from "expo-haptics"
import { backend } from "@kitab/core/backend"
import { homePath } from "@kitab/core/format"
import type { Project } from "@kitab/core/model"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { useProfileProjects } from "@/components/profile-menu"
import { FolderIcon, Icon } from "@/components/ui"

/**
 * Where a new thread goes (the Mac's ⌘N picker): the open profile's projects, the current one
 * marked, with a search field and New project. `here=1` (from a new thread already open)
 * only changes its project.
 */
export default function NewThreadPicker() {
  const c = useColors()
  const { here } = useLocalSearchParams<{ here?: string }>()
  const projects = useProfileProjects()
  const projectId = useStore((s) => s.projectId)
  const [query, setQuery] = useState("")
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects
  }, [projects, query])

  function pick(p: Project) {
    void Haptics.selectionAsync()
    backend.selectProject(p.id)
    router.dismiss()
    if (!here) router.push("/thread/new")
  }

  function newProject() {
    router.dismiss()
    router.push(here ? "/project/new" : "/project/new?then=thread")
  }

  return (
    // The list is the sheet's only root: iOS sheets size and scroll their first scroll view.
    <FlatList
      style={{ backgroundColor: c.surfaceRaised }}
      data={shown}
      keyExtractor={(p) => p.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: "600", textAlign: "center", paddingTop: 18, paddingBottom: 12 }}>New thread in…</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.secondary }}>
            <Icon name="magnifyingglass" size={15} color={c.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search projects"
              placeholderTextColor={c.textMuted}
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={() => (shown[0] ? pick(shown[0]) : query.trim() ? newProject() : undefined)}
              style={{ flex: 1, color: c.text, fontSize: 16, paddingVertical: 10 }}
            />
          </View>
        </>
      }
      ListEmptyComponent={<Text style={{ color: c.textMuted, fontSize: 14, textAlign: "center", paddingVertical: 24 }}>No matching projects</Text>}
      renderItem={({ item: p }) => (
        <Pressable onPress={() => pick(p)} style={({ pressed }) => ({ backgroundColor: pressed ? c.secondary : "transparent" })}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12 }}>
            <FolderIcon name={p.name} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 16 }} numberOfLines={1}>
                {p.name}
              </Text>
              {p.folder ? (
                <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 1 }} numberOfLines={1}>
                  {homePath(p.folder)}
                </Text>
              ) : null}
            </View>
            {p.id === projectId ? <Icon name="checkmark" size={15} weight="semibold" color={c.textMuted} /> : null}
          </View>
        </Pressable>
      )}
      ListFooterComponent={
        <>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginHorizontal: 20, marginTop: 4 }} />
          <Pressable onPress={newProject} style={({ pressed }) => ({ backgroundColor: pressed ? c.secondary : "transparent" })}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14 }}>
              <Icon name="folder.badge.plus" size={17} color={c.textMuted} />
              <Text style={{ color: c.textMuted, fontSize: 16 }}>New project…</Text>
            </View>
          </Pressable>
        </>
      }
    />
  )
}
