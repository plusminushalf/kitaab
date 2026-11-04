import { useEffect, useState } from "react"
import { ActivityIndicator, RefreshControl, ScrollView, Switch, Text, View } from "react-native"
import { loadSkills, setSkillEnabled } from "@kitab/core/skills"
import { toast } from "@kitab/core/platform"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { Row, Section } from "@/components/ui"

const SOURCE_LABEL = { made: "Skills made in this project", installed: "Installed skills", shared: "Shared skills", builtin: "Built into Hermes" } as const

/** The current project: its cast and its skills (on/off). */
export default function ProjectScreen() {
  const c = useColors()
  const projectId = useStore((s) => s.projectId)
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectId))
  const personalities = useStore((s) => s.personalities)
  const skills = useStore((s) => (s.projectId ? s.skills[s.projectId] : undefined))
  const [refreshing, setRefreshing] = useState(false)

  const load = () => (projectId ? loadSkills(projectId).catch((e) => toast.error(e instanceof Error ? e.message : String(e))) : undefined)
  useEffect(() => {
    void load()
  }, [projectId])

  if (!project) return null
  const cast = personalities.filter((p) => project.personalityIds?.includes(p.id))
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
      <Text style={{ color: c.text, fontSize: 28, fontWeight: "700", marginBottom: 4 }}>{project.name}</Text>
      <Text style={{ color: c.textMuted, fontSize: 14, marginBottom: 20 }}>Memory, skills and files belong to the project. Every personality working here shares them.</Text>

      <Section title="Personalities" footer="Add or remove them on the Personalities tab.">
        {cast.length ? cast.map((p, i) => <Row key={p.id} title={p.name} detail={p.description} last={i === cast.length - 1} />) : <Row title="Just the project's assistant" last />}
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
                    onValueChange={(v) => setSkillEnabled(project.id, s.name, v).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}
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
