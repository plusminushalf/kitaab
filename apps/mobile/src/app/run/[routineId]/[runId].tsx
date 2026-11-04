import { useEffect } from "react"
import { ActivityIndicator, ScrollView, Text, View } from "react-native"
import { router, Stack, useLocalSearchParams } from "expo-router"
import Animated, { useAnimatedStyle } from "react-native-reanimated"
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { backend } from "@kitab/core/backend"
import { dateTime } from "@kitab/core/format"
import { toast } from "@kitab/core/platform"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { Composer } from "@/components/composer"
import { Markdown } from "@/components/markdown"
import { Button } from "@/components/ui"

/** One run's report. Replying turns the run into a thread you can come back to. */
export default function RunScreen() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const p = useLocalSearchParams<{ routineId: string; runId: string }>()
  const routineId = decodeURIComponent(p.routineId)
  const runId = decodeURIComponent(p.runId)
  const routine = useStore((s) => s.routines.find((r) => r.id === routineId))
  const run = useStore((s) => s.runs[routineId]?.find((r) => r.id === runId))
  const connected = useStore((s) => s.connection.state === "connected")

  useEffect(() => {
    if (connected && run && run.report === undefined) {
      backend.loadRunReport(routineId, runId).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
    }
  }, [connected, run?.report, routineId, runId])

  const { height } = useReanimatedKeyboardAnimation()
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(-height.value, insets.bottom) }))
  const open = (threadId: string) => router.push(`/thread/${encodeURIComponent(threadId)}`)

  return (
    <>
      <Stack.Screen options={{ title: run ? dateTime(run.startedAt) : "Run" }} />
      <Animated.View style={[{ flex: 1, backgroundColor: c.canvas }, lift]}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16 }} keyboardDismissMode="interactive">
          <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 12 }}>{routine?.name}</Text>
          {run?.report === undefined ? (
            <ActivityIndicator />
          ) : run.report ? (
            <Markdown text={run.report} />
          ) : (
            <Text style={{ color: c.textMuted, fontSize: 15 }}>{run.status === "running" ? "Still running…" : "This run didn't write a report."}</Text>
          )}
        </ScrollView>
        {run?.threadId ? (
          <View style={{ padding: 12 }}>
            <Button title="Open the thread" onPress={() => open(run.threadId!)} />
          </View>
        ) : (
          <Composer
            threadId={null}
            working={false}
            cast={[]}
            placeholder="Reply to this run"
            onSend={async (text) => {
              try {
                open(await backend.replyToRun(routineId, runId, text))
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e))
                throw e
              }
            }}
          />
        )}
      </Animated.View>
    </>
  )
}
