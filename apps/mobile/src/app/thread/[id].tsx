import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Text, View } from "react-native"
import { LegendList } from "@legendapp/list/react-native"
import { router, Stack, useLocalSearchParams } from "expo-router"
import Animated, { useAnimatedStyle } from "react-native-reanimated"
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { MenuView } from "@expo/ui/community/menu"
import * as Clipboard from "expo-clipboard"
import { GENERAL, type Attachment, type Message } from "@kitab/core/model"
import { backend } from "@kitab/core/backend"
import { plainReplySpeaker } from "@kitab/core/personalities"
import { toast } from "@kitab/core/platform"
import { store, useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { Composer } from "@/components/composer"
import { MessageRow } from "@/components/message"
import { PendingCard } from "@/components/pending"
import { QueuedCard } from "@/components/queued"
import { Avatar, Empty, Icon } from "@/components/ui"
import { NewThreadProjectMenu } from "@/components/profile-menu"

export default function ThreadScreen() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ id: string }>()
  const id = params.id === "new" ? null : decodeURIComponent(params.id)

  const thread = useStore((s) => (id ? (s.threads.find((t) => t.id === id) ?? s.done.find((t) => t.id === id)) : undefined))
  const isDone = useStore((s) => (id ? !s.threads.some((t) => t.id === id) && s.done.some((t) => t.id === id) : false))
  const detail = useStore((s) => (id ? s.details[id] : undefined))
  const connected = useStore((s) => s.connection.state === "connected")
  const profileId = useStore((s) => s.profileId)
  const profiles = useStore((s) => s.profiles)
  const personalities = useStore((s) => s.personalities)

  // Which project it's in, named only when the profile has projects besides General.
  const project = useStore((s) => (thread ? s.projects[thread.profileId]?.find((p) => p.id === thread.projectId) : undefined))
  const hasProjects = useStore((s) => (s.projects[thread?.profileId ?? s.profileId ?? ""]?.length ?? 0) > 0)
  const folder = thread?.cwd ?? project?.folder

  // The open thread's project is where the next new thread goes (as on the Mac).
  useEffect(() => {
    if (!thread || thread.fromRun) return
    const s = store.get()
    if (thread.profileId === s.profileId && thread.projectId !== s.projectId) backend.selectProject(thread.projectId)
  }, [thread?.id, thread?.projectId])

  // The new-thread screen shows what you sent until the thread exists.
  const [draft, setDraft] = useState<Message | null>(null)

  useEffect(() => {
    if (id && connected && (!detail || detail.stale)) void backend.loadThread(id)
  }, [id, connected, detail])
  // Hermes no longer has it (the core says so and takes it off the lists).
  useEffect(() => {
    if (detail?.missing && router.canGoBack()) router.back()
  }, [detail?.missing])

  const profileCast = useMemo(() => {
    const ids = profiles.find((p) => p.id === (thread?.profileId ?? profileId))?.personalityIds ?? []
    return personalities.filter((p) => ids.includes(p.id))
  }, [profiles, personalities, thread?.profileId, profileId])
  // Who a plain reply goes to (the last to answer, else the host), as the core decides it.
  const answers = useMemo(() => {
    const pid = id && thread ? plainReplySpeaker(id, thread.cast) : undefined
    return pid ? personalities.find((p) => p.id === pid) : undefined
  }, [id, thread, personalities])
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
              {!id ? (
                <NewThreadProjectMenu />
              ) : threadCast.length || (hasProjects && thread && !thread.fromRun) ? (
                <Text style={{ color: c.textMuted, fontSize: 12 }} numberOfLines={1}>
                  {[hasProjects && thread && !thread.fromRun ? (project?.name ?? (thread.projectId === GENERAL ? "General" : undefined)) : undefined, threadCast.map((p) => p.name).join(", ")]
                    .filter(Boolean)
                    .join(" · ")}
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
                    ...(folder ? [{ id: "copy-folder", title: "Copy folder path", image: "folder" as const }] : []),
                  ]}
                  onPressAction={({ nativeEvent }) => {
                    if (nativeEvent.event === "done") {
                      void backend.setDone(id, true)
                      router.back()
                    } else if (nativeEvent.event === "restore") void backend.setDone(id, false)
                    else if (nativeEvent.event === "copy-folder" && folder) {
                      void Clipboard.setStringAsync(folder)
                      toast(`Copied ${folder}`)
                    }
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
            <Empty icon="sparkles" title="What are we working on?" body={profileCast.length ? "Type @ to hand it to one of the profile's personalities." : undefined}>
              {profileCast.length ? (
                <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                  {profileCast.slice(0, 5).map((p) => (
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
        {id ? <QueuedCard threadId={id} /> : null}
        <Composer
          threadId={id}
          working={working}
          cast={profileCast}
          placeholder={id ? (answers ? `Reply to ${answers.name}` : "Reply") : "Start a thread"}
          onSend={send}
          onStop={id ? () => void backend.interrupt(id) : undefined}
        />
      </Animated.View>
    </>
  )
}
