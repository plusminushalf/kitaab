import { Pressable, Text, View } from "react-native"
import * as Haptics from "expo-haptics"
import type { Id } from "@kitab/core/model"
import { backend } from "@kitab/core/backend"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { Icon } from "./ui"

/** Messages waiting for the running reply to finish, oldest first. Sits above the composer. */
export function QueuedCard({ threadId }: { threadId: Id }) {
  const c = useColors()
  const queue = useStore((s) => s.queued[threadId])
  if (!queue?.items.length) return null
  return (
    <View style={{ marginHorizontal: 12, marginBottom: 8, backgroundColor: c.surface, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 12, gap: 4, borderWidth: 1, borderColor: c.border }}>
      <Text style={{ color: c.textMuted, fontSize: 12 }}>
        {queue.paused ? "Queued · held because the reply was stopped" : "Queued · sends when the reply finishes"}
      </Text>
      {queue.items.map((q) => {
        const files = q.attachments.length
        const label = q.text.trim().split("\n")[0] || `${files} ${files === 1 ? "file" : "files"}`
        return (
          <View key={q.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: 15 }}>
              {label}
            </Text>
            <Pressable
              onPress={() => {
                void Haptics.selectionAsync()
                void backend.sendQueuedNow(threadId, q.id)
              }}
              hitSlop={6}
              accessibilityLabel="Interrupt the reply and send this now"
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, paddingHorizontal: 6, paddingVertical: 4 })}
            >
              <Text style={{ color: c.accent, fontSize: 14, fontWeight: "600" }}>Send now</Text>
            </Pressable>
            <Pressable
              onPress={() => backend.unqueue(threadId, q.id)}
              hitSlop={8}
              accessibilityLabel="Remove from queue"
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
            >
              <Icon name="xmark" size={13} color={c.textMuted} />
            </Pressable>
          </View>
        )
      })}
    </View>
  )
}
