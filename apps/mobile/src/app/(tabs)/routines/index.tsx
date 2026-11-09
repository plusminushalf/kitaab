import { useMemo, useState } from "react"
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native"
import { router, Stack } from "expo-router"
import { backend } from "@kitab/core/backend"
import { nextRun, relativeTime } from "@kitab/core/format"
import type { Routine } from "@kitab/core/model"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { ConnectionBanner } from "@/components/connection-banner"
import { ProfileMenu } from "@/components/profile-menu"
import { StatusMark, stateOf } from "@/components/routine-status"
import { Empty } from "@/components/ui"

const byNextRun = (a: Routine, b: Routine) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity)

export default function Routines() {
  const c = useColors()
  const all = useStore((s) => s.routines)
  const profileId = useStore((s) => s.profileId)
  const personalities = useStore((s) => s.personalities)
  const connected = useStore((s) => s.connection.state === "connected")
  const [refreshing, setRefreshing] = useState(false)

  const sections = useMemo(() => {
    const mine = all.filter((r) => r.profileId === profileId)
    const active = mine.filter((r) => r.enabled).sort(byNextRun)
    const paused = mine.filter((r) => !r.enabled).sort((a, b) => a.name.localeCompare(b.name))
    return [
      { title: "", data: active },
      ...(paused.length ? [{ title: "Paused", data: paused }] : []),
    ].filter((s) => s.data.length)
  }, [all, profileId])

  async function refresh() {
    if (!profileId) return
    setRefreshing(true)
    await backend.selectProfile(profileId).finally(() => setRefreshing(false))
  }

  return (
    <>
      <Stack.Screen options={{ title: "Routines", headerLeft: () => <ProfileMenu /> }} />
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListHeaderComponent={<ConnectionBanner />}
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={{ color: c.textMuted, fontSize: 13, textTransform: "uppercase", paddingHorizontal: 16, paddingTop: 20, paddingBottom: 6 }}>{section.title}</Text> : null
        }
        ListEmptyComponent={
          connected ? <Empty icon="clock.arrow.circlepath" title="No routines yet" body="Routines are repeat work you've handed over, on a schedule. Ask for one in a thread." /> : undefined
        }
        renderItem={({ item: r }) => {
          const who = r.personalityId ? personalities.find((p) => p.id === r.personalityId)?.name : undefined
          const state = stateOf(r)
          return (
            <Pressable onPress={() => router.push(`/routine/${encodeURIComponent(r.id)}`)} style={({ pressed }) => ({ backgroundColor: pressed ? c.secondary : c.canvas })}>
              <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: "flex-start" }}>
                <View style={{ paddingTop: 2 }}>
                  <StatusMark state={state} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ color: c.text, fontSize: 16, fontWeight: "500" }} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={{ color: c.textMuted, fontSize: 14 }} numberOfLines={1}>
                    {[r.schedule, who].filter(Boolean).join(" · ")}
                  </Text>
                  {state === "failed" && r.lastError ? (
                    <Text style={{ color: c.error, fontSize: 13 }} numberOfLines={2}>
                      {r.lastError}
                    </Text>
                  ) : null}
                </View>
                <Text style={{ color: c.textMuted, fontSize: 13 }}>
                  {state === "running" ? "Running" : r.enabled && r.nextRunAt ? nextRun(r.nextRunAt) : r.lastRunAt ? relativeTime(r.lastRunAt) : ""}
                </Text>
              </View>
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 46 }} />
            </Pressable>
          )
        }}
      />
    </>
  )
}
