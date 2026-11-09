import { useState } from "react"
import { Alert, Text, TextInput } from "react-native"
import { router, Stack, useLocalSearchParams } from "expo-router"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import * as Clipboard from "expo-clipboard"
import { backend } from "@kitab/core/backend"
import { folderNameFor } from "@kitab/core/projects"
import { toast } from "@kitab/core/platform"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { HeaderTextButton, Row, Section } from "@/components/ui"

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * A project in the open profile: /project/new makes one (name, optional folder), /project/<id>
 * renames or removes it. `then=thread` (from the threads list) opens a new thread in it after.
 */
export default function ProjectEditor() {
  const c = useColors()
  const params = useLocalSearchParams<{ id: string; then?: string }>()
  const id = params.id === "new" ? undefined : decodeURIComponent(params.id)
  const profileId = useStore((s) => s.profileId)
  const profileName = useStore((s) => s.profiles.find((p) => p.id === s.profileId)?.name)
  const existing = useStore((s) => (id && s.profileId ? s.projects[s.profileId]?.find((p) => p.id === id) : undefined))
  const connected = useStore((s) => s.connection.state === "connected")

  const [name, setName] = useState(existing?.name ?? "")
  const [folder, setFolder] = useState("")
  const [busy, setBusy] = useState(false)
  const suggested = `~/kitaab/${profileId ?? "default"}/${folderNameFor(name || "project")}`
  const input = { color: c.text, fontSize: 16, paddingHorizontal: 16, paddingVertical: 12 }

  async function save() {
    if (busy || !name.trim()) return
    setBusy(true)
    try {
      if (!id) {
        await backend.createProject(name, folder.trim() || undefined)
        // A new thread in it is the next thing you'd do.
        if (params.then === "thread") router.replace("/thread/new")
        else router.back()
      } else {
        if (existing && name.trim() !== existing.name) await backend.renameProject(id, name)
        router.back()
      }
    } catch (e) {
      toast.error(message(e))
    } finally {
      setBusy(false)
    }
  }

  function remove() {
    if (!id || !existing) return
    Alert.alert(`Remove ${existing.name}?`, "Its threads move to General. Its folder and threads stay on the server.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          backend.removeProject(id).then(
            () => router.back(),
            (e) => toast.error(`Couldn't remove it: ${message(e)}`),
          ),
      },
    ])
  }

  // Removed on another device while open.
  if (id && !existing) return null

  return (
    <>
      <Stack.Screen
        options={{
          title: existing ? existing.name : "New project",
          headerLeft: () => <HeaderTextButton title="Cancel" onPress={() => router.back()} />,
          headerRight: () => (
            <HeaderTextButton
              title={busy ? (id ? "Saving…" : "Creating…") : id ? "Save" : "Create"}
              bold
              onPress={save}
              disabled={!name.trim() || busy || !connected}
            />
          ),
        }}
      />
      <KeyboardAwareScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: c.surfaceRaised }}
        contentContainerStyle={{ padding: 16 }}
        bottomOffset={24}
      >
        {!id ? (
          <Text style={{ color: c.textMuted, fontSize: 14, marginBottom: 20, lineHeight: 20 }}>
            A project in {profileName ?? "this profile"}, with its own folder on the server. Its threads work in that folder and share the profile's memory, skills
            and personalities.
          </Text>
        ) : null}
        <Section title="Name">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Launch site"
            placeholderTextColor={c.textMuted}
            style={input}
            autoFocus={!id}
            returnKeyType={id ? "done" : "next"}
            onSubmitEditing={id ? save : undefined}
          />
        </Section>
        {id ? (
          existing?.folder ? (
            <Section title="Folder on the server" footer="New threads in this project start here.">
              <Row
                title={existing.folder}
                onPress={() => {
                  void Clipboard.setStringAsync(existing.folder!)
                  toast("Copied the folder path")
                }}
                right={<Text style={{ color: c.textMuted, fontSize: 13 }}>Copy</Text>}
                last
              />
            </Section>
          ) : null
        ) : (
          <Section title="Folder on the server" footer={`Leave it empty to make ${suggested}. Pick an existing folder (a repo, say) to work there.`}>
            <TextInput
              value={folder}
              onChangeText={setFolder}
              placeholder={suggested}
              placeholderTextColor={c.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              style={{ ...input, fontFamily: "Menlo", fontSize: 14 }}
              returnKeyType="done"
              onSubmitEditing={save}
            />
          </Section>
        )}
        {id ? (
          <Section footer="Takes it off the list. Nothing is deleted.">
            <Row title="Remove project" destructive onPress={remove} last />
          </Section>
        ) : null}
      </KeyboardAwareScrollView>
    </>
  )
}
