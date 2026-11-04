import { Text, View } from "react-native"
import { router } from "expo-router"
import { MenuView } from "@expo/ui/community/menu"
import * as Haptics from "expo-haptics"
import { backend } from "@kitab/core/backend"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { Icon } from "./ui"

/** Header control: which project you're in, and switching to another. */
export function ProjectMenu() {
  const c = useColors()
  const projects = useStore((s) => s.projects)
  const projectId = useStore((s) => s.projectId)
  const current = projects.find((p) => p.id === projectId)

  return (
    <MenuView
      title="Projects"
      actions={[
        ...projects.map((p) => ({ id: `project:${p.id}`, title: p.name, state: p.id === projectId ? ("on" as const) : ("off" as const) })),
        { id: "settings", title: "Project settings", image: "slider.horizontal.3", displayInline: true },
      ]}
      onPressAction={({ nativeEvent }) => {
        const id = nativeEvent.event
        if (id === "settings") return router.push("/project")
        if (id.startsWith("project:")) {
          void Haptics.selectionAsync()
          void backend.selectProject(id.slice(8))
        }
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 8 }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
          {current?.name ?? "Kitab"}
        </Text>
        <Icon name="chevron.down" size={11} weight="semibold" color={c.textMuted} />
      </View>
    </MenuView>
  )
}
