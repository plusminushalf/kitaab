import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Text, View } from "react-native"
import { LegendList } from "@legendapp/list/react-native"
import { router, Stack, useLocalSearchParams } from "expo-router"
import Animated, { useAnimatedStyle } from "react-native-reanimated"
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { MenuView } from "@expo/ui/community/menu"
import type { Attachment, Message } from "@kitab/core/model"
import { backend } from "@kitab/core/backend"
import { toast } from "@kitab/core/platform"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { Composer } from "@/components/composer"
import { MessageRow } from "@/components/message"
import { PendingCard } from "@/components/pending"
import { Avatar, Empty, Icon } from "@/components/ui"

export default function ThreadScreen() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ id: string }>()
  const id = params.id === "new" ? null : decodeURIComponent(params.id)

  const thread = useStore((s) => (id ? (s.threads.find((t) => t.id === id) ?? s.done.find((t) => t.id === id)) : undefined))
  const isDone = useStore((s) => (id ? !s.threads.some((t) => t.id === id) && s.done.some((t) => t.id === id) : false))
  const detail = useStore((s) => (id ? s.details[id] : undefined))
  const connected = useStore((s) => s.connection.state === "connected")
  const projectId = useStore((s) => s.projectId)
  const projects = useStore((s) => s.projects)
  const personalities = useStore((s) => s.personalities)

  // The new-thread screen shows what you sent until the thread exists.
  const [draft, setDraft] = useState<Message | null>(null)

  useEffect(() => {
    if (id && connected && (!detail || detail.stale)) void backend.loadThread(id)
  }, [id, connected, detail])

  const projectCast = useMemo(() => {
    const ids = projects.find((p) => p.id === (thread?.projectId ?? projectId))?.personalityIds ?? []
    return personalities.filter((p) => ids.includes(p.id))
  }, [projects, personalities, thread?.projectId, projectId])
  const threadCast = (thread?.cast ?? []).map((pid) => personalities.find((p) => p.id === pid)).filter((p) => p !== undefined)

  const messages = detail?.messages ?? (draft ? [draft] : [])
  const working = thread?.status === "working"

  // Keeps the composer on top of the keyboard; the list shrinks with it.
  const { height } = useReanimatedKeyboardAnimation()
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(-height.value, insets.bottom) }))

  async function send(text: string, attachments: Attachment[]) {
    if (!id) setDraft({ id: "draft", role: "user", text, attachments, createdAt: Date.now() })
    try {
      const threadId = await backend.send(id, text, attachments)
      if (!id) router.replace(`/thread/${encodeURIComponent(threadId)}`)
    } catch (e) {
      setDraft(null)
      toast.error(e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={{ alignItems: "center", maxWidth: 240 }}>
              <Text style={{ color: c.text, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
                {thread?.title ?? (id ? "" : "New thread")}
              </Text>
              {threadCast.length ? (
                <Text style={{ color: c.textMuted, fontSize: 12 }} numberOfLines={1}>
                  {threadCast.map((p) => p.name).join(", ")}
                </Text>
              ) : null}
            </View>
          ),
          headerRight: id
            ? () => (
                <MenuView
                  actions={[
                    isDone
                      ? { id: "restore", title: "Bring back", image: "arrow.uturn.backward" }
                      : { id: "done", title: "Mark as done", image: "checkmark.circle" },
                  ]}
                  onPressAction={({ nativeEvent }) => {
                    if (nativeEvent.event === "done") {
                      void backend.setDone(id, true)
                      router.back()
                    } else if (nativeEvent.event === "restore") void backend.setDone(id, false)
                  }}
                >
                  <View style={{ padding: 4 }}>
                    <Icon name="ellipsis.circle" size={22} />
                  </View>
                </MenuView>
              )
            : undefined,
        }}
      />
      <Animated.View style={[{ flex: 1, backgroundColor: c.canvas }, lift]}>
        {id && !detail && connected ? (
          <View style={{ flex: 1, justifyContent: "center" }}>
            <ActivityIndicator />
          </View>
        ) : !id && !draft ? (
          <View style={{ flex: 1, justifyContent: "center" }}>
            <Empty icon="sparkles" title="What are we working on?" body={projectCast.length ? "Type @ to hand it to one of the project's personalities." : undefined}>
              {projectCast.length ? (
                <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                  {projectCast.slice(0, 5).map((p) => (
                    <Avatar key={p.id} name={p.name} size={28} />
                  ))}
                </View>
              ) : null}
            </Empty>
          </View>
        ) : (
          // Not inverted: content sits at the bottom and follows new replies, and iOS's
          // glass header and scroll-edge effects work the way they expect.
          <LegendList
            key={id ?? "new"}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <MessageRow message={item} />}
            estimatedItemSize={96}
            recycleItems={false}
            alignItemsAtEnd
            initialScrollAtEnd
            maintainScrollAtEnd
            maintainVisibleContentPosition
            contentInsetAdjustmentBehavior="automatic"
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingVertical: 12 }}
          />
        )}
        {id ? detail?.pending.map((q) => <PendingCard key={q.id} threadId={id} question={q} />) : null}
        <Composer
          threadId={id}
          working={working}
          cast={projectCast}
          placeholder={id ? "Reply" : "Start a thread"}
          onSend={send}
          onStop={id ? () => void backend.interrupt(id) : undefined}
        />
      </Animated.View>
    </>
  )
}
