import { FlatList, Pressable, StyleSheet, Switch, Text, View } from "react-native"
import { router, Stack } from "expo-router"
import * as Haptics from "expo-haptics"
import { setInProfile } from "@kitab/core/personalities"
import { toast } from "@kitab/core/platform"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { ConnectionBanner } from "@/components/connection-banner"
import { ProfileMenu } from "@/components/profile-menu"
import { Avatar, Empty, HeaderButton } from "@/components/ui"

/** Your library. The switch adds a personality to the current profile's cast. */
export default function Personalities() {
  const c = useColors()
  const library = useStore((s) => s.personalities)
  const profileId = useStore((s) => s.profileId)
  const profile = useStore((s) => s.profiles.find((p) => p.id === s.profileId))
  const connected = useStore((s) => s.connection.state === "connected")

  return (
    <>
      <Stack.Screen
        options={{
          title: "Personalities",
          headerLeft: () => <ProfileMenu />,
          headerRight: () => <HeaderButton icon="plus" label="New personality" onPress={() => router.push("/personality/new")} />,
        }}
      />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={library}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={
          <>
            <ConnectionBanner />
            {library.length && profile ? (
              <Text style={{ color: c.textMuted, fontSize: 13, paddingHorizontal: 16, paddingBottom: 8 }}>Switch one on to add it to {profile.name}.</Text>
            ) : null}
          </>
        }
        ListEmptyComponent={
          connected ? <Empty icon="person.2" title="No personalities yet" body="A personality is a named character with its own way of working: Designer, Coach, Researcher. Make one and add it to profiles." /> : undefined
        }
        renderItem={({ item: p }) => {
          const on = Boolean(profile?.personalityIds?.includes(p.id))
          return (
            <Pressable onPress={() => router.push(`/personality/${encodeURIComponent(p.id)}`)} style={({ pressed }) => ({ backgroundColor: pressed ? c.secondary : c.canvas })}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
                <Avatar name={p.name} size={36} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: c.text, fontSize: 16, fontWeight: "500" }}>{p.name}</Text>
                  <Text style={{ color: c.textMuted, fontSize: 14 }} numberOfLines={1}>
                    {p.description || `@${p.id}`}
                  </Text>
                </View>
                {profileId ? (
                  <Switch
                    value={on}
                    onValueChange={(v) => {
                      void Haptics.selectionAsync()
                      setInProfile(profileId, p.id, v).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
                    }}
                  />
                ) : null}
              </View>
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 64 }} />
            </Pressable>
          )
        }}
      />
    </>
  )
}
