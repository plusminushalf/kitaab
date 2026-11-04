import { memo } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable"
import * as Haptics from "expo-haptics"
import type { Thread } from "@kitab/core/model"
import { relativeTime } from "@kitab/core/format"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { Avatar, Icon, StatusDot } from "./ui"

/** A thread in a list. Swipe left for the action (Done, or Restore in the done list). */
export const ThreadRow = memo(function ThreadRow({
  thread: t,
  action,
}: {
  thread: Thread
  action?: { label: string; icon: "checkmark" | "arrow.uturn.backward"; run: () => void }
}) {
  const c = useColors()
  const personalities = useStore((s) => s.personalities)
  const cast = t.cast.map((id) => personalities.find((p) => p.id === id)).filter((p) => p !== undefined)

  const row = (
    <Pressable onPress={() => router.push(`/thread/${encodeURIComponent(t.id)}`)} style={({ pressed }) => ({ backgroundColor: pressed ? c.secondary : c.canvas })}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {t.fromRun ? <Icon name="clock.arrow.circlepath" size={13} color={c.textMuted} /> : null}
          <Text style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: "500" }} numberOfLines={1}>
            {t.title}
          </Text>
          <StatusDot status={t.status} />
          <Text style={{ color: c.textMuted, fontSize: 13 }}>{relativeTime(t.updatedAt)}</Text>
        </View>
        {t.preview || cast.length ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {cast.length ? (
              <View style={{ flexDirection: "row" }}>
                {cast.slice(0, 3).map((p, i) => (
                  <View key={p.id} style={{ marginLeft: i ? -6 : 0, borderRadius: 10, borderWidth: 1.5, borderColor: c.canvas }}>
                    <Avatar name={p.name} size={18} />
                  </View>
                ))}
              </View>
            ) : null}
            {t.preview ? (
              <Text style={{ flex: 1, color: c.textMuted, fontSize: 14 }} numberOfLines={1}>
                {t.preview}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 16 }} />
    </Pressable>
  )

  if (!action) return row
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={60}
      overshootRight={false}
      onSwipeableOpen={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        action.run()
      }}
      renderRightActions={() => (
        <View style={{ width: 96, backgroundColor: c.done, alignItems: "center", justifyContent: "center", gap: 4 }}>
          <Icon name={action.icon} size={18} color="#fff" weight="semibold" />
          <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>{action.label}</Text>
        </View>
      )}
    >
      {row}
    </ReanimatedSwipeable>
  )
})
