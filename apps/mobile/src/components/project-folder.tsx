import { memo } from "react"
import { ActivityIndicator, Pressable, Text, View } from "react-native"
import { router } from "expo-router"
import * as Clipboard from "expo-clipboard"
import * as Haptics from "expo-haptics"
import { MenuView } from "@expo/ui/community/menu"
import { backend } from "@kitab/core/backend"
import { homePath } from "@kitab/core/format"
import { GENERAL, type Project, type Thread } from "@kitab/core/model"
import { toast } from "@kitab/core/platform"
import { shownStatus } from "@kitab/core/subagents"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { useProjectTint } from "@/lib/tint"
import { confirmRemoveProject, newThreadIn } from "./profile-menu"
import { ThreadRow } from "./thread-row"
import { Icon } from "./ui"

/**
 * A project as a Dia-style folder (as on the Mac): it takes its project's color, and open it's a
 * card in that color with its threads inside. Shut, it still says if something in it is working
 * or waiting on you. Tap to open or shut; … for a new thread in it, its path, rename or remove.
 */
export const ProjectFolder = memo(function ProjectFolder({
  project: p,
  threads,
  allThreads,
  open,
  onToggle,
  showEmpty,
}: {
  project: Project
  /** Its threads as shown (searched and sorted). */
  threads: Thread[]
  /** All of them, for the shut folder's status. */
  allThreads: Thread[]
  open: boolean
  onToggle: () => void
  showEmpty: boolean
}) {
  const c = useColors()
  const tint = useProjectTint(p.name)
  const subagents = useStore((s) => s.subagents)
  const statuses = open ? [] : allThreads.map((t) => shownStatus(t, subagents))
  const status = statuses.includes("working") ? "working" : statuses.includes("needs-you") ? "needs-you" : null
  const general = p.id === GENERAL

  return (
    <View
      style={{
        marginHorizontal: 10,
        marginVertical: open ? 4 : 0,
        borderRadius: 16,
        borderCurve: "continuous",
        overflow: "hidden",
        borderWidth: 1,
        borderColor: open ? tint.cardBorder : "transparent",
        backgroundColor: open ? tint.card : "transparent",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Pressable
          onPress={() => {
            void Haptics.selectionAsync()
            onToggle()
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 9, paddingLeft: 12, paddingVertical: 12 }}
        >
          <Icon name="folder.fill" size={17} color={tint.icon} />
          <Text style={{ flexShrink: 1, color: tint.name, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
            {p.name}
          </Text>
          <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
            <Icon name="chevron.right" size={11} weight="semibold" color={tint.chevron} />
          </View>
          <View style={{ flex: 1 }} />
          {status === "working" ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <ActivityIndicator size="small" color={c.working} style={{ transform: [{ scale: 0.75 }] }} />
              <Text style={{ color: c.working, fontSize: 13, fontWeight: "500" }}>Working</Text>
            </View>
          ) : status === "needs-you" ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.warning }} />
              <Text style={{ color: c.warningText, fontSize: 13, fontWeight: "500" }}>Needs you</Text>
            </View>
          ) : null}
        </Pressable>
        <MenuView
          title={general ? undefined : p.folder && homePath(p.folder)}
          actions={[
            { id: "new-thread", title: general ? "New thread without a project" : `New thread in ${p.name}`, image: "square.and.pencil" },
            ...(general
              ? []
              : [
                  ...(p.folder ? [{ id: "copy", title: "Copy folder path", image: "doc.on.doc" as const }] : []),
                  { id: "rename", title: "Rename…", image: "pencil" as const },
                  { id: "remove", title: "Remove from list…", image: "trash" as const, attributes: { destructive: true } },
                ]),
          ]}
          onPressAction={({ nativeEvent }) => {
            const id = nativeEvent.event
            if (id === "new-thread") newThreadIn(p.id)
            else if (id === "copy" && p.folder) {
              void Clipboard.setStringAsync(p.folder)
              toast("Copied the folder's path")
            } else if (id === "rename") router.push(`/project/${encodeURIComponent(p.id)}`)
            else if (id === "remove") confirmRemoveProject(p)
          }}
        >
          <View style={{ paddingHorizontal: 12, paddingVertical: 12 }} accessibilityLabel={`${p.name} options`}>
            <Icon name="ellipsis" size={16} color={tint.chevron} />
          </View>
        </MenuView>
      </View>
      {open ? (
        <View style={{ paddingBottom: 4 }}>
          {threads.map((t, i) => (
            <ThreadRow
              key={t.id}
              thread={t}
              tint={tint}
              last={i === threads.length - 1}
              action={{ label: "Done", icon: "checkmark", run: () => void backend.setDone(t.id, true) }}
            />
          ))}
          {threads.length === 0 && showEmpty ? <Text style={{ color: c.textMuted, fontSize: 14, paddingHorizontal: 12, paddingBottom: 8 }}>No threads yet</Text> : null}
        </View>
      ) : null}
    </View>
  )
})
