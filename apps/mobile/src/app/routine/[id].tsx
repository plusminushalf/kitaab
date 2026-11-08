import { useEffect, useState } from "react"
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native"
import { router, Stack, useLocalSearchParams } from "expo-router"
import { backend } from "@kitab/core/backend"
import { dateTime, nextRun } from "@kitab/core/format"
import { modelName } from "@kitab/core/model-names"
import { toast } from "@kitab/core/platform"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { StatusMark, stateOf } from "@/components/routine-status"
import { Empty, Icon } from "@/components/ui"

function Fact({ label, value }: { label: string; value: string }) {
  const c = useColors()
  return (
    <View style={{ flexDirection: "row", paddingVertical: 6, gap: 12 }}>
      <Text style={{ color: c.textMuted, fontSize: 14, width: 92 }}>{label}</Text>
      <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>{value}</Text>
    </View>
  )
}

export default function RoutineScreen() {
  const c = useColors()
  const id = decodeURIComponent(useLocalSearchParams<{ id: string }>().id)
  const routine = useStore((s) => s.routines.find((r) => r.id === id))
  const runs = useStore((s) => s.runs[id])
  const personalities = useStore((s) => s.personalities)
  const connected = useStore((s) => s.connection.state === "connected")
  const [refreshing, setRefreshing] = useState(false)

  const load = () => backend.loadRuns(id).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
  useEffect(() => {
    if (connected) void load()
  }, [id, connected])

  if (!routine) return <Empty icon="questionmark.circle" title="Routine not found" />
  const who = routine.personalityId ? personalities.find((p) => p.id === routine.personalityId)?.name : undefined

  return (
    <>
      <Stack.Screen options={{ title: routine.name }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={runs ?? []}
        keyExtractor={(r) => r.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true)
              await load()
              setRefreshing(false)
            }}
          />
        }
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <StatusMark state={stateOf(routine)} />
              <Text style={{ color: c.text, fontSize: 15 }}>
                {routine.running ? "Running now" : !routine.enabled ? "Paused" : routine.lastStatus === "failed" ? "Last run failed" : routine.lastRunAt ? "Healthy" : "Hasn't run yet"}
              </Text>
            </View>
            {routine.lastStatus === "failed" && routine.lastError ? (
              <Text style={{ color: c.error, fontSize: 14, marginBottom: 8 }}>{routine.lastError}</Text>
            ) : null}
            <Fact label="When" value={routine.schedule || "—"} />
            {who ? <Fact label="Who" value={who} /> : null}
            <Fact label="Next run" value={routine.enabled && routine.nextRunAt ? `${nextRun(routine.nextRunAt, "")} · ${dateTime(routine.nextRunAt)}` : "—"} />
            {routine.lastRunAt ? <Fact label="Last run" value={dateTime(routine.lastRunAt)} /> : null}
            {routine.runCount !== undefined ? <Fact label="Runs" value={String(routine.runCount)} /> : null}
            {routine.skills?.length ? <Fact label="Skills" value={routine.skills.join(", ")} /> : null}
            {routine.model ? <Fact label="Model" value={modelName(routine.model)} /> : null}
            <Text style={{ color: c.textMuted, fontSize: 13, textTransform: "uppercase", marginTop: 20 }}>Runs</Text>
          </View>
        }
        ListEmptyComponent={
          runs ? <Empty icon="tray" title="No runs yet" body={routine.nextRunAt ? `The first one is ${dateTime(routine.nextRunAt)}.` : undefined} /> : <ActivityIndicator style={{ margin: 24 }} />
        }
        renderItem={({ item: run }) => (
          <Pressable
            onPress={() => router.push(`/run/${encodeURIComponent(id)}/${encodeURIComponent(run.id)}`)}
            style={({ pressed }) => ({ backgroundColor: pressed ? c.secondary : c.canvas })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 13 }}>
              <StatusMark state={run.status} />
              <Text style={{ flex: 1, color: c.text, fontSize: 15 }}>{dateTime(run.startedAt)}</Text>
              {run.threadId ? <Icon name="bubble.left" size={14} color={c.textMuted} /> : null}
              <Icon name="chevron.right" size={12} color={c.textMuted} />
            </View>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 46 }} />
          </Pressable>
        )}
      />
    </>
  )
}
