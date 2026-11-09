import { useEffect, useState } from "react"
import { ActivityIndicator, RefreshControl, ScrollView, Switch, Text, View } from "react-native"
import { loadSkills, setSkillEnabled } from "@kitab/core/skills"
import { toast } from "@kitab/core/platform"
import { router } from "expo-router"
import { GENERAL } from "@kitab/core/model"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { Row, Section } from "@/components/ui"
import { promptNewProject, useProfileProjects } from "@/components/profile-menu"

const SOURCE_LABEL = { made: "Skills made in this profile", installed: "Installed skills", shared: "Shared skills", builtin: "Built into Hermes" } as const

/** The current profile: its projects, its cast and its skills (on/off). */
export default function ProfileScreen() {
  const c = useColors()
  const profileId = useStore((s) => s.profileId)
  const profile = useStore((s) => s.profiles.find((p) => p.id === s.profileId))
  const personalities = useStore((s) => s.personalities)
  const skills = useStore((s) => (s.profileId ? s.skills[s.profileId] : undefined))
  const projects = useProfileProjects()
  const connected = useStore((s) => s.connection.state === "connected")
  const [refreshing, setRefreshing] = useState(false)

  const load = () => (profileId ? loadSkills(profileId).catch((e) => toast.error(e instanceof Error ? e.message : String(e))) : undefined)
  useEffect(() => {
    void load()
  }, [profileId])

  if (!profile) return null
  const cast = personalities.filter((p) => profile.personalityIds?.includes(p.id))
  const groups = (["made", "installed", "shared", "builtin"] as const).map((src) => ({ src, list: (skills ?? []).filter((s) => s.source === src) })).filter((g) => g.list.length)

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: c.surfaceRaised }}
      contentContainerStyle={{ padding: 16 }}
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
    >
      <Text style={{ color: c.text, fontSize: 28, fontWeight: "700", marginBottom: 4 }}>{profile.name}</Text>
      <Text style={{ color: c.textMuted, fontSize: 14, marginBottom: 20 }}>Memory, skills and files belong to the profile. Every personality working here shares them.</Text>

      <Section title="Projects" footer="Each project has its own folder on the server, where its threads work. They all share this profile's memory, skills and personalities.">
        {projects.map((p) =>
          p.id === GENERAL ? (
            <Row key={p.id} title={p.name} detail="Threads with no project folder" />
          ) : (
            <Row key={p.id} title={p.name} detail={p.folder} chevron onPress={() => router.push(`/project/${encodeURIComponent(p.id)}`)} />
          ),
        )}
        <Row title="New project…" onPress={connected ? () => promptNewProject() : undefined} last />
      </Section>

      <Section title="Personalities" footer="Add or remove them on the Personalities tab.">
        {cast.length ? cast.map((p, i) => <Row key={p.id} title={p.name} detail={p.description} last={i === cast.length - 1} />) : <Row title="Just the profile's assistant" last />}
      </Section>

      {skills === undefined ? (
        <ActivityIndicator />
      ) : (
        groups.map((g) => (
          <Section key={g.src} title={SOURCE_LABEL[g.src]}>
            {g.list.map((s, i) => (
              <Row
                key={s.name}
                title={s.name}
                detail={s.description}
                last={i === g.list.length - 1}
                right={
                  <Switch
                    value={s.enabled}
                    onValueChange={(v) => setSkillEnabled(profile.id, s.name, v).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}
                  />
                }
              />
            ))}
          </Section>
        ))
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  )
}
