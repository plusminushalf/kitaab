import { useState } from "react"
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { router, Stack, useLocalSearchParams } from "expo-router"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import { deletePersonality, savePersonality } from "@kitab/core/personalities"
import { toast } from "@kitab/core/platform"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { Button, HeaderTextButton, Section } from "@/components/ui"

/** Create or edit a library personality. Changes reach every project it's in, on every device. */
export default function PersonalityEditor() {
  const c = useColors()
  const raw = useLocalSearchParams<{ id: string }>().id
  const id = raw === "new" ? undefined : decodeURIComponent(raw)
  const existing = useStore((s) => (id ? s.personalities.find((p) => p.id === id) : undefined))
  const projects = useStore((s) => s.projects)
  const usedIn = projects.filter((p) => id && p.personalityIds?.includes(id))

  const [name, setName] = useState(existing?.name ?? "")
  const [description, setDescription] = useState(existing?.description ?? "")
  const [instructions, setInstructions] = useState(existing?.instructions ?? "")
  const [saving, setSaving] = useState(false)

  const input = { color: c.text, fontSize: 16, paddingHorizontal: 16, paddingVertical: 12 }

  async function save() {
    setSaving(true)
    try {
      await savePersonality({ name, description, instructions }, id)
      router.back()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function remove() {
    if (!id || !existing) return
    Alert.alert(`Delete ${existing.name}?`, usedIn.length ? `It will be taken out of ${usedIn.map((p) => p.name).join(", ")}.` : undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          deletePersonality(id).then(
            () => router.back(),
            (e) => toast.error(e instanceof Error ? e.message : String(e)),
          ),
      },
    ])
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: existing ? existing.name : "New personality",
          headerLeft: () => <HeaderTextButton title="Cancel" onPress={() => router.back()} />,
          headerRight: () => <HeaderTextButton title={saving ? "Saving…" : "Save"} bold onPress={save} disabled={!name.trim() || saving} />,
        }}
      />
      <KeyboardAwareScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" style={{ backgroundColor: c.surfaceRaised }} contentContainerStyle={{ padding: 16 }} bottomOffset={24}>
        <Section title="Name" footer={id ? `Mention it as @${id}.` : undefined}>
          <TextInput value={name} onChangeText={setName} placeholder="Designer" placeholderTextColor={c.textMuted} style={input} autoFocus={!id} />
        </Section>
        <Section title="What it's for">
          <TextInput value={description} onChangeText={setDescription} placeholder="Reviews screens and suggests fixes" placeholderTextColor={c.textMuted} style={input} />
        </Section>
        <Section title="How it works" footer="Identity, tone and craft. Facts about a project belong in the project, not here.">
          <TextInput
            value={instructions}
            onChangeText={setInstructions}
            placeholder="You're a senior product designer. You're direct, and you show rather than tell…"
            placeholderTextColor={c.textMuted}
            multiline
            style={[input, { minHeight: 180, textAlignVertical: "top" }]}
          />
        </Section>
        {existing?.skills?.length ? (
          <Section title="Skills" footer="Change skills on the Mac for now.">
            <Text style={[input, { color: c.textMuted }]}>{existing.skills.join(", ")}</Text>
          </Section>
        ) : null}
        {id ? <Button title="Delete personality" variant="destructive" onPress={remove} /> : null}
        <View style={{ height: 40 }} />
      </KeyboardAwareScrollView>
    </>
  )
}
