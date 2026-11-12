import { memo } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable"
import * as Haptics from "expo-haptics"
import type { Thread } from "@kitab/core/model"
import { relativeTime, sourceName } from "@kitab/core/format"
import { shortModelName } from "@kitab/core/model-names"
import { shownStatus } from "@kitab/core/subagents"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { useUnseen } from "@/lib/prefs"
import type { ProjectTint } from "@/lib/tint"
import { Avatar, Icon, ProjectBadge, StatusDot } from "./ui"

export type RowAction = { label: string; icon: "checkmark" | "arrow.uturn.backward"; run: () => void }

const open = (t: Thread) => router.push(`/thread/${encodeURIComponent(t.id)}`)

/** Swipe left for the row's action (Done, or Restore in the done list). */
function Swipe({ action, children }: { action?: RowAction; children: React.ReactElement }) {
  const c = useColors()
  if (!action) return children
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
      {children}
    </ReanimatedSwipeable>
  )
}

/** A thread in a list. In a project folder, `tint` draws it in the folder's color. */
export const ThreadRow = memo(function ThreadRow({ thread: t, action, tint, last }: { thread: Thread; action?: RowAction; tint?: ProjectTint; last?: boolean }) {
  const c = useColors()
  const personalities = useStore((s) => s.personalities)
  const status = useStore((s) => shownStatus(t, s.subagents))
  const cast = t.cast.map((id) => personalities.find((p) => p.id === id)).filter((p) => p !== undefined)
  const bg = tint ? tint.card : c.canvas

  return (
    <Swipe action={action}>
      <Pressable onPress={() => open(t)} style={({ pressed }) => ({ backgroundColor: pressed ? (tint ? tint.pressed : c.secondary) : bg })}>
        <View style={{ paddingHorizontal: tint ? 12 : 16, paddingVertical: tint ? 10 : 12, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {t.fromRun ? <Icon name="clock.arrow.circlepath" size={13} color={c.textMuted} /> : null}
            <Text style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: "500" }} numberOfLines={1}>
              {t.title}
            </Text>
            <StatusDot status={status} />
            <Text style={{ color: c.textMuted, fontSize: 13 }}>
              {sourceName(t.source) ? `${sourceName(t.source)} · ` : ""}
              {relativeTime(t.updatedAt)}
            </Text>
          </View>
          {t.preview || cast.length ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {cast.length ? (
                <View style={{ flexDirection: "row" }}>
                  {cast.slice(0, 3).map((p, i) => (
                    <View key={p.id} style={{ marginLeft: i ? -6 : 0, borderRadius: 10, borderWidth: 1.5, borderColor: bg }}>
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
        {last ? null : <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: tint ? 12 : 16 }} />}
      </Pressable>
    </Swipe>
  )
})

/**
 * A thread in the list layout, as on the Mac (T3-style): the project it's in and when it last
 * moved, then its title, then what it's up to (or your first message) and the model it runs on.
 */
export const ThreadCard = memo(function ThreadCard({ thread: t, project, action }: { thread: Thread; project: string; action?: RowAction }) {
  const c = useColors()
  const status = useStore((s) => shownStatus(t, s.subagents))
  // The model picked in this app wins; otherwise what Hermes's list says it last ran on.
  const picked = useStore((s) => s.threadModels[t.id])
  const model = picked?.model ?? t.model
  const unseen = useUnseen(t)

  return (
    <Swipe action={action}>
      <Pressable onPress={() => open(t)} style={({ pressed }) => ({ backgroundColor: pressed ? c.secondary : c.canvas })}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 11, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <ProjectBadge name={project} />
            <Text style={{ flex: 1, color: c.textMuted, fontSize: 13 }} numberOfLines={1}>
              {project}
              {sourceName(t.source) ? ` · ${sourceName(t.source)}` : ""}
            </Text>
            <Text style={{ color: c.textMuted, fontSize: 13 }}>{relativeTime(t.updatedAt)}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {t.fromRun ? <Icon name="clock.arrow.circlepath" size={13} color={c.textMuted} /> : null}
            <Text style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
              {t.title}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 18 }}>
            <CardStatus status={status} stopping={t.stopping} unseen={unseen} />
            {/* At rest: the first thing you asked it. */}
            {status === "idle" && !unseen && t.preview ? (
              <Text style={{ flex: 1, color: c.textMuted, fontSize: 14 }} numberOfLines={1}>
                {t.preview}
              </Text>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            {model ? (
              <Text style={{ color: c.textMuted, fontSize: 13, maxWidth: 130 }} numberOfLines={1}>
                {shortModelName(model.split("/").pop()!)}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 16 }} />
      </Pressable>
    </Swipe>
  )
})

/** A card's bottom-left: what the thread is doing, else whether it has a reply you haven't seen. */
function CardStatus({ status, stopping, unseen }: { status: Thread["status"]; stopping?: boolean; unseen: boolean }) {
  const c = useColors()
  const label = { fontSize: 14, fontWeight: "500" as const }
  if (status === "working")
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <ActivityIndicator size="small" color={c.working} style={{ transform: [{ scale: 0.75 }] }} />
        <Text style={{ ...label, color: c.working }}>{stopping ? "Stopping" : "Working"}</Text>
      </View>
    )
  if (status === "needs-you")
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.warning }} />
        <Text style={{ ...label, color: c.warningText }}>Awaiting you</Text>
      </View>
    )
  if (unseen)
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.unread }} />
        <Text style={{ ...label, fontWeight: "600", color: c.unreadText }}>New reply</Text>
      </View>
    )
  return null
}
